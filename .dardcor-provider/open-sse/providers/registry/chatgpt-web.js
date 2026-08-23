export default {
  id: "chatgpt-web",
  priority: 150,
  alias: "cgpt-web",
  aliases: ["cgpt-web", "chatgpt-web"],
  uiAlias: "cgpt-web",
  display: {
    name: "ChatGPT Web (Subscription)",
    icon: "auto_awesome",
    color: "#10A37F",
    textIcon: "CG",
    website: "https://chatgpt.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint:
    "Paste your full Cookie header from chatgpt.com, or just the __Secure-next-auth.session-token value. Accepts a bare token, an unchunked cookie line, a chunked (.0/.1) line, or the full DevTools Cookie: line.",
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/f/conversation",
    format: "openai",
    executor: "chatgpt-web",
    authType: "cookie",
  },
  models: [
    { id: "gpt-5.6-pro", name: "GPT-5.6 Pro" },
    { id: "gpt-5.6-thinking", name: "GPT-5.6 Thinking" },
    { id: "gpt-5.5-pro-extended", name: "GPT-5.5 Pro Extended", toolCalling: false },
    { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", toolCalling: false },
    { id: "gpt-5.5-thinking", name: "GPT-5.5 Thinking", toolCalling: false },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "o3", name: "o3" },
  ],
};
