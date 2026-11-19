import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { FORMATS } from "../../translator/formats.js";
import { PROVIDERS } from "../../config/providers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { ROLE, RESPONSES_ITEM } from "../../translator/schema/index.js";

const isResponsesProvider = (p) => PROVIDERS[p]?.format === FORMATS.OPENAI_RESPONSES;
import { saveRequestDetail, appendRequestLog } from "@/lib/usageDb.js";

function textFromResponsesMessageItem(item) {
  if (!item?.content || !Array.isArray(item.content)) return "";
  const byType = item.content.find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const anyText = item.content.find((c) => typeof c.text === "string");
  if (typeof anyText?.text === "string") return anyText.text;
  return "";
}

function pickAssistantMessageForChatCompletion(output) {
  if (!Array.isArray(output)) return { msgItem: null, textContent: null };
  const messages = output.filter((item) => item?.type === "message");
  if (messages.length === 0) return { msgItem: null, textContent: null };
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textFromResponsesMessageItem(messages[i]);
    if (text.length > 0) return { msgItem: messages[i], textContent: text };
  }
  const last = messages[messages.length - 1];
  return { msgItem: last, textContent: textFromResponsesMessageItem(last) };
}

function extractCustomToolInput(argumentsValue) {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { }
  return argumentsText;
}

function chatCompletionToResponses(responseBody, customToolNames = null) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const output = [];

  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

  for (const tc of message.tool_calls || []) {
    const fn = tc.function || {};
    const custom = customToolNames?.has(fn.name);
    output.push({
      type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
      id: `${custom ? "ctc" : "fc"}_${tc.id || ""}`,
      call_id: tc.id || "",
      name: fn.name || "",
      ...(custom
        ? { input: extractCustomToolInput(fn.arguments) }
        : { arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}) }),
    });
  }

  const usage = responseBody.usage || {};
  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status: "completed",
    background: false,
    error: null,
    output,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    },
  };
}

export function parseSSEToOpenAIResponse(rawSSE, fallbackModel) {
  const chunks = [];
  let streamError = null;

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      if (chunk?.error) streamError = chunk.error;
      else chunks.push(chunk);
    } catch { }
  }

  if (streamError) return { error: streamError };
  if (chunks.length === 0) return null;

  const first = chunks[0];
  const contentParts = [];
  const reasoningParts = [];
  const toolCallMap = new Map();
  let finishReason = "stop";
  let usage = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0) contentParts.push(delta.content);
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) reasoningParts.push(delta.reasoning_content);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, { id: tc.id || "", type: "function", function: { name: "", arguments: "" } });
        }
        const existing = toolCallMap.get(idx);
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const message = { role: "assistant", content: contentParts.join("") || (toolCallMap.size > 0 ? null : "") };
  if (reasoningParts.length > 0) message.reasoning_content = reasoningParts.join("");
  if (toolCallMap.size > 0) {
    message.tool_calls = [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);
  }

  const result = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };
  if (usage) result.usage = usage;
  return result;
}

export async function handleForcedSSEToJson({ providerResponse, sourceFormat, targetFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, customToolNames, toolNameMap, trackDone, appendLog, reqTag, log }) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isResponsesProvider(provider));
  if (!isSSE) return null;

  trackDone();

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };

  const isCodexResponsesApi = isResponsesProvider(provider) || targetFormat === FORMATS.OPENAI_RESPONSES;
  if (isCodexResponsesApi) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(providerResponse.body);
      if (onRequestSuccess) await onRequestSuccess();

      const usage = jsonResponse.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true });
      if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

      const inTokensForLog = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || usage.cached_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
      const { msgItem, textContent } = pickAssistantMessageForChatCompletion(jsonResponse.output);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: { prompt_tokens: inTokensForLog, completion_tokens: usage.output_tokens || 0 },
        response: { content: textContent, thinking: null, finish_reason: jsonResponse.status || "unknown" },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        return { success: true, response: new Response(JSON.stringify(jsonResponse), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const inTokens = (usage.input_tokens || 0) + cacheRead + cacheCreate;
      const outTokens = usage.output_tokens || 0;
      const cacheDetails = (cacheRead > 0 || cacheCreate > 0)
        ? { prompt_tokens_details: {
              ...(cacheRead > 0 ? { cached_tokens: cacheRead } : {}),
              ...(cacheCreate > 0 ? { cache_creation_tokens: cacheCreate } : {}) } }
        : {};
      let finalResp;

      const funcCallItems = (jsonResponse.output || []).filter(item => item.type === "function_call");
      const toolCalls = funcCallItems.map((item, idx) => ({
        id: item.call_id || `call_${item.name}_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));
      const hasToolCalls = toolCalls.length > 0;

      if (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI) {
        finalResp = {
          response: {
            candidates: [{ content: { role: "model", parts: [{ text: textContent || "" }] }, finishReason: "STOP", index: 0 }],
            usageMetadata: { promptTokenCount: inTokens, candidatesTokenCount: outTokens, totalTokenCount: inTokens + outTokens },
            modelVersion: model,
            responseId: jsonResponse.id || `resp_${Date.now()}`
          }
        };
      } else {
        const message = { role: "assistant", content: textContent || (hasToolCalls ? null : "") };
        if (hasToolCalls) message.tool_calls = toolCalls;
        const responseDone = jsonResponse.status === "completed" || jsonResponse.status === "done";
        const finishReason = hasToolCalls ? "tool_calls" : (responseDone ? "stop" : (jsonResponse.status || "stop"));
        finalResp = {
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: inTokens, completion_tokens: outTokens, total_tokens: inTokens + outTokens, ...cacheDetails }
        };
      }

      return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      console.error("[ChatCore] Responses API SSE→JSON failed:", err);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
    }
  }

  try {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    if (parsed.error) {
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        parsed.error.message || "Upstream SSE stream failed"
      );
    }

    if (onRequestSuccess) await onRequestSuccess();

    const usage = parsed.usage || {};
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      ...ctx,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage,
      response: {
        content: parsed.choices?.[0]?.message?.content || null,
        thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
        finish_reason: parsed.choices?.[0]?.finish_reason || "unknown"
      },
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

    if (usage && Object.keys(usage).length > 0) parsed.usage = usage;

    if (parsed?.choices) {
      for (const choice of parsed.choices) {
        if (choice?.message?.reasoning_content && choice.message.content) {
          delete choice.message.reasoning_content;
        }
      }
    }

    const finalBody = sourceFormat === FORMATS.OPENAI_RESPONSES
      ? chatCompletionToResponses(parsed, customToolNames)
      : parsed;

    return { success: true, response: new Response(JSON.stringify(finalBody), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
  } catch (err) {
    console.error("[ChatCore] Chat Completions SSE→JSON failed:", err);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
  }
}
