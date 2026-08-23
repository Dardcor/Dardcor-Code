export default {
  id: "freebuff",
  alias: "freebuff",
  aliases: [
    "freebuff-com",
    "fb"
  ],
  uiAlias: "freebuff",
  display: {
    name: "FreeBuff",
    icon: "bolt",
    color: "#00E5FF",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      text: "Freebuff provides 100% free coding models: DeepSeek V4 Flash/Pro, GPT-5.6 Luna, Kimi K3, MiniMax M3. Login via https://freebuff.com/login.",
      apiKeyUrl: "https://freebuff.com/login",
    },
  },
  category: "oauth",
  hasFree: true,
  authType: "oauth",
  authModes: [
    "oauth",
    "apikey"
  ],
  noAuth: false,
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    validateUrl: "https://www.codebuff.com/api/v1/freebuff/session",
    headers: {
      "HTTP-Referer": "https://freebuff.com",
      "X-Title": "Freebuff Proxy",
    },
  },
  models: [
    {
      id: "mimo/mimo-v2.5",
      name: "Xiaomi MiMo 2.5 (Freebuff)",
      contextLength: 262144,
      maxOutputTokens: 16384
    },
    {
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek V4 Flash (Freebuff)",
      contextLength: 131072,
      maxOutputTokens: 8192
    },
    {
      id: "deepseek/deepseek-v4-pro",
      name: "DeepSeek V4 Pro (Freebuff)",
      contextLength: 131072,
      maxOutputTokens: 8192
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna (Freebuff)",
      contextLength: 131072,
      maxOutputTokens: 8192
    },
    {
      id: "minimax/minimax-m3",
      name: "MiniMax M3 (Freebuff)",
      contextLength: 204800,
      maxOutputTokens: 8192
    },
    {
      id: "kimi/kimi-k3",
      name: "Kimi K3 (Freebuff)",
      contextLength: 262144,
      maxOutputTokens: 16384
    },
    {
      id: "z-ai/glm-5.2",
      name: "Z.ai GLM 5.2 (Freebuff)",
      contextLength: 131072,
      maxOutputTokens: 8192
    }
  ],
};
