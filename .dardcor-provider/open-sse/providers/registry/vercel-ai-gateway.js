export default {
  id: "vercel-ai-gateway",
  priority: 160,
  alias: "vercel-ai-gateway",
  aliases: [
    "vercel",
  ],
  uiAlias: "vercel",
  display: {
    name: "Vercel AI Gateway",
    icon: "deployed_code",
    color: "#111827",
    textIcon: "VG",
    website: "https://vercel.com/ai-gateway",
    notice: {
      text: "Unified OpenAI-compatible endpoint from Vercel. Use your AI Gateway API key, then pick models with provider/model IDs like anthropic/claude-sonnet-4.6 or openai/gpt-5.4.",
      apiKeyUrl: "https://vercel.com/dashboard/~/ai-gateway",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ai-gateway.vercel.sh/v1/chat/completions",
    thinkingFormat: "openai",
    retry: {
      "429": 2,
    },
    usage: {
      url: "https://ai-gateway.vercel.sh/v1/credits",
    },
  },
  serviceKinds: ["llm","embedding","image","imageToText","webSearch"],
  embeddingConfig: { baseUrl: "https://ai-gateway.vercel.sh/v1/embeddings" },
  imageConfig: { baseUrl: "https://ai-gateway.vercel.sh/v1/images/generations" },
  searchViaChat: { defaultModel: "openai/gpt-4o-mini", pricingUrl: "https://vercel.com/docs/ai-gateway/pricing" },
  modelsFetcher: { url: "https://ai-gateway.vercel.sh/v1/models", type: "openai" },
  models: [
    { id: "openai/gpt-4.1", name: "openai/gpt-4.1" },
    { id: "anthropic/claude-4-sonnet", name: "anthropic/claude-4-sonnet" },
    { id: "google/gemini-2.5-pro", name: "google/gemini-2.5-pro" },
    { id: "moonshotai/kimi-k2", name: "moonshotai/kimi-k2" },
    { id: "vercel/v0-1.5-md", name: "vercel/v0-1.5-md" },
  ],
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
