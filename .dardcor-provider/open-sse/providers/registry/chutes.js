export default {
  id: "chutes",
  priority: 70,
  alias: "chutes",
  aliases: [
    "ch",
  ],
  uiAlias: "ch",
  display: {
    name: "Chutes AI",
    icon: "water_drop",
    color: "#ffffffff",
    textIcon: "CH",
    website: "https://chutes.ai",
    notice: {
      apiKeyUrl: "https://chutes.ai/app/api",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://llm.chutes.ai/v1/chat/completions",
    validateUrl: "https://llm.chutes.ai/v1/models",
  },
  models: [
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", supportsReasoning: true },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
  ],
  passthroughModels: true,
};
