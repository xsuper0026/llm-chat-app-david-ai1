/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
const MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";

// Default system prompt
const SYSTEM_PROMPT = "你是一個友善的繁體中文助理，請用繁體中文回答所有問題，提供準確且簡潔的回應。";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
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

async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// 過濾掉錯誤訊息，只保留正常的 user / assistant 對話
		const cleanMessages = messages.filter(
			(msg) => msg.role === "user" || msg.role === "assistant"
		);

		// 只保留最近 10 則，避免累積錯誤對話
		const recentMessages = cleanMessages.slice(-10);

		// 加入 system prompt
		recentMessages.unshift({ role: "system", content: SYSTEM_PROMPT });

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages: recentMessages,
				max_tokens: 1024,
				stream: true,
			},
			{
				// AI Gateway（建立後取消註解並填入 ID）
				 gateway: {
				   id: "david-gateway",
				   skipCache: false,
				   cacheTtl: 3600,
				 },
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
