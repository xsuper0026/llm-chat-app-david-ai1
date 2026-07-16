/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI + AI Gateway.
 *
 * @license MIT
 */

// 模型與系統提示
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

// Env 型別定義（讓 TypeScript 認得 bindings）
export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

// 訊息型別
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  messages?: ChatMessage[];
}

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // 靜態資源路由：交給 ASSETS binding 處理（前端 HTML/CSS/JS）
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      // 防呆：如果 ASSETS binding 沒設定，回傳明確錯誤
      if (!env.ASSETS) {
        return new Response(
          "ASSETS binding is not configured. Please check wrangler.jsonc.",
          { status: 500 }
        );
      }
      return env.ASSETS.fetch(request);
    }

    // API 路由
    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * 處理聊天請求
 */
async function handleChatRequest(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // 防呆：檢查 AI binding 是否存在
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

    const body = (await request.json()) as ChatRequestBody;
    const messages: ChatMessage[] = body.messages ?? [];

    // 若沒有 system prompt，補上預設的
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // 呼叫 Workers AI（透過 AI Gateway）
    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true,
        // AI Gateway 整合
        gateway: {
          id: "david-gateway", // ⚠️ 請確認你在 Dashboard 有建立此 Gateway
          skipCache: false,
          cacheTtl: 3600,
        },
      }
    );

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
