
import { handleChatCore } from "./chatCore.js";
import { convertResponsesApiFormat } from "../translator/formats/responsesApi.js";
import { createResponsesApiTransformStream } from "../transformer/responsesTransformer.js";
import { convertResponsesStreamToJson } from "../transformer/streamToJsonConverter.js";
import { SSE_HEADERS_CORS } from "../utils/sseConstants.js";

export async function handleResponsesCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, connectionId }) {
  const convertedBody = convertResponsesApiFormat(body);

  const clientRequestedStreaming = convertedBody.stream === true;
  if (convertedBody.stream === undefined) {
    convertedBody.stream = false;
  }

  const result = await handleChatCore({
    body: convertedBody,
    modelInfo,
    credentials,
    log,
    onCredentialsRefreshed,
    onRequestSuccess,
    onDisconnect,
    connectionId,
    sourceFormatOverride: "openai-responses"
  });

  if (!result.success || !result.response) {
    return result;
  }

  const response = result.response;
  const contentType = response.headers.get("Content-Type") || "";

  if (!clientRequestedStreaming && contentType.includes("text/event-stream")) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(response.body);

      return {
        success: true,
        response: new Response(JSON.stringify(jsonResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
          }
        })
      };
    } catch (error) {
      console.error("[Responses API] Stream-to-JSON conversion failed:", error);
      return {
        success: false,
        status: 500,
        error: "Failed to convert streaming response to JSON"
      };
    }
  }

  if (clientRequestedStreaming && contentType.includes("text/event-stream")) {
    const transformStream = createResponsesApiTransformStream(null);
    const transformedBody = response.body.pipeThrough(transformStream);

    return {
      success: true,
      response: new Response(transformedBody, {
        status: 200,
        headers: { ...SSE_HEADERS_CORS }
      })
    };
  }

  return result;
}

