import { describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { ManusWebExecutor } from "../../open-sse/executors/manus-web.js";
import { validateWebSessionCredential } from "../../src/shared/services/webSessionCredentials.js";

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("Manus Web provider", () => {
  it("registers cookie auth, models, and specialized executor", () => {
    const entry = REGISTRY.find((item) => item.id === "manus-web");
    expect(entry.category).toBe("webCookie");
    expect(entry.transport.executor).toBe("manus-web");
    expect(PROVIDERS["manus-web"].format).toBe("openai");
    expect(PROVIDER_MODELS["manus-web"].map((model) => model.id)).toEqual([
      "manus-1.6", "manus-1.6-lite", "manus-1.6-max",
    ]);
    expect(getExecutor("manus-web")).toBeInstanceOf(ManusWebExecutor);
  });

  it("validates bare and full session cookies", () => {
    expect(validateWebSessionCredential("manus-web", "session_id=jwt").valid).toBe(true);
    expect(validateWebSessionCredential("manus-web", "foo=1; session_id=jwt").valid).toBe(true);
    expect(validateWebSessionCredential("manus-web", "foo=1").valid).toBe(false);
  });

  it("creates a task with bearer session auth and polls to completion", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ task_id: "task-1" }))
      .mockResolvedValueOnce(jsonResponse({
        messages: [
          { id: "m1", assistant_message: { content: "hello" } },
          { id: "s1", status_update: { agent_status: "running" } },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        messages: [{ id: "s2", status_update: { agent_status: "stopped" } }],
      }));

    const executor = new ManusWebExecutor({ pollIntervalMs: 1, taskTimeoutMs: 1000 });
    const result = await executor.execute({
      model: "manus-1.6-lite",
      body: { messages: [{ role: "user", content: "Say hello" }] },
      stream: true,
      credentials: { apiKey: "session_id=jwt-token" },
    });
    const text = await result.response.text();
    expect(text).toContain('"content":"hello"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("data: [DONE]");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.manus.ai/v2/task.create");
    expect(options.headers.Authorization).toBe("Bearer jwt-token");
    expect(JSON.parse(options.body).message.content[0].text).toContain("Say hello");
  });

  it("fails closed when the cookie is missing", async () => {
    const result = await new ManusWebExecutor().execute({
      body: { messages: [{ role: "user", content: "hello" }] },
      credentials: { apiKey: "other=1" },
    });
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.message).toContain("session_id");
  });
});
