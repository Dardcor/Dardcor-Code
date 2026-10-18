import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import { generateSessionId } from "../executors/opencode-zen.js";

export async function handleSystemoneCore({
  body,
  modelInfo,
  credentials,
  log,
  onRequestSuccess,
}) {
  const { provider, model } = modelInfo;
  const cfg = PROVIDER_MEDIA[provider]?.systemoneConfig;
  let targetUrl = credentials?.providerSpecificData?.baseUrl || cfg?.baseUrl;
  if (!targetUrl) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support System One.`
    );
  }
  if (targetUrl.includes("{accountId}")) {
    const accountId = credentials?.providerSpecificData?.accountId;
    if (!accountId) {
      return createErrorResult(
        HTTP_STATUS.BAD_REQUEST,
        `Provider '${provider}' requires accountId in providerSpecificData.`
      );
    }
    targetUrl = targetUrl.replace("{accountId}", accountId);
  }
  if (targetUrl.includes("{model}")) {
    targetUrl = targetUrl.replace(/\{model\}/g, model);
  }

  if (body.state === undefined || body.state === null) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: state");
  }
  if (!body.questions || typeof body.questions !== "object" || Array.isArray(body.questions)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: questions");
  }

  const token = credentials?.apiKey || credentials?.accessToken;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(cfg.headers || {}),
    "x-opencode-session": generateSessionId(),
  };
  const requestBody = { ...body, model: getModelUpstreamId(provider, model) || model };

  log?.debug?.("SYSTEMONE", `${provider.toUpperCase()} | ${model}`);

  let providerResponse;
  try {
    providerResponse = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      ...(typeof AbortSignal?.timeout === "function"
        ? { signal: AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS) }
        : {}),
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("SYSTEMONE", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("SYSTEMONE", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const usage = responseBody?.usage;
  return {
    success: true,
    usage: usage
      ? { prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0 }
      : null,
    response: new Response(JSON.stringify(responseBody), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
