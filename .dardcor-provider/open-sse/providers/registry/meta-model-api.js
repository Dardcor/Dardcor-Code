import { ANTHROPIC_API_VERSION } from "../shared.js";

const BASE_URL = "https://api.meta.ai/v1";
const AUTH = { combined: true, header: "Authorization", scheme: "bearer" };

export default {
  id: "meta-model-api",
  priority: 182,
  alias: "muse",
  aliases: ["meta", "meta-ai"],
  uiAlias: "muse",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "Meta Model API",
    icon: "auto_awesome",
    color: "#0668E1",
    textIcon: "MS",
    website: "https://dev.meta.ai",
    notice: {
      apiKeyUrl: "https://api.meta.ai",
    },
  },
  thinkingConfig: {
    options: ["auto", "low", "medium", "high"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: `${BASE_URL}/responses`,
    validateUrl: `${BASE_URL}/models`,
    format: "openai-responses",
  },
  transports: [
    {
      format: "openai",
      baseUrl: `${BASE_URL}/chat/completions`,
      auth: AUTH,
    },
    {
      format: "openai-responses",
      baseUrl: `${BASE_URL}/responses`,
      auth: AUTH,
    },
    {
      format: "claude",
      baseUrl: `${BASE_URL}/messages`,
      headers: { "Anthropic-Version": ANTHROPIC_API_VERSION },
      auth: AUTH,
    },
  ],
  models: [
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", contextLength: 1048576, maxOutputTokens: 131072 },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1", contextLength: 1048576, maxOutputTokens: 131072 },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor (Data Sharing)", contextLength: 1048576, maxOutputTokens: 131072 },
  ],
  serviceKinds: ["llm"],
  modelsFetcher: { url: `${BASE_URL}/models`, type: "openai" },
};
