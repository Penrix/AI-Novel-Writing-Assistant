import { chatGPTAvailableModels, getChatGPTAccessToken } from "./session";

type ChatMessage = { role: string; content?: unknown; tool_calls?: unknown };
type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  response_format?: { type?: string; json_schema?: unknown };
  tools?: unknown[];
};

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part: unknown) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      throw new Error("ChatGPT 套餐接口当前只支持文本消息。");
    }).join("");
  }
  if (value == null) return "";
  throw new Error("ChatGPT 套餐接口收到不支持的消息格式。");
}

function buildResponsesInput(body: ChatRequest) {
  if (!body.model || !Array.isArray(body.messages)) throw new Error("模型请求缺少模型或消息。");
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    throw new Error("ChatGPT 套餐连接暂不支持函数工具调用，请为此类任务选择其他模型连接。");
  }
  const input = body.messages.map((message) => {
    if (message.tool_calls || !["system", "developer", "user", "assistant"].includes(message.role)) {
      throw new Error("ChatGPT 套餐连接暂不支持此类工具消息。");
    }
    return {
      role: message.role === "system" ? "developer" : message.role,
      content: messageText(message.content),
    };
  });
  if (body.response_format?.type === "json_object") {
    input.unshift({ role: "developer", content: "只输出一个可解析的 JSON 对象，不要 Markdown 或解释。" });
  } else if (body.response_format?.type === "json_schema") {
    input.unshift({
      role: "developer",
      content: "严格按照下面的 JSON Schema 输出一个 JSON 值，不要 Markdown 或解释：\n" +
        JSON.stringify(body.response_format.json_schema ?? {}),
    });
  }
  return input;
}

type StreamEvent = { type?: string; delta?: string; response?: {
  status?: string;
  error?: { code?: string; message?: string };
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
} };

async function* responseEvents(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error("ChatGPT 未返回流式响应。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const text = chunk.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!text || text === "[DONE]") continue;
        yield JSON.parse(text) as StreamEvent;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function completionError(event: StreamEvent): Error {
  const detail = event.response?.error;
  return new Error("ChatGPT 生成失败：" + (detail?.message ?? detail?.code ?? event.type ?? "未知错误"));
}

function chunkJson(model: string, id: string, content: string, finish: boolean): string {
  return JSON.stringify({
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: finish ? {} : { content }, finish_reason: finish ? "stop" : null }],
  });
}

export const chatGPTCompatibleFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  if (path.endsWith("/models") && request.method === "GET") {
    const models = await chatGPTAvailableModels();
    return new Response(JSON.stringify({
      object: "list", data: models.map((model) => ({ id: model.slug, object: "model", owned_by: "chatgpt_plan" })),
    }), { headers: { "content-type": "application/json" } });
  }
  if (!path.endsWith("/chat/completions") || request.method !== "POST") {
    throw new Error("ChatGPT 套餐接口只接收模型列表与聊天补全请求。");
  }

  const body = await request.json() as ChatRequest;
  const token = await getChatGPTAccessToken();
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      model: body.model, input: buildResponsesInput(body), store: false, stream: true,
    }),
    signal: request.signal,
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 500);
    throw new Error("ChatGPT 套餐调用失败（HTTP " + upstream.status + "）：" + detail);
  }

  const id = "chatcmpl-chatgpt-plan-" + Date.now();
  if (body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let completed = false;
        try {
          for await (const event of responseEvents(upstream)) {
            if (event.type === "response.output_text.delta") {
              controller.enqueue(encoder.encode("data: " + chunkJson(body.model, id, event.delta ?? "", false) + "\n\n"));
            } else if (event.type === "response.completed") {
              completed = true;
              controller.enqueue(encoder.encode("data: " + chunkJson(body.model, id, "", true) + "\n\n"));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } else if (event.type === "response.failed" || event.type === "response.incomplete") {
              throw completionError(event);
            }
          }
          if (!completed) throw new Error("ChatGPT 响应流提前中断，未收到完成事件。");
          controller.close();
        } catch (error) { controller.error(error); }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }

  let completed = false;
  let content = "";
  let usage: StreamEvent["response"]["usage"] | undefined;
  for await (const event of responseEvents(upstream)) {
    if (event.type === "response.output_text.delta") content += event.delta ?? "";
    else if (event.type === "response.completed") {
      completed = true;
      usage = event.response?.usage;
      if (!content) {
        content = (event.response?.output ?? []).flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
      }
    } else if (event.type === "response.failed" || event.type === "response.incomplete") {
      throw completionError(event);
    }
  }
  if (!completed) throw new Error("ChatGPT 响应流提前中断，未收到完成事件。");
  return new Response(JSON.stringify({
    id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: usage?.input_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
    },
  }), { headers: { "content-type": "application/json" } });
};
