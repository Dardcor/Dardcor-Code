export default {
  id: "deepseek-web",
  priority: 32,
  alias: "deepseek-web",
  aliases: [
    "dsw",
    "deepseek-chat-web",
  ],
  uiAlias: "dsw",
  display: {
    name: "DeepSeek Web",
    icon: "psychology",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://chat.deepseek.com",
    notice: {
      signupUrl: "https://chat.deepseek.com",
    },
    kindNotice: {
      image: "Supports chat completions and autonomous tools with DeepSeek Web session.",
    },
  },
  category: "oauth",
  authType: "access_token",
  authModes: ["oauth"],
  authHint: "Connect your DeepSeek Web session from chat.deepseek.com",
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
    format: "deepseek-web",
    forceStream: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      "Origin": "https://chat.deepseek.com",
      "Referer": "https://chat.deepseek.com/",
      "x-app-version": "20241129.1",
    },
  },
  models: [
    { id: "deepseek-chat", name: "DeepSeek-V3 (Instant)", upstreamModelId: "deepseek-chat" },
    { id: "deepseek-reasoner", name: "DeepSeek-R1 (DeepThink)", upstreamModelId: "deepseek-reasoner" },
    { id: "deepseek-v3", name: "DeepSeek-V3", upstreamModelId: "deepseek-chat" },
    { id: "deepseek-r1", name: "DeepSeek-R1", upstreamModelId: "deepseek-reasoner" },
    { id: "auto", name: "DeepSeek Auto", upstreamModelId: "deepseek-chat" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
  features: {
    usage: true,
  },
};
