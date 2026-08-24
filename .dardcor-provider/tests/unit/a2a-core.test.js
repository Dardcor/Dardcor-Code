import { describe, expect, it, vi } from "vitest";
import { A2A_SCOPE, createA2ACore, createA2ASkillRegistry, createTaskManager } from "../../src/lib/a2a/core.js";
import { createA2AHttpHandler } from "../../src/lib/a2a/http.js";
import { createAgentCard } from "../../src/lib/a2a/card.js";
import { getRecentA2ATasks } from "../../src/lib/a2a/task-history.js";

const auth = { authenticated: true, actor: "test-client", scopes: [A2A_SCOPE] };
const deps = (overrides = {}) => ({
  listProviders: vi.fn(async () => [{ id: "p1", provider: "codex", apiKey: "do-not-return" }]),
  listModels: vi.fn(async () => []),
  getQuotaSnapshot: vi.fn(async ({ connectionId }) => ({ connectionId, token: "secret", remaining: 10 })),
  getCurrentStatus: vi.fn(async () => ({ status: "ready" })),
  getHealth: vi.fn(async () => ({ ok: true })),
  getCostSummary: vi.fn(async ({ period }) => ({ period, cost: 1.25 })),
  ...overrides,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("A2A core", () => {
  it("advertises only fixed read-only skills and a local authenticated card", async () => {
    const registry = createA2ASkillRegistry(deps());
    const core = createA2ACore({ registry });
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method: "skills/list" }, auth);
    expect(response.result.skills.map((skill) => skill.id)).toEqual([
      "providers.list", "models.list", "quota.snapshot", "status.current", "health.current", "cost.summary",
    ]);
    expect(response.result.skills.some((skill) => /shell|exec|write/i.test(skill.id))).toBe(false);
    const card = createAgentCard(core.skills, "http://localhost:21128");
    expect(card.url).toBe("http://localhost:21128/api/a2a");
    expect(card.security).toEqual([{ bearerAuth: [] }]);
    expect(card.capabilities).toMatchObject({ streaming: true, pushNotifications: false });
  });

  it("requires authentication and validates bounded skill arguments", async () => {
    const dependencies = deps();
    const core = createA2ACore({ registry: createA2ASkillRegistry(dependencies) });
    const call = { jsonrpc: "2.0", id: 2, method: "message/send", params: { skill: "quota.snapshot", arguments: { connectionId: "", extra: true } } };
    expect((await core.handle(call, { authenticated: false, scopes: [] })).error.code).toBe(-32001);
    expect((await core.handle(call, auth)).error.code).toBe(-32602);
    expect(dependencies.getQuotaSnapshot).not.toHaveBeenCalled();
  });

  it("runs, polls, and sanitizes a structured A2A task", async () => {
    const core = createA2ACore({ registry: createA2ASkillRegistry(deps()) });
    const sent = await core.handle({
      jsonrpc: "2.0", id: 3, method: "message/send",
      params: { message: { role: "user", parts: [{ kind: "data", data: { skill: "providers.list", arguments: {} } }] } },
    }, auth);
    expect(sent.result.status.state).toBe("submitted");
    await sleep(5);
    const polled = await core.handle({ jsonrpc: "2.0", id: 4, method: "tasks/get", params: { id: sent.result.id } }, auth);
    expect(polled.result.status.state).toBe("completed");
    expect(JSON.stringify(polled)).not.toContain("do-not-return");
    expect(polled.result.artifacts[0].parts[0].data[0]).toEqual({ id: "p1", provider: "codex" });
  });

  it("bridges the real task lifecycle to dashboard history", async () => {
    delete globalThis.__dardcor-codeA2aTasks;
    const core = createA2ACore({ registry: createA2ASkillRegistry(deps()) });
    const sent = await core.handle({ jsonrpc: "2.0", id: 30, method: "message/send", params: { skill: "health.current", arguments: {} } }, auth);

    expect(getRecentA2ATasks()[0]).toMatchObject({
      id: sent.result.id,
      name: "Router health",
      skillId: "health.current",
    });
    expect(["submitted", "working"]).toContain(getRecentA2ATasks()[0].status);
    await sleep(5);
    expect(getRecentA2ATasks()[0]).toMatchObject({ id: sent.result.id, status: "completed", error: null });
    expect(getRecentA2ATasks()[0].completedAt).toBeTypeOf("number");
    expect(getRecentA2ATasks()).toHaveLength(1);
  });

  it("bounds capacity and times out without leaking failure details", async () => {
    const audit = vi.fn();
    const manager = createTaskManager({ maxTasks: 1, timeoutMs: 5, audit });
    const core = createA2ACore({ registry: createA2ASkillRegistry(deps({ listModels: () => new Promise(() => {}) })), taskManager: manager });
    const first = await core.handle({ jsonrpc: "2.0", id: "secret-request", method: "message/send", params: { skill: "models.list", arguments: {} } }, { ...auth, credential: "hidden" });
    const second = await core.handle({ jsonrpc: "2.0", id: 6, method: "message/send", params: { skill: "status.current", arguments: {} } }, auth);
    expect(second.error.code).toBe(-32009);
    await sleep(10);
    const polled = await core.handle({ jsonrpc: "2.0", id: 7, method: "tasks/get", params: { id: first.result.id } }, auth);
    expect(polled.result.status).toMatchObject({ state: "failed", message: "Skill invocation timed out" });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("hidden");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("secret-request");
  });

  it("supports cancellation", async () => {
    const core = createA2ACore({ registry: createA2ASkillRegistry(deps({ getHealth: () => new Promise(() => {}) })) });
    const sent = await core.handle({ jsonrpc: "2.0", id: 8, method: "message/send", params: { skill: "health.current", arguments: {} } }, auth);
    const canceled = await core.handle({ jsonrpc: "2.0", id: 9, method: "tasks/cancel", params: { id: sent.result.id } }, auth);
    expect(canceled.result.status.state).toBe("canceled");
  });
});

describe("A2A HTTP", () => {
  it("enforces auth, JSON content type, and body limits", async () => {
    const core = createA2ACore({ registry: createA2ASkillRegistry(deps()) });
    const denied = createA2AHttpHandler({ core, authorize: async () => ({ authenticated: false }) });
    expect((await denied(new Request("http://localhost/api/a2a", { method: "POST" }))).status).toBe(401);
    const handler = createA2AHttpHandler({ core, authorize: async () => auth });
    expect((await handler(new Request("http://localhost/api/a2a", { method: "POST", body: "{}" }))).status).toBe(415);
    expect((await handler(new Request("http://localhost/api/a2a", { method: "POST", headers: { "content-type": "application/json", "content-length": "999999" }, body: "{}" }))).status).toBe(413);
  });

  it("streams bounded task state as SSE", async () => {
    const core = createA2ACore({ registry: createA2ASkillRegistry(deps()) });
    const handler = createA2AHttpHandler({ core, authorize: async () => auth });
    const response = await handler(new Request("http://localhost/api/a2a", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "message/stream", params: { skill: "health.current", arguments: {} } }),
    }));
    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain('"state":"completed"');
    expect(text).not.toContain("undefined");
  });
});
