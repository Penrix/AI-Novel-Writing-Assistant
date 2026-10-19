import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { loadChatGPTCredentials, saveChatGPTCredentials, type ChatGPTRegistration } from "./credentials";

const AUTH_BASE = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const CALLBACK_PATH = "/auth/callback";
const AGENT_NAME = "Biz Novel Studio";
const LIFETIME_MS = 5 * 60_000;
type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
};
type VerifiedIdentity = { subject: string; email: string };
type Pending = { server: Server; timer: NodeJS.Timeout };
let pending: Pending | null = null;
const refreshTasks = new Map<string, Promise<string>>();

function oauthError(message: string): Error {
  return new Error("ChatGPT 授权失败：" + message);
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(AUTH_BASE + "/api/accounts/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw oauthError("令牌交换或刷新失败（HTTP " + response.status + "）。");
  const json = await response.json() as Partial<TokenResponse>;
  if (!json.access_token || typeof json.expires_in !== "number") throw oauthError("服务器返回的凭据不完整。");
  return json as TokenResponse;
}

async function verifyIdentity(idToken: string, clientId: string, nonce?: string): Promise<VerifiedIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw oauthError("身份令牌格式无效。");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
    alg?: string; kid?: string;
  };
  if (header.alg !== "RS256" || !header.kid) throw oauthError("不支持的身份令牌签名算法。");
  const configResponse = await fetch(AUTH_BASE + "/.well-known/openid-configuration", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!configResponse.ok) throw oauthError("无法读取官方身份配置。");
  const config = await configResponse.json() as { jwks_uri?: string };
  if (!config.jwks_uri || new URL(config.jwks_uri).origin !== AUTH_BASE) {
    throw oauthError("身份签名地址不可信。");
  }
  const jwksResponse = await fetch(config.jwks_uri, { signal: AbortSignal.timeout(15_000) });
  if (!jwksResponse.ok) throw oauthError("无法读取官方签名密钥。");
  const jwks = await jwksResponse.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const key = jwks.keys?.find((item) => item.kid === header.kid);
  if (!key || !verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), createPublicKey({
    key, format: "jwk",
  }), Buffer.from(parts[2], "base64url"))) {
    throw oauthError("身份令牌签名无效。");
  }
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
    iss?: string; aud?: string | string[]; sub?: string; exp?: number; nonce?: string; email?: string;
  };
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== AUTH_BASE || !audiences.includes(clientId)
    || !claims.sub || typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000
    || (nonce !== undefined && claims.nonce !== nonce)
  ) throw oauthError("身份令牌的签发者、受众或登录会话不匹配。");
  return { subject: claims.sub, email: claims.email ?? "" };
}

export async function beginChatGPTSignIn(newAccount = false): Promise<{ authorizationUrl: string }> {
  if (pending) throw oauthError("已有登录正在进行，请完成或取消当前授权。");
  const stored = await loadChatGPTCredentials();
  const current = !newAccount
    ? stored.registrations.find((item) => item.clientId === stored.activeClientId)
    : undefined;
  const requestedId = current?.clientId ?? "dynamic_agent_client";
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw oauthError("无法建立本机授权回调。");
    const redirectUri = "http://127.0.0.1:" + address.port + CALLBACK_PATH;
    server.on("request", async (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (url.pathname !== CALLBACK_PATH) { response.writeHead(404).end(); return; }
      try {
        if (url.searchParams.get("state") !== state) throw oauthError("回调验证失败。");
        const error = url.searchParams.get("error");
        if (error) throw oauthError(error === "access_denied" ? "用户未授权。" : "授权被拒绝。");
        const code = url.searchParams.get("code");
        const suppliedId = url.searchParams.get("client_id");
        const issuedId = current?.clientId ?? suppliedId;
        if (!code || !issuedId || issuedId === "dynamic_agent_client"
          || (current && suppliedId && suppliedId !== current.clientId)) {
          throw oauthError("缺少有效授权码或客户端身份不匹配。");
        }
        const token = await tokenRequest(new URLSearchParams({
          grant_type: "authorization_code",
          client_id: issuedId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          resource: RESOURCE,
        }));
        if (!token.id_token || !token.scope) throw oauthError("初次授权缺少身份令牌或授权范围。");
        const identity = await verifyIdentity(token.id_token, issuedId, nonce);
        if (current && current.subject !== identity.subject) throw oauthError("返回的账号与已选择账号不同。");
        const latest = await loadChatGPTCredentials();
        const previous = latest.registrations.find((item) => item.clientId === issuedId);
        if (previous && previous.subject !== identity.subject) throw oauthError("账号身份与已有注册不匹配。");
        const registration: ChatGPTRegistration = {
          clientId: issuedId,
          subject: identity.subject,
          email: identity.email,
          scopes: token.scope.split(/\s+/).filter(Boolean),
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          idToken: token.id_token,
          expiresAt: Date.now() + token.expires_in * 1_000,
        };
        await saveChatGPTCredentials({
          ...latest,
          activeClientId: issuedId,
          registrations: [...latest.registrations.filter((item) => item.clientId !== issuedId), registration],
        });
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><meta charset=utf-8><title>登录成功</title><p>ChatGPT 已连接，可以关闭此窗口并返回小说工作台。</p>");
      } catch (error) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><meta charset=utf-8><p>授权未完成，请返回小说工作台检查连接状态。</p>");
      } finally {
        if (pending?.server === server) {
          clearTimeout(pending.timer);
          pending = null;
          server.close();
        }
      }
    });
    const timer = setTimeout(() => {
      if (pending?.server === server) pending = null;
      server.close();
    }, LIFETIME_MS);
    timer.unref();
    pending = { server, timer };
    const url = new URL(AUTH_BASE + "/api/accounts/authorize");
    const params: Record<string, string> = {
      client_id: requestedId,
      ext_agent_host_id: stored.hostId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: challenge,
    };
    if (!current) params.agent_name_hint = AGENT_NAME;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString() };
  } catch (error) {
    server.close();
    throw error;
  }
}

export async function chatGPTConnectionStatus(): Promise<{
  connected: boolean; email: string | null; canUsePlan: boolean; pending: boolean;
}> {
  const data = await loadChatGPTCredentials();
  const registration = data.registrations.find((item) => item.clientId === data.activeClientId);
  return {
    connected: Boolean(registration?.refreshToken),
    email: registration?.email || null,
    canUsePlan: Boolean(registration?.refreshToken && registration.scopes.includes("chatgpt.tokens.use.direct")),
    pending: pending !== null,
  };
}

export async function getChatGPTAccessToken(): Promise<string> {
  const data = await loadChatGPTCredentials();
  const current = data.registrations.find((item) => item.clientId === data.activeClientId);
  if (!current?.refreshToken || !current.accessToken || !current.scopes.includes("chatgpt.tokens.use.direct")) {
    throw oauthError("请先使用 ChatGPT 登录并授权套餐调用。");
  }
  if ((current.expiresAt ?? 0) > Date.now() + 60_000) return current.accessToken;
  const running = refreshTasks.get(current.clientId);
  if (running) return running;
  const refresh = (async () => {
    const refreshed = await tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: current.clientId,
      refresh_token: current.refreshToken!,
      resource: RESOURCE,
    }));
    const latest = await loadChatGPTCredentials();
    const stillCurrent = latest.registrations.find((item) => item.clientId === current.clientId);
    if (!stillCurrent || stillCurrent.refreshToken !== current.refreshToken) {
      throw oauthError("授权凭据在刷新期间发生变化，请重新获取连接状态。");
    }
    const next: ChatGPTRegistration = {
      ...stillCurrent,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? stillCurrent.refreshToken,
      idToken: refreshed.id_token ?? stillCurrent.idToken,
      expiresAt: Date.now() + refreshed.expires_in * 1_000,
      scopes: (refreshed.scope ?? stillCurrent.scopes.join(" ")).split(/\s+/).filter(Boolean),
    };
    await saveChatGPTCredentials({
      ...latest,
      registrations: latest.registrations.map((item) => item.clientId === current.clientId ? next : item),
    });
    return refreshed.access_token;
  })();
  refreshTasks.set(current.clientId, refresh);
  try {
    return await refresh;
  } finally {
    if (refreshTasks.get(current.clientId) === refresh) refreshTasks.delete(current.clientId);
  }
}

export async function chatGPTAvailableModels(): Promise<Array<{ slug: string; displayName: string }>> {
  const token = await getChatGPTAccessToken();
  const res = await fetch(RESOURCE + "/models", {
    headers: { authorization: "Bearer " + token },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error("ChatGPT 模型列表读取失败（HTTP " + res.status + "）。");
  const data = await res.json() as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> };
  return (data.models ?? []).filter((model) => model.visibility === "list" && model.slug)
    .map((model) => ({ slug: model.slug!, displayName: model.display_name || model.slug! }));
}

export async function chatGPTSignOut(): Promise<{ revoked: boolean }> {
  if (pending) {
    clearTimeout(pending.timer);
    pending.server.close();
    pending = null;
  }
  const stored = await loadChatGPTCredentials();
  const current = stored.registrations.find((item) => item.clientId === stored.activeClientId);
  let revoked = !current?.refreshToken;
  if (current?.refreshToken) {
    try {
      const metadataResponse = await fetch(AUTH_BASE + "/.well-known/openid-configuration", {
        signal: AbortSignal.timeout(10_000),
      });
      const metadata = await metadataResponse.json() as { revocation_endpoint?: string };
      if (metadataResponse.ok && metadata.revocation_endpoint
        && new URL(metadata.revocation_endpoint).origin === AUTH_BASE) {
        const response = await fetch(metadata.revocation_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: current.refreshToken,
            token_type_hint: "refresh_token",
            client_id: current.clientId,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        revoked = response.ok;
      }
    } catch { /* The UI will report that remote revocation was not confirmed. */ }
  }
  const latest = await loadChatGPTCredentials();
  await saveChatGPTCredentials({
    ...latest,
    activeClientId: current?.clientId ?? null,
    registrations: latest.registrations.map((item) => item.clientId !== current?.clientId
      ? item
      : { clientId: item.clientId, subject: item.subject, email: item.email, scopes: [] }),
  });
  return { revoked };
}
