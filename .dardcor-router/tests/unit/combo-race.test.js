import { describe, it, expect, vi } from "vitest";

import { handleRaceChat, handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

function okResponse(content, { delayMs = 0 } = {}) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json });
  const response = make();
  return delayMs ? new Promise((resolve) => setTimeout(() => resolve(response), delayMs)) : response;
}

function errResponse(status = 500) {
  const make = () => ({ ok: false, status, clone: make, json: async () => ({ error: { message: "boom" } }) });
  return make();
}

describe("race combo", () => {
  it("returns a single racer directly", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("solo"));
    await handleRaceChat({ body: { stream: true }, models: ["p/only"], handleSingleModel, log });
    expect(handleSingleModel).toHaveBeenCalledWith({ stream: true }, "p/only");
  });

  it("returns the first successful racer by latency", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => (
      model === "p/slow" ? okResponse("slow", { delayMs: 100 }) : okResponse("fast")
    ));
    const response = await handleRaceChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/slow", "p/fast"],
      handleSingleModel,
      log,
      tuning: { raceTimeoutMs: 1000 },
    });
    expect((await response.clone().json()).choices[0].message.content).toBe("fast");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("skips failed racers", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => model === "p/bad" ? errResponse() : okResponse("good"));
    const response = await handleRaceChat({ body: {}, models: ["p/bad", "p/good"], handleSingleModel, log });
    expect((await response.clone().json()).choices[0].message.content).toBe("good");
  });

  it("skips a 200 response containing an error", async () => {
    const softError = { ok: true, status: 200, clone: () => softError, json: async () => ({ error: { message: "bad" } }) };
    const handleSingleModel = vi.fn(async (_body, model) => model === "p/soft" ? softError : okResponse("real"));
    const response = await handleRaceChat({ body: {}, models: ["p/soft", "p/real"], handleSingleModel, log });
    expect((await response.clone().json()).choices[0].message.content).toBe("real");
  });

  it("returns 503 when all racers fail or time out", async () => {
    const response = await handleRaceChat({
      body: {},
      models: ["p/a", "p/b"],
      handleSingleModel: () => new Promise(() => {}),
      log,
      tuning: { raceTimeoutMs: 10 },
    });
    expect(response.status).toBe(503);
    expect((await response.clone().json()).error.message).toContain("timed out");
  });

  it("forces multi-model racers non-streaming and replays a streaming winner as SSE", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("hello"));
    const response = await handleRaceChat({
      body: { stream: true, tools: [{ type: "function" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
    });
    expect(handleSingleModel.mock.calls.every(([body]) => body.stream === false)).toBe(true);
    expect(handleSingleModel.mock.calls.every(([body]) => body.tools)).toBe(true);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await response.text()).toContain("data: [DONE]");
  });

  it("dispatches race through handleComboChat", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => model === "p/bad" ? errResponse() : okResponse("winner"));
    const response = await handleComboChat({
      body: {}, models: ["p/bad", "p/good"], handleSingleModel, log, comboStrategy: "race",
    });
    expect((await response.clone().json()).choices[0].message.content).toBe("winner");
  });
});
