/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

const INITIAL_MESSAGE = {
	role: "assistant",
	content:
		"Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
};

let chatHistory = [{ ...INITIAL_MESSAGE }];
let isProcessing = false;

userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

sendButton.addEventListener("click", sendMessage);

const clearButton = document.getElementById("clear-button");
if (clearButton) {
	clearButton.addEventListener("click", clearChat);
}

function clearChat() {
	chatHistory = [{ ...INITIAL_MESSAGE }];
	chatMessages.innerHTML = "";
	addMessageToChat("assistant", INITIAL_MESSAGE.content);
	userInput.focus();
}

function serializeError(error) {
	if (error instanceof Error) {
		return error.message || error.name || "Error";
	}
	if (typeof error === "string") {
		return error;
	}
	if (typeof error === "object" && error !== null) {
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}
	return String(error);
}

// 統一「顯示被擋 / 失敗，並把該則移出歷史」的處理
function markBlocked(assistantMessageEl, assistantTextEl, historyLengthBeforeSend, text) {
	// 關鍵：把被擋的 user 訊息從歷史移除，避免下一次連坐
	chatHistory.length = historyLengthBeforeSend;
	assistantTextEl.textContent = text;
	assistantMessageEl.style.color = "#c0392b";
}

async function sendMessage() {
	const message = userInput.value.trim();
	if (message === "" || isProcessing) return;

	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	addMessageToChat("user", message);

	userInput.value = "";
	userInput.style.height = "auto";

	typingIndicator.classList.add("visible");

	const historyLengthBeforeSend = chatHistory.length;
	chatHistory.push({ role: "user", content: message });

	const assistantMessageEl = document.createElement("div");
	assistantMessageEl.className = "message assistant-message";
	assistantMessageEl.innerHTML = "<p></p>";
	chatMessages.appendChild(assistantMessageEl);
	const assistantTextEl = assistantMessageEl.querySelector("p");

	chatMessages.scrollTop = chatMessages.scrollHeight;

	try {
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: chatHistory }),
		});

		// 先嘗試判斷是否為 JSON（被擋 / 錯誤時 Worker 回 JSON，正常時回 SSE stream）
		const contentType = response.headers.get("content-type") || "";
		if (contentType.includes("application/json")) {
			let data = {};
			try {
				data = await response.json();
			} catch {
				data = {};
			}

			// 被 Guardrails 擋下，或後端回報的可繼續錯誤
			if (data.error === "guardrail_blocked") {
				markBlocked(
					assistantMessageEl,
					assistantTextEl,
					historyLengthBeforeSend,
					data.message ||
						"AI 無法回覆這個訊息（可能違反內容政策）。這則訊息已從對話中移除，你可以繼續發問其他問題。"
				);
				return;
			}

			// 其他 JSON 錯誤
			markBlocked(
				assistantMessageEl,
				assistantTextEl,
				historyLengthBeforeSend,
				"抱歉，這則訊息處理失敗。這則訊息已從對話中移除，你可以繼續發問。（" +
					serializeError(data.detail || data.error || "未知錯誤") +
					"）"
			);
			return;
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}
		if (!response.body) {
			throw new Error("Response body is null");
		}

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
						if (typeof jsonData.response === "string" && jsonData.response.length > 0) {
							content = jsonData.response;
						} else if (
							jsonData.choices &&
							jsonData.choices[0] &&
							jsonData.choices[0].delta &&
							jsonData.choices[0].delta.content
						) {
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
					if (typeof jsonData.response === "string" && jsonData.response.length > 0) {
						content = jsonData.response;
					} else if (
						jsonData.choices &&
						jsonData.choices[0] &&
						jsonData.choices[0].delta &&
						jsonData.choices[0].delta.content
					) {
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

		if (responseText.length > 0) {
			chatHistory.push({ role: "assistant", content: responseText });
		} else {
			// 串流成功但沒有內容 → 也視為被擋，移出歷史
			markBlocked(
				assistantMessageEl,
				assistantTextEl,
				historyLengthBeforeSend,
				"AI 無法回覆這個訊息（可能違反內容政策）。這則訊息已從對話中移除，你可以繼續發問其他問題。"
			);
		}
	} catch (error) {
		console.error("Error:", error);
		markBlocked(
			assistantMessageEl,
			assistantTextEl,
			historyLengthBeforeSend,
			"抱歉，這則訊息處理失敗。這則訊息已從對話中移除，你可以繼續發問。（錯誤詳情：" +
				serializeError(error) +
				"）"
		);
	} finally {
		typingIndicator.classList.remove("visible");
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
	}
}

function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = "message " + role + "-message";
	messageEl.innerHTML = "<p></p>";
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
