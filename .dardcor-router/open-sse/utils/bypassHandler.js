import { detectFormat } from "../services/provider.js";
import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { SKIP_PATTERNS } from "../config/runtimeConfig.js";
import { formatSSE } from "./stream.js";

export function handleBypassRequest(body, model, userAgent = "", ccFilterNaming = false) {
  if (!userAgent.includes("claude-cli")) return null;
  if (!body.messages?.length) return null;

  const messages = body.messages;
  const getText = (content) => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter(c => c.type === "text").map(c => c.text).join(" ");
    }
    return "";
  };

  let shouldBypass = false;
  let namingBypass = false;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "assistant" && lastMsg.content?.[0]?.text === "{") {
    shouldBypass = true;
  }

  if (!shouldBypass) {
    const firstText = getText(messages[0]?.content);
    if (firstText === "Warmup") {
      shouldBypass = true;
    }
  }

  if (!shouldBypass && messages.length === 1 && messages[0]?.role === "user") {
    const firstText = getText(messages[0]?.content);
    if (firstText === "count") {
      shouldBypass = true;
    }
  }

  if (!shouldBypass && SKIP_PATTERNS?.length) {
    const userMessages = messages.filter(m => m.role === "user");
    const userText = userMessages.map(m => getText(m.content)).join(" ");
    if (SKIP_PATTERNS.some(p => userText.includes(p))) {
      shouldBypass = true;
    }
  }

  if (!shouldBypass && ccFilterNaming) {
    const systemMsg = messages.find(m => m.role === "system");
    const systemFromMessages = getText(systemMsg?.content);
    const systemFromBody = Array.isArray(body.system)
      ? body.system.filter(s => s.type === "text").map(s => s.text).join(" ")
      : (typeof body.system === "string" ? body.system : "");
    const systemText = systemFromMessages || systemFromBody;
    if (systemText.includes("isNewTopic")) {
      shouldBypass = true;
      namingBypass = true;
    }
  }

  if (!shouldBypass) return null;

  const sourceFormat = detectFormat(body);
  const stream = body.stream !== false;

  if (namingBypass) {
    const userMsg = messages.find(m => m.role === "user");
    const userText = getText(userMsg?.content);
    const title = userText.trim().split(/\s+/).slice(0, 3).join(" ");
    const namingText = JSON.stringify({ isNewTopic: true, title });
    return stream
      ? createStreamingResponse(sourceFormat, model, namingText)
      : createNonStreamingResponse(sourceFormat, model, namingText);
  }

  return stream 
    ? createStreamingResponse(sourceFormat, model)
    : createNonStreamingResponse(sourceFormat, model);
}

const DEFAULT_BYPASS_TEXT = "CLI Command Execution: Clear Terminal";

function createOpenAIResponse(model, text = DEFAULT_BYPASS_TEXT) {
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2
    }
  };
}

function createNonStreamingResponse(sourceFormat, model, text) {
  const openaiResponse = createOpenAIResponse(model, text);

  if (sourceFormat === FORMATS.OPENAI) {
    return {
      success: true,
      response: new Response(JSON.stringify(openaiResponse), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      })
    };
  }

  const state = initState(sourceFormat);
  state.model = model;

  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);
  const allTranslated = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated?.length > 0) {
      allTranslated.push(...translated);
    }
  }

  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed?.length > 0) {
    allTranslated.push(...flushed);
  }

  const finalResponse = mergeChunksToResponse(allTranslated, sourceFormat);

  return {
    success: true,
    response: new Response(JSON.stringify(finalResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}

function createStreamingResponse(sourceFormat, model, text) {
  const openaiResponse = createOpenAIResponse(model, text);
  const state = initState(sourceFormat);
  state.model = model;

  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);

  const translatedChunks = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated?.length > 0) {
      for (const item of translated) {
        translatedChunks.push(formatSSE(item, sourceFormat));
      }
    }
  }

  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed?.length > 0) {
    for (const item of flushed) {
      translatedChunks.push(formatSSE(item, sourceFormat));
    }
  }

  translatedChunks.push("data: [DONE]\n\n");

  return {
    success: true,
    response: new Response(translatedChunks.join(""), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}

function mergeChunksToResponse(chunks, sourceFormat) {
  if (!chunks || chunks.length === 0) {
    return createOpenAIResponse("unknown");
  }

  let finalChunk = chunks[chunks.length - 1];

  if (sourceFormat === FORMATS.CLAUDE) {
    const messageStop = chunks.find(c => c.type === "message_stop");
    if (messageStop) {
      const contentDelta = chunks.find(c => c.type === "content_block_delta");
      const messageDelta = chunks.find(c => c.type === "message_delta");
      const messageStart = chunks.find(c => c.type === "message_start");

      if (messageStart?.message) {
        finalChunk = messageStart.message;
        const startUsage = messageStart.message.usage;
        const deltaUsage = messageDelta?.usage;
        if (startUsage || deltaUsage) {
          finalChunk.usage = {
            ...(startUsage || {}),
            ...(deltaUsage || {}),
            ...(startUsage?.cache_read_input_tokens !== undefined
              ? { cache_read_input_tokens: startUsage.cache_read_input_tokens }
              : {}),
            ...(startUsage?.cache_creation_input_tokens !== undefined
              ? { cache_creation_input_tokens: startUsage.cache_creation_input_tokens }
              : {}),
            ...(startUsage?.input_tokens !== undefined
              ? { input_tokens: startUsage.input_tokens }
              : {})
          };
        }
      }
    }
  }

  return finalChunk;
}

function createOpenAIStreamingChunks(completeResponse) {
  const { id, created, model, choices } = completeResponse;
  const content = choices[0].message.content;

  return [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {
          role: "assistant",
          content
        },
        finish_reason: null
      }]
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop"
      }],
      usage: completeResponse.usage
    }
  ];
}
