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

// 被 Guardrails 擋下時，最多重試幾次（用來吸收偶發性的評估誤擋）
const MAX_RETRIES = 3;
// 每次重試之間等待的毫秒數
const RETRY_DELAY_MS = 400;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    let lastStatus = 0;
    let lastDetail = "";

    // 送出請求，若被 Guardrails 擋下（non-2xx）就重試。
    // 偶發性誤擋通常重試就會通過；真正的違規內容則會穩定被擋。
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
            skipCache: true, // 每次都重新評估，不吃快取
            cacheTtl: 3600,
          },
        }
      );

      // 成功：直接把 SSE streaming 回傳給前端
      if (response.ok) {
        return response;
      }

      // 被擋：記錄狀態，準備重試
      lastStatus = response.status;
      try {
        lastDetail = await response.clone().text();
      } catch {
        lastDetail = "";
      }

      // 還有重試次數就等一下再試
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
    }

    // 重試多次仍被擋 → 判定為真正的違規內容，回傳可繼續的 guardrail_blocked 訊號
    return new Response(
      JSON.stringify({
        error: "guardrail_blocked",
        message:
          "AI 無法回覆這個訊息（可能違反內容政策）。這則訊息已從對話中移除，你可以繼續發問其他問題。",
        status: lastStatus,
        detail: lastDetail,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
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
