export default {
  id: "tokenrouter",
  priority: 15,
  alias: "tokenrouter",
  display: {
    name: "TokenRouter",
    icon: "swap_horiz",
    color: "#3B82F6",
    textIcon: "TR",
    website: "https://www.tokenrouter.com",
    notice: {
      text: "Fast AI routing & unified model gateway for OpenAI, Claude, DeepSeek, Gemini and open models.",
      apiKeyUrl: "https://www.tokenrouter.com",
    },
  },
  hasFree: true,
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.tokenrouter.com/v1/chat/completions",
    thinkingFormat: "openai",
  },
  models: [
    { id: "tokenrouter/auto:free", name: "TokenRouter Auto (Free)", isFreeTier: true },
    { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (Free)", supportsReasoning: true, isFreeTier: true },
    { id: "deepseek/deepseek-chat:free", name: "DeepSeek V3 (Free)", isFreeTier: true },
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)", isFreeTier: true },
    { id: "qwen/qwen-2.5-coder-32b-instruct:free", name: "Qwen 2.5 Coder 32B (Free)", isFreeTier: true },
    { id: "openai/gpt-4o-mini:free", name: "GPT-4o Mini (Free)", isFreeTier: true },
    { id: "auto:free", name: "Auto Free", isFreeTier: true },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "deepseek-chat", name: "DeepSeek V3" },
    { id: "deepseek-reasoner", name: "DeepSeek R1", supportsReasoning: true },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
  defaultBaseUrl: "https://api.tokenrouter.com/v1",
  modelsFetcher: {
    url: "https://api.tokenrouter.com/v1/models",
    authHeader: "Authorization",
    authPrefix: "Bearer "
  }
};
