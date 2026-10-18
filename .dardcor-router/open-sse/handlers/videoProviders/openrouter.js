
const SUPPORTED_ACTIONS = new Set(["generations"]);

function headers(config, token) {
  return {
    Accept: "application/json",
    ...(config.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default {
  buildRequest({ config, action, requestId, rawBody, contentType, token }) {
    const base = config.baseUrl.replace(/\/$/, "");

    if (requestId) {
      return { method: "GET", url: `${base}/${encodeURIComponent(requestId)}`, headers: headers(config, token) };
    }
    if (!SUPPORTED_ACTIONS.has(action)) {
      return { error: `OpenRouter video supports 'generations' only (got '${action}')` };
    }
    if (contentType && !contentType.includes("application/json")) {
      return { error: "OpenRouter video requires an application/json body" };
    }
    return {
      method: "POST",
      url: base,
      headers: { ...headers(config, token), "Content-Type": "application/json" },
      body: rawBody,
    };
  },
};
