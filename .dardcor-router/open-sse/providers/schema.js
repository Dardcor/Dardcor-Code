import { DEFAULT_RETRY_CONFIG, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";


export const PROVIDER_DEFAULTS = {
  baseUrl: "",
  format: "openai",
  headers: {},
  auth: { header: "Authorization", scheme: "bearer", source: ["accessToken", "apiKey"] },
  forceStream: false,
  urlSuffix: "",
  quirks: {},
  passthroughModels: false,
  retry: DEFAULT_RETRY_CONFIG,
  timeoutMs: FETCH_CONNECT_TIMEOUT_MS,
  executor: "default"
};

export const ENDPOINT_DEFAULTS = {
  openai: { chat: "/chat/completions", test: "/models", models: "/models" },
  claude: { chat: "/messages", test: "/models", countTokens: "/messages/count_tokens" },
  gemini: { chat: "/{model}:streamGenerateContent", models: "/models", test: "/models" }
};

export function resolveProvider(entry) {
  const transport = (entry && entry.transport) || {};
  return {
    ...PROVIDER_DEFAULTS,
    ...transport,
    headers: { ...PROVIDER_DEFAULTS.headers, ...transport.headers },
    auth: { ...PROVIDER_DEFAULTS.auth, ...transport.auth },
    quirks: { ...PROVIDER_DEFAULTS.quirks, ...transport.quirks },
    retry: { ...PROVIDER_DEFAULTS.retry, ...transport.retry }
  };
}
