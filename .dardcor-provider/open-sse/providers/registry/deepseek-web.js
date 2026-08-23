export default {
  id: "deepseek-web",
  priority: 120,
  alias: "ds-web",
  aliases: ["ds-web", "deepseek-web", "dsw"],
  uiAlias: "ds-web",
  display: {
    name: "DeepSeek Web (Subscription)",
    icon: "bolt",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://chat.deepseek.com",
  },
  category: "webCookie",
  // The dashboard UI derives credential wording from
  // src/shared/services/webSessionCredentials.js (kind: "token",
  // credentialName: "userToken"), which overrides this authType label.
  authType: "cookie",
  authHint:
    "Paste your userToken from chat.deepseek.com localStorage (DevTools → Application → Local Storage → chat.deepseek.com → userToken). Accepts a raw token or a JSON-wrapped {\"value\":\"...\"} value.",
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-pro-think", name: "DeepSeek V4 Pro Think" },
    { id: "deepseek-v4-pro-search", name: "DeepSeek V4 Pro Search", toolCalling: false },
    { id: "deepseek-v4-pro-think-search", name: "DeepSeek V4 Pro Think+Search", supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-think", name: "DeepSeek V4 Flash Think" },
    { id: "deepseek-v4-flash-search", name: "DeepSeek V4 Flash Search", toolCalling: false },
    { id: "deepseek-v4-flash-think-search", name: "DeepSeek V4 Flash Think+Search", supportsReasoning: true },
    { id: "DeepSeek-R1", name: "DeepSeek R1", supportsReasoning: true },
    { id: "DeepSeek-R1-Search", name: "DeepSeek R1 Search", supportsReasoning: true },
    { id: "DeepSeek-V3.2", name: "DeepSeek V3.2", toolCalling: false },
    { id: "DeepSeek-Search", name: "DeepSeek Search", toolCalling: false },
    { id: "deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
  ],
};
