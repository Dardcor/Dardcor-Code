export default {
  id: "tokenharbor",
  priority: 120,
  alias: "tokenharbor",
  aliases: [
    "th",
    "thh",
  ],
  uiAlias: "tokenharbor",
  display: {
    name: "Token Harbor",
    icon: "anchor",
    color: "#0F766E",
    textIcon: "TH",
    website: "https://tokenharbor.ai",
    notice: {
      text: "OpenAI-compatible aggregator. One API key reaches every model, billed per-token from a prepaid wallet. Model ids are bare (e.g. claude-opus-5.5, gpt-6-astra, deepseek-v4.1-flash:free) and are fetched live from the provider.",
      apiKeyUrl: "https://tokenharbor.ai/dashboard",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://tokenharbor.ai/v1/chat/completions",
    validateUrl: "https://tokenharbor.ai/v1/models",
    retry: {
      429: 2,
    },
  },
  models: [
    { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6-sol", name: "GPT-6 Sol" },
    { id: "deepseek-v4.1-flash:free", name: "DeepSeek V4.1 Flash (Free)" },
    { id: "grok-4.7", name: "Grok 4.7" },
  ],
  modelsFetcher: { url: "https://tokenharbor.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
