export default {
  id: "nebius",
  priority: 70,
  alias: "nebius",
  display: {
    name: "Nebius AI",
    icon: "cloud",
    color: "#6C5CE7",
    textIcon: "NB",
    website: "https://nebius.com",
    notice: {
      apiKeyUrl: "https://studio.nebius.com/settings/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.studio.nebius.ai/v1/chat/completions",
    validateUrl: "https://api.studio.nebius.ai/v1/models",
  },
  models: [
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", supportsReasoning: true },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "meta-llama/Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B Instruct" },
    { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
    { id: "Qwen/Qwen3-Embedding-8B", name: "Qwen3 Embedding 8B", kind: "embedding" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "https://api.tokenfactory.nebius.com/v1/embeddings" },
};
