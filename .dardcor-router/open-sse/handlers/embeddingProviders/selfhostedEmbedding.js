import createOpenAIEmbeddingAdapter from "./openai.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export class MissingBaseUrlError extends Error {
  constructor() {
    super(
      "Self-hosted Embedding needs an endpoint: set this connection's baseUrl to " +
        "the OpenAI base URL of your server, e.g. http://host:8080/v1 (note the /v1 — " +
        "\"/embeddings\" is appended to it). Refusing to fall back to api.openai.com, " +
        "which would send your input and API key to OpenAI."
    );
    this.name = "MissingBaseUrlError";
    this.isConfigError = true;
  }
}

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl;
    if (!rawBaseUrl || !String(rawBaseUrl).trim()) throw new MissingBaseUrlError();
    const baseUrl = String(rawBaseUrl).trim().replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
};
