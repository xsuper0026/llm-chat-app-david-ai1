/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI + AI Gateway.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
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

    return new
