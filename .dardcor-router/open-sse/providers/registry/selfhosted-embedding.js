export default {
  id: "selfhosted-embedding",
  priority: 50,
  hasFree: true,
  alias: "selfhosted-embedding",
  display: {
    name: "Self-hosted Embedding",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "SE",
    website: "https://github.com/ggml-org/llama.cpp",
  },
  category: "apikey",
  auth: {
    apiKey: {
      text: "Set providerSpecificData.baseUrl to the OpenAI base URL, e.g. http://host:8080/v1 — /embeddings is appended. The API key is not checked by local servers; any value works.",
    },
  },
  models: [
    { id: "embedding", name: "Self-hosted embedding model", kind: "embedding" },
  ],
  serviceKinds: ["embedding"],
  embeddingConfig: {
    baseUrl: "http://localhost:8080/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
};
