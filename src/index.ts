/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI + AI Gateway.
 * Streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */

interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";
const GATEWAY_ID = "david-gateway";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 靜態資源
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      if (!env.ASSETS) {
        return new Response(
          "ASSETS binding is not configured. Please check wrangler.jsonc.",
          { status: 500 }
        );
      }
      return env.ASSETS.fetch(request);
    }

    // 聊天 API
    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.AI) {
      return new Response(
        JSON.stringify({
          error: "AI binding is not configured. Please check wrangler.jsonc.",
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages: ChatMessage[] = body.messages ?? [];

    // 注入 system prompt（若尚未存在）
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
        stream: true, // 啟用 SSE streaming
      },
      {
        returnRawResponse: true,
        gateway: {
          id: GATEWAY_ID,
          skipCache: true,
          cacheTtl: 3600,
        },
      }
    );

    // 攔截 Guardrails 擋下的請求
    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.clone().text();
      } catch {
        detail = "";
      }

      const isBlocked =
        response.status === 400 ||
        response.status === 403 ||
        /guardrail|content|safety|blocked|moderat/i.test(detail);

      if (isBlocked) {
        return new Response(
          JSON.stringify({
            error: "guardrail_blocked",
            message:
              "這則訊息不符合內容規範，已被安全機制攔截。請換個問法後再試一次。",
            detail,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          error: "upstream_error",
          message: "AI 服務暫時無法回應，請稍後再試。",
          status: response.status,
          detail,
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        }
      );
    }

    // 正常：直接把 SSE streaming 回應回傳給前端
    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process request",
        detail: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}
