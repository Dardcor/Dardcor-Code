import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRegistry, normalizeAgentStatus } from "../../src/lib/agents/registry.js";
import { getAgentLifecycle, recordAgentLifecycle } from "../../src/lib/agents/lifecycle.js";

describe("agent registry core", () => {
  beforeEach(() => { delete globalThis.__miawrouterAgentLifecycle; });

  it("derives honest states only from status checks", () => {
    expect(normalizeAgentStatus({ installed: false })).toMatchObject({ state: "unavailable", available: false, running: false });
    expect(normalizeAgentStatus({ installed: true })).toMatchObject({ state: "available", available: true, configured: false });
    expect(normalizeAgentStatus({ installed: true, has9Router: true })).toMatchObject({ state: "configured", configured: true, running: false });
    expect(normalizeAgentStatus({ installed: true, running: true, pid: 42 })).toMatchObject({ state: "running", running: true });
    expect(normalizeAgentStatus({ error: "probe failed" })).toMatchObject({ state: "error", error: "Status check failed" });
  });

  it("exposes fixed capabilities without commands or secrets", async () => {
    const registry = createAgentRegistry({ claude: vi.fn(async () => ({ installed: true, has9Router: true, apiKey: "secret" })) });
    const agents = await registry.list();
    const claude = agents.find((agent) => agent.id === "claude");
    expect(claude).toMatchObject({
      kind: "cli",
      status: { state: "configured", configured: true, running: false },
      capabilities: { status: true, configure: true, launch: false, adopt: false },
    });
    expect(JSON.stringify(claude)).not.toContain("secret");
    expect(JSON.stringify(agents)).not.toMatch(/command|shell|args/i);
  });

  it("marks failed probes as errors instead of guessing", async () => {
    const registry = createAgentRegistry({ claude: vi.fn(async () => { throw new Error("private path"); }) });
    const claude = (await registry.list()).find((agent) => agent.id === "claude");
    expect(claude.status).toEqual({ state: "error", available: false, configured: false, running: false, error: "Status check failed" });
    expect(JSON.stringify(claude)).not.toContain("private path");
  });

  it("rejects launch and adoption when no safe process hook exists", async () => {
    const registry = createAgentRegistry({});
    await expect(registry.performAction("claude", "launch")).resolves.toMatchObject({ ok: false, code: "unsupported_action" });
    await expect(registry.performAction("claude", "adopt")).resolves.toMatchObject({ ok: false, code: "unsupported_action" });
    expect(getAgentLifecycle()).toHaveLength(2);
    expect(getAgentLifecycle()[0]).toMatchObject({ agentId: "claude", action: "adopt", status: "unsupported" });
  });

  it("bounds lifecycle storage", () => {
    for (let i = 0; i < 110; i++) recordAgentLifecycle({ agentId: "claude", action: "status", status: "completed", id: `r${i}` });
    const records = getAgentLifecycle();
    expect(records).toHaveLength(100);
    expect(records[0].id).toBe("r109");
    expect(records[99].id).toBe("r10");
  });
});
