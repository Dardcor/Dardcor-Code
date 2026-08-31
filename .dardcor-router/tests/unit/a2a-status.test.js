import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock modules ───────────────────────────────────────────────────

const mockSettings = {
  requireLogin: false,
  apiKeys: [],
};

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ ...mockSettings })),
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn(async () => "test-machine-id-abc123"),
}));

vi.mock("@/dashboardGuard", () => ({
  canAccessLocalOnlyRoute: vi.fn(async () => true),
}));

vi.mock("@/lib/a2a/adapters", () => ({
  a2aDependencies: {
    listProviders: vi.fn(),
    listModels: vi.fn(),
    getQuotaSnapshot: vi.fn(),
    getCurrentStatus: vi.fn(),
    getHealth: vi.fn(),
    getCostSummary: vi.fn(),
  },
}));

// ── Import after mocks ─────────────────────────────────────────────

let recordTask, GET;

beforeEach(async () => {
  vi.resetModules();

  const mod = await import("@/app/api/a2a/status/route.js");
  recordTask = mod.recordTask;
  GET = mod.GET;
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Reset mock implementations set via mockResolvedValue in individual tests
  const guard = await import("@/dashboardGuard");
  guard.canAccessLocalOnlyRoute.mockResolvedValue(true);
  const localDb = await import("@/lib/localDb");
  localDb.getSettings.mockResolvedValue({ ...mockSettings });
  delete globalThis.__dardcor-codeA2aTasks;
});

// ── Helpers ────────────────────────────────────────────────────────

function makeRequest(overrides = {}) {
  return {
    headers: new Map([
      ["x-forwarded-proto", "http"],
      ["host", "localhost:21128"],
      ...Object.entries(overrides.headers || {}),
    ]),
    get(key) {
      return this.headers.get(key) || null;
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("A2A status API", () => {
  it("returns agent card with required fields", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.agentCard).toBeDefined();
    expect(body.agentCard.name).toBe("Dardcor Code Local Agent");
    expect(body.agentCard.version).toBeTruthy();
    expect(body.agentCard.description).toBeTruthy();
    expect(body.agentCard.capabilities).toBeDefined();
    expect(body.agentCard.skills).toBeDefined();
    expect(Array.isArray(body.agentCard.skills)).toBe(true);
  });

  it("returns endpoint and auth state", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.endpoint).toBeDefined();
    expect(body.endpoint.baseUrl).toContain("localhost");
    expect(body.endpoint.endpoint).toContain("/v1");
    expect(body.endpoint.a2aEndpoint).toBe("http://localhost:21128/api/a2a");
    expect(body.endpoint.auth).toBeDefined();
    expect(body.endpoint.auth.machineId).toBe("test-machine-id-abc123");
  });

  it("returns tasks array (empty by default)", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.tasks).toBeDefined();
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks).toHaveLength(0);
  });

  it("returns recorded tasks in reverse chronological order", async () => {
    recordTask({ id: "task_1", name: "first", status: "completed" });
    recordTask({ id: "task_2", name: "second", status: "working" });
    recordTask({ id: "task_3", name: "third", status: "submitted" });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.tasks).toHaveLength(3);
    expect(body.tasks[0].name).toBe("third");   // newest first
    expect(body.tasks[1].name).toBe("second");
    expect(body.tasks[2].name).toBe("first");
  });

  it("task records include required fields", async () => {
    recordTask({ id: "t1", name: "test-task", skillId: "models.list", status: "submitted" });

    const res = await GET(makeRequest());
    const body = await res.json();
    const task = body.tasks[0];

    expect(task.id).toBe("t1");
    expect(task.name).toBe("test-task");
    expect(task.skillId).toBe("models.list");
    expect(task.status).toBe("submitted");
    expect(task.createdAt).toBeTypeOf("number");
  });

  it("task ring buffer caps at 100 entries", async () => {
    for (let i = 0; i < 110; i++) {
      recordTask({ id: `task_${i}`, name: `task-${i}`, status: "submitted" });
    }

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.tasks).toHaveLength(100);
    // The 10 earliest tasks should have been dropped
    expect(body.tasks[99].name).toBe("task-10");  // oldest remaining
    expect(body.tasks[0].name).toBe("task-109");   // newest
  });

  it("advertises skills with required fields", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.agentCard.skills.length).toBeGreaterThan(0);

    expect(body.agentCard.skills.map((skill) => skill.id)).toEqual([
      "providers.list", "models.list", "quota.snapshot", "status.current", "health.current", "cost.summary",
    ]);
    expect(body.agentCard.url).toBe("http://localhost:21128/api/a2a");
    for (const skill of body.agentCard.skills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(Array.isArray(skill.tags)).toBe(true);
    }
  });

  it("declares streaming capability", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.agentCard.capabilities.streaming).toBe(true);
  });

  it("reflects requireLogin setting in auth state", async () => {
    const localDb = await import("@/lib/localDb");
    localDb.getSettings.mockResolvedValue({ requireLogin: true, apiKeys: ["key-1"] });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.endpoint.auth.requireLogin).toBe(true);
    expect(body.endpoint.auth.hasApiKeys).toBe(true);
  });

  it("returns 403 when local-only guard rejects", async () => {
    const guard = await import("@/dashboardGuard");
    guard.canAccessLocalOnlyRoute.mockResolvedValue(false);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Local only");
  });

  it("includes input and output modes on the agent card", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(Array.isArray(body.agentCard.defaultInputModes)).toBe(true);
    expect(body.agentCard.defaultInputModes.length).toBeGreaterThan(0);
    expect(Array.isArray(body.agentCard.defaultOutputModes)).toBe(true);
    expect(body.agentCard.defaultOutputModes.length).toBeGreaterThan(0);
  });
});
