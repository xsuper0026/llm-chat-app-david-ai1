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
    const incoming: ChatMessage[] = body.messages ?? [];

    // ⭐ 路 B：只取「最後一則 user 訊息」，不帶任何歷史上下文。
    // 原因：Guardrails（Block 模式）會評估整包 prompt，帶越多上下文越容易誤判。
    // 只送單則短 prompt，可大幅降低正常問題被誤擋的機率；
    // 真正的違規內容（如炸彈）仍為單則，Guardrails 一樣會擋下。
    const lastUser = [...incoming].reverse().find((m) => m.role === "user");

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];
    if (lastUser) {
      messages.push({ role: "user", content: lastUser.content });
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

    // Guardrails 擋下時回 non-2xx（例如 424）。轉成前端可判斷的可繼續訊號。
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
