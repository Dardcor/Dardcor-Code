export default {
  id: "friendliai",
  alias: "friendli",
  category: "freeTier",
  hasFree: true,
  authType: "apikey",
  display: {
    name: "FriendliAI",
    icon: "handshake",
    color: "#EC4899",
    textIcon: "FR",
    website: "https://friendli.ai",
  },
  transport: {
    baseUrl: "https://api.friendli.ai/serverless/v1/chat/completions",
    validateUrl: "https://api.friendli.ai/serverless/v1/models",
  },
  models: [
    { id: "deepseek-ai/deepseek-v3", name: "DeepSeek V3" },
    { id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1", supportsReasoning: true },
    { id: "meta-llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct" },
    { id: "meta-llama-3.1-70b-instruct", name: "Llama 3.1 70B Instruct" },
    { id: "meta-llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
    { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B Instruct" },
  ],
  passthroughModels: true,
};
