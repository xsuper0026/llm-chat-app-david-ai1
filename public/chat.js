/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Initial welcome message
const INITIAL_MESSAGE = {
	role: "assistant",
	content:
		"Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
};

// Chat state
let chatHistory = [{ ...INITIAL_MESSAGE }];
let isProcessing = false;

// Auto-resize textarea
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

// ⭐ 新增：清除對話按鈕（如果 HTML 有 clear-button 元素）
const clearButton = document.getElementById("clear-button");
if (clearButton) {
	clearButton.addEventListener("click", clearChat);
}

/**
 * ⭐ 新增：清除對話（重置 chat history 與 UI）
 */
function clearChat() {
	chatHistory = [{ ...INITIAL_MESSAGE }];
	chatMessages.innerHTML = "";
	addMessageToChat("assistant", INITIAL_MESSAGE.content);
	userInput.focus();
}

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
	const message = userInput.value.trim();

	if (message === "" || isProcessing) return;

	// Disable input while processing
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message to chat UI
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	// ⭐ 記住原始 history 長度，方便失敗時 rollback
	const historyLengthBeforeSend = chatHistory.length;
	chatHistory.push({ role: "user", content: message });

	// Create new assistant response element
	const assistantMessageEl = document.createElement("div");
	assistantMessageEl.className = "message assistant-message";
	assistantMessageEl.innerHTML = "<p></p>";
	chatMessages.appendChild(assistantMessageEl);
	const assistantTextEl = assistantMessageEl.querySelector("p");

	chatMessages.scrollTop = chatMessages.scrollHeight;

	try {
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
			}),
		});

		if (!response.ok) {
			// ⭐ 讀取後端錯誤內容
			let errorDetail = `HTTP ${response.status} ${response.statusText}`;
			try {
				const errorData = await response.json();
				// 確保 detail 一定是 string
				const detail = typeof errorData.detail === "string" 
					? errorData.detail 
					: JSON.stringify(errorData.detail);
				const err = typeof errorData.error === "string"
					? errorData.error
					: JSON.stringify(errorData.error);
				errorDetail = `${err || "Error"} - ${detail || ""} (HTTP ${response.status})`;
			} catch {
				// JSON 解析失敗，用 HTTP status
			}
			throw new Error(errorDetail);
		}

		// Process streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";
		const flushAssistantText = () => {
			assistantTextEl.textContent = responseText;
			chatMessages.scrollTop = chatMessages.scrollHeight;
		};

		let sawDone = false;
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				const parsed = consumeSseEvents(buffer + "\n\n");
				for (const data of parsed.events) {
					if (data === "[DONE]") break;
					try {
						const jsonData = JSON.parse(data);
						let content = "";
						if (
							typeof jsonData.response === "string" &&
							jsonData.response.length > 0
						) {
							content = jsonData.response;
						} else if (jsonData.choices?.[0]?.delta?.content) {
							content = jsonData.choices[0].delta.content;
						}
						if (content) {
							responseText += content;
							flushAssistantText();
						}
					} catch (e) {
						console.error("Error parsing SSE data as JSON:", e, data);
					}
				}
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;
			for (const data of parsed.events) {
				if (data === "[DONE]") {
					sawDone = true;
					buffer = "";
					break;
				}
				try {
					const jsonData = JSON.parse(data);
					let content = "";
					if (
						typeof jsonData.response === "string" &&
						jsonData.response.length > 0
					) {
						content = jsonData.response;
					} else if (jsonData.choices?.[0]?.delta?.content) {
						content = jsonData.choices[0].delta.content;
					}
					if (content) {
						responseText += content;
						flushAssistantText();
					}
				} catch (e) {
					console.error("Error parsing SSE data as JSON:", e, data);
				}
			}
			if (sawDone) break;
		}

		// ⭐ 判斷 AI 是否真的有回應
		if (responseText.length > 0) {
			chatHistory.push({ role: "assistant", content: responseText });
		} else {
			// ⭐ 沒回應也算失敗（AI 拒絕但沒回錯誤），rollback 使用者訊息
			chatHistory.length = historyLengthBeforeSend;
			assistantTextEl.textContent =
				"⚠️ AI 無法回覆這個訊息（可能違反內容政策）。這則訊息已從對話中移除，你可以繼續發問其他問題。";
			assistantMessageEl.style.color = "#c0392b";
		}
	} catch (error) {
		console.error("Error:", error);

		// ⭐ 修正：正確序列化 error 物件
		let errorMessage = "未知錯誤";
		if (error instanceof Error) {
			errorMessage = error.message;
		} else if (typeof error === "object" && error !== null) {
			try {
				errorMessage = JSON.stringify(error);
			} catch {
				errorMessage = String(error);
			}
		} else {
			errorMessage = String(error);
		}

		// ⭐ 關鍵修正：失敗時 rollback chatHistory
		chatHistory.length = historyLengthBeforeSend;

		// ⭐ 顯示清楚的錯誤訊息
		assistantTextEl.textContent = `⚠️ 抱歉，這則訊息處理失敗。這則訊息已從對話中移除，你可以繼續發問。\n\n（錯誤詳情：${errorMessage}）`;
		assistantMessageEl.style.color = "#c0392b";
	} finally {
		typingIndicator.classList.remove("visible");
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
	}
}

/**
 * Helper function to add message to chat UI
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;
	messageEl.innerHTML = `<p></p>`;
	messageEl.querySelector("p").textContent = content;
	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let eventEndIndex;
	while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, eventEndIndex);
		normalized = normalized.slice(eventEndIndex + 2);

		const lines = rawEvent.split("\n");
		const dataLines = [];
		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}
		if (dataLines.length === 0) continue;
		events.push(dataLines.join("\n"));
	}
	return { events, buffer: normalized };
}
