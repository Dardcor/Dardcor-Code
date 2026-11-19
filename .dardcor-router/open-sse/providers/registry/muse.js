export default {
  id: "muse",
  priority: 120,
  alias: "muse",
  aliases: [
    "muse-ai",
    "meta-model-api",
    "muse-code",
    "muse-subscription",
  ],
  uiAlias: "muse",
  display: {
    name: "Muse (Meta Model API)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MU",
    website: "https://muse.ai",
    notice: {
      text: "Sign in with your Meta account (Muse Code subscription) or paste a Model API key from dev.meta.ai. Subscription keys are minted per account; Meta may train on contributor-tier data.",
      apiKeyUrl: "https://dev.meta.ai",
      signupUrl: "https://muse.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
    modelsUrl: "https://api.meta.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.meta.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.meta.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
    },
  ],
  models: [
    { id: "muse-spark-1.3", name: "Muse Spark 1.3", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
  ],
  passthroughModels: true,
  oauth: {
    clientId: "1031625952748946",
    deviceCodeUrl: "https://auth.meta.com/oidc/device/authorization/",
    tokenUrl: "https://auth.meta.com/oidc/device/token/",
  },
};
