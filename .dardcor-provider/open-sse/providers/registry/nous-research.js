export default {
  id: "nous-research",
  alias: "nous",
  category: "freeTier",
  hasFree: true,
  authType: "apikey",
  authHint: "Use your Nous Portal API key. OmniRoute targets the official OpenAI-compatible inference endpoint at https://inference-api.nousresearch.com/v1.",
  display: {
    name: "Nous Research",
    icon: "hub",
    color: "#2563EB",
    textIcon: "NO",
    website: "https://portal.nousresearch.com/help",
  },
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    validateUrl: "https://inference-api.nousresearch.com/v1/models",
  },
  models: [
    { id: "Hermes-4-405B", name: "Hermes 4 405B (Nous Research)", contextLength: 131072 },
    { id: "Hermes-4-70B", name: "Hermes 4 70B (Nous Research)", contextLength: 131072 },
    { id: "Hermes-3-Llama-3.1-405B", name: "Hermes 3 405B (Nous Research)", contextLength: 131072 },
    { id: "Hermes-3-Llama-3.1-70B", name: "Hermes 3 70B (Nous Research)", contextLength: 131072 },
    { id: "Hermes-3-Llama-3.1-8B", name: "Hermes 3 8B (Nous Research)", contextLength: 131072 },
    { id: "DeepHermes-3-Llama-3-8B-Preview", name: "DeepHermes 3 8B Preview", contextLength: 131072, supportsReasoning: true },
  ],
  passthroughModels: true,
};
