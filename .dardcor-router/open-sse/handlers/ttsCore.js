import { Buffer } from "node:buffer";
import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getTtsAdapter, synthesizeViaConfig } from "./ttsProviders/index.js";

export {
  VOICE_FETCHERS,
  fetchEdgeTtsVoices,
  fetchLocalDeviceVoices,
  fetchElevenLabsVoices,
} from "./ttsProviders/index.js";

function createTtsResponse(base64Audio, format, responseFormat) {
  const audioBuffer = Buffer.from(base64Audio, "base64");

  if (responseFormat === "json") {
    return {
      success: true,
      response: new Response(JSON.stringify({ audio: base64Audio, format }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  return {
    success: true,
    response: new Response(audioBuffer, {
      headers: {
        "Content-Type": `audio/${format}`,
        "Content-Length": String(audioBuffer.length),
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

export async function handleTtsCore({ provider, model, input, credentials, responseFormat = "mp3", language, style }) {
  if (!input?.trim()) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  try {
    const adapter = getTtsAdapter(provider);
    if (adapter) {
      const result = await adapter.synthesize(input.trim(), model, credentials, responseFormat, { language, style });
      if (result.success !== undefined) return result;
      return createTtsResponse(result.base64, result.format, responseFormat);
    }

    const result = await synthesizeViaConfig(provider, input.trim(), model, credentials);
    if (result) return createTtsResponse(result.base64, result.format, responseFormat);

    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support TTS via this route.`);
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err.message || "TTS synthesis failed");
  }
}
