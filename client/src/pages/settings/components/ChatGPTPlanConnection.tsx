import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@ai-novel/shared/types/api";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/button";

interface ConnectionState {
  connected: boolean;
  email: string | null;
  canUsePlan: boolean;
  pending: boolean;
}
interface OAuthModel { slug: string; displayName: string }

export default function ChatGPTPlanConnection() {
  const [status, setStatus] = useState<ConnectionState | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [models, setModels] = useState<OAuthModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const { data } = await apiClient.get<ApiResponse<ConnectionState>>("/chatgpt-plan/status");
    if (!data.data) return;
    setStatus(data.data);
    if (data.data.canUsePlan && !data.data.pending) {
      setAuthorizationUrl("");
      const listed = await apiClient.get<ApiResponse<OAuthModel[]>>("/chatgpt-plan/models");
      const available = listed.data.data ?? [];
      setModels(available);
      setSelectedModel((prev) => available.some((model) => model.slug === prev)
        ? prev : (available[0]?.slug ?? ""));
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!authorizationUrl) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [authorizationUrl, refresh]);

  async function connect(newAccount = false) {
    setBusy(true);
    setMessage("");
    try {
      const { data } = await apiClient.post<ApiResponse<{ authorizationUrl: string }>>(
        "/chatgpt-plan/start", { newAccount },
      );
      setAuthorizationUrl(data.data?.authorizationUrl ?? "");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "授权准备失败。");
    } finally {
      setBusy(false);
    }
  }

  async function chooseModel() {
    if (!selectedModel) return;
    setBusy(true);
    setMessage("");
    try {
      await apiClient.put("/settings/api-keys/chatgpt_plan", {
        model: selectedModel, isActive: true,
      });
      setMessage("模型已保存。刷新设置页后，可在模型路由中选择「ChatGPT 套餐授权」。");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存模型失败。");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage("");
    try {
      const { data } = await apiClient.post<ApiResponse<{ revoked: boolean }>>("/chatgpt-plan/disconnect");
      setStatus({ connected: false, email: null, canUsePlan: false, pending: false });
      setModels([]);
      setAuthorizationUrl("");
      setMessage(data.data?.revoked
        ? "ChatGPT 已退出。"
        : "已清除本机登录信息，但远端撤销未确认；可前往 ChatGPT 设置管理应用权限。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg bg-muted/30 px-4 py-4 md:col-span-2">
      <div className="font-medium">使用 ChatGPT 套餐</div>
      <p className="text-sm text-muted-foreground">
        通过 OpenAI 官方授权使用可用模型，无需复制账号凭据或填写 API Key。套餐调用有独立的使用限制。
      </p>
      {status?.canUsePlan ? (
        <div className="space-y-3">
          <p className="text-sm">已连接：{status.email || "ChatGPT 账号"}</p>
          <label className="block space-y-1 text-sm">
            <span>当前账号可用模型</span>
            <select
              className="block w-full max-w-md rounded-md border border-input bg-background px-3 py-2"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              {models.map((model) => (
                <option key={model.slug} value={model.slug}>{model.displayName}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void chooseModel()} disabled={busy || !selectedModel}>保存模型</Button>
            <Button variant="secondary" onClick={() => void connect(true)} disabled={busy || status.pending}>连接其他账号</Button>
            <Button variant="outline" onClick={() => void disconnect()} disabled={busy}>退出连接</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void connect()} disabled={busy || status?.pending === true}>
            {busy ? "准备授权中..." : "Continue with ChatGPT"}
          </Button>
          {status?.pending ? <span className="text-sm text-muted-foreground">请在授权页面完成登录。</span> : null}
        </div>
      )}
      {authorizationUrl ? (
        <p className="text-sm">
          <a className="font-medium text-primary underline" href={authorizationUrl} target="_blank" rel="noopener noreferrer">
            打开 ChatGPT 官方授权页面
          </a>
          <span className="ml-2 text-muted-foreground">授权后返回此页。</span>
        </p>
      ) : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <a className="text-xs text-primary underline" href="https://chatgpt.com/#settings" target="_blank" rel="noopener noreferrer">
        管理 ChatGPT 账号权限与用量
      </a>
    </section>
  );
}
