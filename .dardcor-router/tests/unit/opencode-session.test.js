import { describe, it, expect, beforeEach, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
  default: (...args) => fetchMock(...args),
}));

import { getExecutor } from "../../open-sse/executors/index.js";
import {
  OPENCODE_SESSION_RE,
  OPENCODE_REQUEST_RE,
  generateSessionId,
  generateRequestId,
  translateSessionId,
  stableSessionId,
} from "../../open-sse/executors/opencode.js";

function makeCredentials(overrides = {}) {
  return {
    connectionId: "conn_test",
    rawHeaders: {},
    ...overrides,
  };
}

function prepare(executor, overrides = {}) {
  const credentials = overrides.credentials || makeCredentials();
  const prepared = executor.prepareRequestCredentials({
    body: overrides.body || { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] },
    credentials,
    providerSessionId: overrides.providerSessionId ?? "conversation-a",
    clientTool: overrides.clientTool ?? "claude",
  });
  return { credentials, prepared };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

describe("OpenCode Free Session ID Format", () => {
  it("generates session IDs matching OpenCode canonical format (ses_ + 12 hex + 14 base62)", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(id).toMatch(OPENCODE_SESSION_RE);
      expect(id).toHaveLength(30);
    }
  });

  it("generates request IDs matching OpenCode canonical format (msg_ + 12 hex + 14 base62)", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateRequestId();
      expect(id).toMatch(OPENCODE_REQUEST_RE);
      expect(id).toHaveLength(30);
    }
  });

  it("translates arbitrary sessions into valid OpenCode session format", () => {
    const inputs = [
      "claude:550e8400-e29b-41d4-a716-446655440000",
      "antigravity:conv-abc-123",
      "session-from-codex",
      "12345",
      "",
    ];
    for (const raw of inputs) {
      const translated = translateSessionId(raw, "claude");
      expect(translated).toMatch(OPENCODE_SESSION_RE);
      expect(translated).toHaveLength(30);
    }
  });

  it("preserves already-valid OpenCode sessions without re-hashing", () => {
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    expect(translateSessionId(valid)).toBe(valid);
    expect(translateSessionId(`  ${valid}  `)).toBe(valid);
  });
});

describe("OpenCode Free Executor Session Resolution", () => {
  it("uses request-local session credentials without mutating source credentials", () => {
    const executor = getExecutor("opencode");
    const { credentials, prepared } = prepare(executor);

    expect(executor.constructor.name).toBe("OpenCodeExecutor");
    expect(prepared).not.toBe(credentials);
    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(credentials).not.toHaveProperty("_opencodeSession");
  });

  it("preserves valid native x-opencode-session header case-insensitively", () => {
    const executor = getExecutor("opencode");
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "X-OpenCode-Session": ` ${valid} ` } }),
    });

    expect(prepared._opencodeSession).toBe(valid);
  });

  it("translates invalid native x-opencode-session header into a valid session", () => {
    const executor = getExecutor("opencode");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "x-opencode-session": "invalid-session-uuid" } }),
    });

    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(prepared._opencodeSession).not.toBe("invalid-session-uuid");
  });

  it("translates conversation session deterministically", () => {
    const executor = getExecutor("opencode");
    const first = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeSession;
    const second = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeSession;

    expect(first).toBe(second);
    expect(first).toMatch(OPENCODE_SESSION_RE);
  });

  it("adds the valid session header to fetch requests", async () => {
    const executor = getExecutor("opencode");
    const credentials = makeCredentials();
    const result = await executor.execute({
      model: "muse-spark-1.3-contributor-free",
      body: { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] },
      stream: false,
      credentials,
      providerSessionId: "conversation-fetch-test",
      clientTool: "claude",
    });

    expect(result.headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(fetchMock.mock.calls[0][1].headers["Authorization"]).toBe("Bearer public");
  });
});

describe("OpenCode Free User-Agent Validation", () => {
  it("defaults User-Agent to opencode/1.18.31 for non-opencode downstream clients", () => {
    const executor = getExecutor("opencode");
    const headersNoUa = executor.buildHeaders({});
    expect(headersNoUa["User-Agent"]).toBe("opencode/1.18.31");

    const headersClaude = executor.buildHeaders({ rawHeaders: { "user-agent": "Claude-Code/1.0" } });
    expect(headersClaude["User-Agent"]).toBe("opencode/1.18.31");
  });

  it("replaces bare opencode with versioned opencode/1.18.31 to prevent 403 FreeTierError", () => {
    const executor = getExecutor("opencode");
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode" } });
    expect(headers["User-Agent"]).toBe("opencode/1.18.31");
  });

  it("upgrades outdated opencode versions (< 1.17) to prevent 426 Upgrade Required", () => {
    const executor = getExecutor("opencode");
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/1.15.0" } });
    expect(headers["User-Agent"]).toBe("opencode/1.18.31");
  });

  it("preserves valid opencode versions (>= 1.17)", () => {
    const executor = getExecutor("opencode");
    const headers118 = executor.buildHeaders({
      rawHeaders: { "user-agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14" },
    });
    expect(headers118["User-Agent"]).toBe("opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14");
  });
});

describe("OpenCode Stable Session Reuse", () => {
  it("reuses one stable upstream session instead of minting a new one per request", () => {
    const executor = getExecutor("opencode");
    const creds = { connectionId: "conn-123", rawHeaders: {} };
    const first = stableSessionId(creds);
    const second = stableSessionId(creds);

    expect(first).toMatch(OPENCODE_SESSION_RE);
    expect(second).toBe(first);
  });

  it("isolates stable sessions by downstream identity", () => {
    const first = stableSessionId({ connectionId: "conn-A" });
    const second = stableSessionId({ connectionId: "conn-B" });

    expect(first).not.toBe(second);
  });
});

describe("OpenCode Free Decoy Tools Injection", () => {
  it("applies the full lowercase free-tier fingerprint quartet", () => {
    const executor = getExecutor("opencode");

    const chatNoTools = executor.transformRequest("nemotron-3-ultra-free", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chatNoTools.stream).toBe(true);
    expect(chatNoTools.tool_choice).toBe("none");
    expect(chatNoTools.tools.map((t) => t.function?.name)).toEqual([
      "bash", "glob", "grep", "read",
    ]);
  });
});
