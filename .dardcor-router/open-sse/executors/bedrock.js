import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { AWS_EVENTSTREAM, AWS_SIGV4, BEDROCK } from "../config/awsConstants.js";
import {
  resolveAwsCredentials,
  resolveRegion,
} from "../shared/awsCredentials.js";
import { crc32, parseEventFrame } from "../utils/awsEventStream.js";
import { escapeUri, signAwsRequest } from "../utils/awsSigv4.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { FORMATS } from "../translator/formats.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";

export class BedrockExecutor extends BaseExecutor {
  constructor(providerId = "bedrock") {
    super(providerId, PROVIDERS[providerId] || {});
    this.wireFormat = this.config?.format || FORMATS.OPENAI;
    this.isClaudeWire = this.wireFormat === FORMATS.CLAUDE;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const region = resolveRegion(credentials);

    const familyPattern = BEDROCK.modelFamilyPatterns[this.wireFormat];
    if (familyPattern && !familyPattern.test(String(model || ""))) {
      throw new Error(
        `Bedrock model ${JSON.stringify(model)} is not supported by the ${this.provider} ` +
          `provider, which expects ${BEDROCK.modelFamilyHints[this.wireFormat]}. Model families ` +
          "on Bedrock use different request and response shapes, so each gets its own provider " +
          "entry rather than failing mid-stream after the call is billed.",
      );
    }

    const action = stream ? BEDROCK.streamPath : BEDROCK.invokePath;
    return `https://bedrock-runtime.${region}.amazonaws.com/model/${escapeUri(model)}/${action}`;
  }

  transformRequest(model, body, stream, credentials) {
    const { model: _model, stream: _stream, ...rest } = body || {};
    if (!this.isClaudeWire) return rest;
    return { ...rest, anthropic_version: BEDROCK.anthropicVersion };
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      Accept: stream
        ? "application/vnd.amazon.eventstream"
        : "application/json",
    };
  }


  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }) {
    const resolved = await resolveAwsCredentials(credentials, { log });

    const url = this.buildUrl(model, stream, 0, credentials);
    const transformedBody = this.transformRequest(
      model,
      body,
      stream,
      credentials,
    );
    const payload = JSON.stringify(transformedBody);

    const headers = signAwsRequest({
      method: "POST",
      url,
      headers: this.buildHeaders(credentials, stream),
      body: payload,
      region: resolved.region,
      service: BEDROCK.service,
      credentials: resolved,
    });

    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(
      () => connectCtrl.abort(new Error("Bedrock fetch connect timeout")),
      this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS,
    );
    const fetchSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;
    let response;
    try {
      response = await proxyAwareFetch(
        url,
        {
          method: "POST",
          headers,
          body: payload,
          signal: fetchSignal,
          redirect: "error",
        },
        proxyOptions,
      );
    } catch (error) {
      if (connectCtrl.signal.aborted && !signal?.aborted) {
        throw new Error("Bedrock fetch connect timeout", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(connectTimer);
    }

    const loggedHeaders = redactSignedHeaders(headers);

    if (!response.ok || !stream || !response.body) {
      return { response, url, headers: loggedHeaders, transformedBody };
    }

    return {
      response: new Response(this.eventStreamToSse(response.body, log), {
        status: response.status,
        statusText: response.statusText,
        headers: { ...SSE_HEADERS },
      }),
      url,
      headers: loggedHeaders,
      transformedBody,
    };
  }

  eventStreamToSse(upstream, log = null) {
    const reader = upstream.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = new Uint8Array(0);
    let sawTerminalEvent = false;
    let downstreamCancelled = false;
    let failed = false;

    return new ReadableStream({
      start: async (controller) => {
        const emit = (eventType, data) => {
          if (downstreamCancelled) return;
          const frame = this.isClaudeWire
            ? `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
            : `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        };

        const fail = (type, message) => {
          if (failed) return false;
          failed = true;
          log?.error?.("BEDROCK", `${type}: ${message}`);
          emit(
            "error",
            this.isClaudeWire
              ? { type: "error", error: { type, message } }
              : { error: { type, message, code: type } },
          );
          return false;
        };

        const drainFrames = () => {
          while (buffer.byteLength >= 12) {
            const view = new DataView(
              buffer.buffer,
              buffer.byteOffset,
              buffer.byteLength,
            );
            if (view.getUint32(8, false) !== crc32(buffer.subarray(0, 8))) {
              return fail(
                "api_error",
                "Bedrock EventStream prelude CRC mismatch",
              );
            }
            const totalLength = view.getUint32(0, false);
            const headersLength = view.getUint32(4, false);
            if (
              totalLength < 16 ||
              totalLength > AWS_EVENTSTREAM.maxMessageBytes ||
              headersLength > AWS_EVENTSTREAM.maxHeadersBytes ||
              headersLength > totalLength - 16
            ) {
              return fail(
                "api_error",
                "Bedrock EventStream frame bounds are invalid",
              );
            }
            if (buffer.byteLength < totalLength) break;

            const frame = buffer.slice(0, totalLength);
            buffer = buffer.slice(totalLength);

            let event;
            try {
              event = parseEventFrame(frame);
            } catch (error) {
              return fail("api_error", error.message);
            }

            const messageType = event.headers[":message-type"];
            if (messageType === "exception" || messageType === "error") {
              const exceptionType =
                event.headers[":exception-type"] ||
                event.headers[":error-code"] ||
                "api_error";
              const message =
                event.payload?.message ||
                event.payload?.Message ||
                event.headers[":error-message"] ||
                `Bedrock returned an EventStream ${messageType}`;
              return fail(exceptionType, message);
            }

            if (event.headers[":event-type"] !== BEDROCK.chunkEventName) {
              log?.warn?.(
                "BEDROCK",
                `skipped unrecognised EventStream event type ${JSON.stringify(event.headers[":event-type"])}`,
              );
              continue;
            }

            const encoded = event.payload?.bytes;
            if (!encoded) {
              return fail(
                "api_error",
                "Bedrock chunk frame carried no payload bytes",
              );
            }

            let inner;
            try {
              inner = JSON.parse(decoder.decode(Buffer.from(encoded, "base64")));
            } catch (error) {
              return fail(
                "api_error",
                `Bedrock chunk was not valid JSON (${error.message})`,
              );
            }

            if (this.isClaudeWire) {
              if (!inner?.type) {
                return fail(
                  "api_error",
                  "Bedrock chunk decoded to an event with no type",
                );
              }
              emit(inner.type, inner);
              if (inner.type === BEDROCK.terminalEventType) sawTerminalEvent = true;
            } else {
              if (!Array.isArray(inner?.choices)) {
                return fail(
                  "api_error",
                  "Bedrock chunk decoded without a `choices` array",
                );
              }
              emit(null, inner);
              if (inner.choices.some((c) => c?.finish_reason)) sawTerminalEvent = true;
            }
          }
          return true;
        };

        for (;;) {
          let chunk;
          try {
            chunk = await reader.read();
          } catch (error) {
            fail("api_error", `Bedrock stream read failed: ${error.message}`);
            break;
          }
          if (chunk.done) break;
          const value = chunk.value;
          if (!value?.byteLength) continue;

          if (buffer.byteLength === 0) {
            buffer = value;
          } else {
            const joined = new Uint8Array(buffer.byteLength + value.byteLength);
            joined.set(buffer);
            joined.set(value, buffer.byteLength);
            buffer = joined;
          }

          if (!drainFrames()) break;
        }

        if (!downstreamCancelled) {
          if (!failed && buffer.byteLength) {
            fail("api_error", "Bedrock stream ended mid-frame");
          } else if (!failed && !sawTerminalEvent) {
            fail(
              "api_error",
              this.isClaudeWire
                ? `Bedrock stream ended before ${BEDROCK.terminalEventType}`
                : "Bedrock stream ended before any choice reported a finish_reason",
            );
          }
          if (!this.isClaudeWire && !failed) {
            controller.enqueue(encoder.encode(SSE_DONE));
          }
          controller.close();
        }
        await reader
          .cancel()
          .catch((error) =>
            log?.debug?.("BEDROCK", `upstream cancel failed: ${error.message}`),
          );
        reader.releaseLock?.();
      },
      cancel: (reason) => {
        downstreamCancelled = true;
        return reader.cancel(reason);
      },
    });
  }
}

function redactSignedHeaders(headers) {
  const redacted = {
    ...headers,
    Authorization: headers.Authorization.replace(/Signature=[0-9a-f]+/, "Signature=<redacted>"),
  };
  if (redacted[AWS_SIGV4.securityTokenHeader]) {
    redacted[AWS_SIGV4.securityTokenHeader] = "<redacted>";
  }
  return redacted;
}

export async function probeBedrockCredentials(credentials, fetchFn) {
  let resolved;
  try {
    resolved = await resolveAwsCredentials(credentials);
  } catch (error) {
    return { valid: false, error: error.message };
  }

  const url = `https://bedrock.${resolved.region}.amazonaws.com/${BEDROCK.probePath}`;
  const headers = signAwsRequest({
    method: "GET",
    url,
    headers: { Accept: "application/json" },
    region: resolved.region,
    service: BEDROCK.service,
    credentials: resolved,
  });
  const probeCtrl = new AbortController();
  const probeTimer = setTimeout(
    () => probeCtrl.abort(new Error("AWS credential probe timed out")),
    BEDROCK.probeTimeoutMs,
  );
  let res;
  try {
    res = await fetchFn(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: probeCtrl.signal,
    });
  } catch (error) {
    if (probeCtrl.signal.aborted) {
      return { valid: false, error: "AWS credential probe timed out" };
    }
    throw error;
  } finally {
    clearTimeout(probeTimer);
  }
  if (res.ok) return { valid: true, error: null };

  const errorType = (res.headers.get(BEDROCK.errorTypeHeader) || "").split(":")[0];
  if (errorType === BEDROCK.accessDeniedErrorType) return { valid: true, error: null };

  const message = (await res.json().catch(() => null))?.message;
  return {
    valid: false,
    error: `AWS rejected the credentials (${errorType || `HTTP ${res.status}`})${message ? `: ${message}` : ""}`,
  };
}

export default BedrockExecutor;
