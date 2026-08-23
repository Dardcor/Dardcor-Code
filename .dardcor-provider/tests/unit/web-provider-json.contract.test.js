import { describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import {
  extractUserToken,
  messagesToPrompt,
} from "../../open-sse/executors/deepseek-web.js";
import { parseStreamResponse } from "../../open-sse/executors/gemini-web.js";
import {
  decodeConnectFrame,
  extractDelta,
  frameConnectMessage,
  getConnectEndStreamError,
} from "../../open-sse/executors/kimi-web.js";
import { parseNotionInferenceStream } from "../../open-sse/executors/notion-web.js";
import {
  buildPplxRequestBody,
  parseOpenAIMessages,
} from "../../open-sse/executors/perplexity-web.js";
import { parseZaiFrame } from "../../open-sse/executors/zai-web.js";
import { QwenWebExecutor } from "../../open-sse/executors/qwen-web.js";
import grokWeb from "../../open-sse/providers/registry/grok-web.js";
import {
  findModelName,
  getModelUpstreamId,
  isValidModel,
} from "../../open-sse/config/providerModels.js";

// Coverage limitation: the grok-web NDJSON reader and perplexity-web SSE reader
// are private. Per contract, this file does not require production exports solely
// to reach those helpers.

describe("web provider JSON and stream helper contracts", () => {
  it("builds Perplexity JSON requests from normalized OpenAI messages", () => {
    const parsed = parseOpenAIMessages([
      { role: "developer", content: "Be concise" },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
    const request = buildPplxRequestBody(parsed.currentMsg, "copilot", "pplx_pro", null);

    expect(parsed).toEqual({
      systemMsg: "Be concise\n",
      history: [],
      currentMsg: "Hello",
    });
    expect(request.query_str).toBe("Hello");
    expect(request.params).toMatchObject({
      query_str: "Hello",
      mode: "copilot",
      model_preference: "pplx_pro",
      use_schematized_api: true,
      last_backend_uuid: null,
    });
  });

  it("round-trips Kimi Connect JSON frames and recognizes incomplete frames", () => {
    const message = { op: "append", mask: "block.text.content", block: { text: { content: "hi" } } };
    const framed = frameConnectMessage(JSON.stringify(message));

    expect(decodeConnectFrame(framed.subarray(0, 4), 0)).toEqual({ consumed: 0, frame: null });
    expect(decodeConnectFrame(framed, 0)).toEqual({
      consumed: framed.length,
      frame: { flags: 0, message },
    });
    expect(extractDelta(message)).toEqual({ kind: "text", text: "hi" });
  });

  it("extracts Kimi Connect EndStream errors", () => {
    expect(getConnectEndStreamError({
      flags: 2,
      message: { error: { code: "resource_exhausted", message: "quota reached" } },
    })).toBe("resource_exhausted: quota reached");
    expect(getConnectEndStreamError({ flags: 0, message: {} })).toBeNull();
  });

  it("normalizes Z.ai internal and OpenAI-shaped envelopes", () => {
    expect(parseZaiFrame({ data: { phase: "thinking", delta_content: "reason" } })).toEqual({
      content: "",
      reasoning: "reason",
      done: false,
    });
    expect(parseZaiFrame({
      choices: [{ delta: { content: "answer", reasoning_content: "why" }, finish_reason: "stop" }],
    })).toEqual({ content: "answer", reasoning: "why", done: true });
    expect(parseZaiFrame({ data: { phase: "done" } })).toEqual({
      content: "",
      reasoning: "",
      done: true,
    });
  });

  it("parses Gemini StreamGenerate wrb.fr cumulative snapshots", () => {
    const snapshot = (parts) => {
      const inner = [];
      inner[4] = [[null, parts]];
      return JSON.stringify([["wrb.fr", null, JSON.stringify(inner)]]);
    };
    const raw = [")]}'", "17", snapshot(["Hel"]), "not-json wrb.fr", snapshot(["Hello", " world"])].join("\n");

    expect(parseStreamResponse(raw)).toBe("Hello world");
  });

  it("parses Notion NDJSON inference records while ignoring malformed lines", () => {
    const raw = [
      "not-json",
      JSON.stringify({ type: "markdown-chat", value: "short" }),
      JSON.stringify({
        type: "agent-inference",
        value: [
          { type: "text", content: "Hello " },
          { type: "metadata", content: "ignored" },
          { type: "text", content: "from Notion" },
        ],
      }),
      "[DONE]",
    ].join("\n");

    expect(parseNotionInferenceStream(raw)).toBe("Hello from Notion");
  });

  it("extracts DeepSeek token storage shapes", () => {
    expect(extractUserToken({ apiKey: '{"value":"json-token"}' })).toBe("json-token");
    expect(extractUserToken({ accessToken: "userToken=raw-token" })).toBe("raw-token");
    expect(extractUserToken({})).toBeNull();
  });

  it("folds DeepSeek messages into its single-prompt contract", () => {
    const messages = [
      { role: "system", content: "Be useful" },
      { role: "user", content: "first" },
      { role: "assistant", content: "response" },
      { role: "user", content: [{ type: "input_text", text: "latest" }] },
    ];

    expect(messagesToPrompt(messages)).toBe("Be useful\n\nlatest");
    expect(messagesToPrompt(messages, 3)).toBe(
      "Be useful\n\nUser: first\n\nAssistant: response\n\nUser: latest"
    );
  });

  it("uses the current Qwen SPA version and converts answer SSE to JSON", async () => {
    const answerSse = [
      `data: ${JSON.stringify({ choices: [{ delta: { phase: "answer", content: "Hello world" } }] })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "chat-test" } }), {
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(answerSse, {
        headers: { "Content-Type": "text/event-stream" },
      }));

    const result = await new QwenWebExecutor().execute({
      model: "qwen-plus",
      body: { messages: [{ role: "user", content: "Hello" }] },
      stream: false,
      credentials: { apiKey: "cna=test; ssxmod_itna=test; token=test-token" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.version).toBe("0.2.81");
    expect((await result.response.json()).choices[0].message.content).toBe("Hello world");
  });

  it("returns 502 when Qwen sends an empty non-streaming response", async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "chat-empty" } }), {
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      }));

    const result = await new QwenWebExecutor().execute({
      model: "qwen-plus",
      body: { messages: [{ role: "user", content: "Hello" }] },
      stream: false,
      credentials: { apiKey: "cna=test; ssxmod_itna=test; token=test-token" },
    });
    const payload = await result.response.json();

    expect(result.response.status).toBe(502);
    expect(payload.error.message).toMatch(/empty response/i);
    expect(payload.error.message).toMatch(/session.*cookie|cookie.*session/i);
  });
});

describe("web provider registry model fallback contract", () => {
  it("keeps unknown model ids intact and honors passthrough registries", () => {
    const unknown = "future-grok-model";

    expect(grokWeb.passthroughModels).toBe(true);
    expect(getModelUpstreamId("grok-web", unknown)).toBe(unknown);
    expect(findModelName("grok-web", unknown)).toBe(unknown);
    expect(isValidModel("grok-web", unknown, new Set(["grok-web"]))).toBe(true);
  });
});
