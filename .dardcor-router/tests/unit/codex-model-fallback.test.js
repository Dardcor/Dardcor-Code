import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
  default: (...args) => fetchMock(...args),
}));

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function makeBody(model, text = "hello") {
  return {
    model,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }],
  };
}

describe("CodexExecutor ChatGPT Account Model Fallbacks", () => {
  let executor;

  beforeEach(() => {
    executor = new CodexExecutor();
    fetchMock.mockReset();
  });

  it("maps gpt-6-astra to gpt-5.6-terra in transformRequest", () => {
    const body = makeBody("gpt-6-astra");
    executor.transformRequest("gpt-6-astra", body, true, { connectionId: "test" });
    expect(body.model).toBe("gpt-5.6-terra");
  });

  it("maps gpt-5.6-sol to gpt-5.6-terra in transformRequest", () => {
    const body = makeBody("gpt-5.6-sol");
    executor.transformRequest("gpt-5.6-sol", body, true, { connectionId: "test" });
    expect(body.model).toBe("gpt-5.6-terra");
  });

  it("maps retired gpt-5.4 to gpt-5.6-terra", () => {
    const body = makeBody("gpt-5.4");
    executor.transformRequest("gpt-5.4", body, true, { connectionId: "test" });
    expect(body.model).toBe("gpt-5.6-terra");
  });

  it("maps gpt-5.5 to gpt-5.6-luna", () => {
    const body = makeBody("gpt-5.5");
    executor.transformRequest("gpt-5.5", body, true, { connectionId: "test" });
    expect(body.model).toBe("gpt-5.6-luna");
  });

  it("preserves supported models gpt-5.6-terra and gpt-5.6-luna", () => {
    const terraBody = makeBody("gpt-5.6-terra");
    executor.transformRequest("gpt-5.6-terra", terraBody, true, { connectionId: "test" });
    expect(terraBody.model).toBe("gpt-5.6-terra");

    const lunaBody = makeBody("gpt-5.6-luna");
    executor.transformRequest("gpt-5.6-luna", lunaBody, true, { connectionId: "test" });
    expect(lunaBody.model).toBe("gpt-5.6-luna");
  });

  it("auto-recovers in execute() when upstream returns 400 unsupported ChatGPT model", async () => {
    const errorBody = JSON.stringify({
      detail: "The 'unsupported-model' model is not supported when using Codex with a ChatGPT account.",
    });

    const successStream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode("event: response.output_text.delta\ndata: {\"delta\":\"hi\"}\n\n"));
        ctrl.close();
      },
    });

    // First call fails with 400 ChatGPT account model error
    fetchMock.mockResolvedValueOnce(new Response(errorBody, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));

    // Second call succeeds with fallback model
    fetchMock.mockResolvedValueOnce(new Response(successStream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));

    const result = await executor.execute({
      model: "unsupported-model",
      body: makeBody("unsupported-model"),
      stream: true,
      credentials: { connectionId: "test" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryCallBody.model).toBe("gpt-5.6-terra");
    expect(result.response.status).toBe(200);
  });
});
