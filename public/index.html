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

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      if (!env.ASSETS) {
        return new Response(
          "ASSETS binding is not configured. Please check wrangler.jsonc.",
          { status: 500 }
        );
      }
      return env.ASSETS.fetch(request);
    }

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
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages: ChatMessage[] = body.messages ?? [];

    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
        stream: true,
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

    // Guardrails 擋下時，AI Gateway 會回 non-2xx 的結構化錯誤。
    // 統一轉成前端可判斷的 guardrail_blocked 訊號（回 200，避免被當成伺服器錯誤）。
    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.clone().text();
      } catch {
        detail = "";
      }

      return new Response(
        JSON.stringify({
          error: "guardrail_blocked",
          message:
            "AI 無法回覆這個訊息（可能違反內容政策）。這則訊息已從對話中移除，你可以繼續發問其他問題。",
          status: response.status,
          detail,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    // env.AI.run 若直接丟例外（例如 Guardrails 在某些情況以 throw 呈現），也一併當成可繼續的攔截
    return new Response(
      JSON.stringify({
        error: "guardrail_blocked",
        message:
          "AI 無法回覆這個訊息（可能違反內容政策或服務暫時異常）。這則訊息已從對話中移除，你可以繼續發問其他問題。",
        detail: error instanceof Error ? error.message : String(error),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
}
