// GET /api/events — unified SSE endpoint: type filter, initial state, keepalive, cleanup.
import { describe, it, expect, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getActiveRequests: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/usageDb", () => ({ getActiveRequests: mocks.getActiveRequests }));

const { GET } = await import("../../src/app/api/events/route.js");
const {
  eventBus,
  publishStatsEvent,
  publishConsoleLines,
  publishConsoleClear,
  publishCacheStatsUpdate,
  EVENT_NAMES,
} = await import("../../src/lib/eventBus.js");

function makeRequest(type, signal) {
  return {
    nextUrl: {
      searchParams: new URL(`http://localhost/api/events?type=${type}`).searchParams,
    },
    signal,
  };
}

async function readFrame(reader, dec, timeoutMs = 1000) {
  const read = reader.read();
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("no frame within timeout")), timeoutMs)
  );
  const { value, done } = await Promise.race([read, timer]);
  if (done) return null;
  return dec.decode(value);
}

function parseFrame(frame) {
  expect(frame.startsWith("data: ")).toBe(true);
  expect(frame.endsWith("\n\n")).toBe(true);
  return JSON.parse(frame.slice("data: ".length));
}

describe("GET /api/events", () => {
  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it("rejects an unsupported type with 400", async () => {
    const res = await GET(makeRequest("bogus"));
    expect(res.status).toBe(400);
    expect(mocks.json).toHaveBeenCalledWith(expect.anything(), { status: 400 });
  });

  it("rejects a missing type with 400", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it("sends initial console state and streams console line/clear frames", async () => {
    mocks.getActiveRequests.mockResolvedValue({ activeRequests: [], recentRequests: [], errorProvider: "" });
    const res = await GET(makeRequest("console"));
    const reader = res.body.getReader();
    const dec = new TextDecoder();

    expect(parseFrame(await readFrame(reader, dec))).toEqual({ type: "init", logs: [] });

    publishConsoleLines(["hello"]);
    expect(parseFrame(await readFrame(reader, dec))).toEqual({ type: "lines", lines: ["hello"] });

    publishConsoleClear();
    expect(parseFrame(await readFrame(reader, dec))).toEqual({ type: "clear" });

    await reader.cancel();
  });

  it("sends initial stats state and streams stats update/pending frames", async () => {
    mocks.getActiveRequests.mockResolvedValue({
      activeRequests: [{ model: "m", provider: "p", count: 1 }],
      recentRequests: [],
      errorProvider: "",
    });
    const res = await GET(makeRequest("stats"));
    const reader = res.body.getReader();
    const dec = new TextDecoder();

    expect(parseFrame(await readFrame(reader, dec))).toEqual({
      type: "init",
      data: { activeRequests: [{ model: "m", provider: "p", count: 1 }], recentRequests: [], errorProvider: "" },
    });

    publishStatsEvent("update");
    expect(parseFrame(await readFrame(reader, dec))).toEqual({ type: "stats", subtype: "update" });

    publishStatsEvent("pending");
    expect(parseFrame(await readFrame(reader, dec))).toEqual({ type: "stats", subtype: "pending" });

    await reader.cancel();
  });

  it("streams cache stats invalidation alongside existing cache events", async () => {
    const res = await GET(makeRequest("cache"));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    expect(await readFrame(reader, dec)).toBe(": connected\n\n");

    publishCacheStatsUpdate();
    expect(parseFrame(await readFrame(reader, dec))).toEqual({ type: "cache", subtype: "stats:update" });
    await reader.cancel();
  });

  it("filters: a stats connection does not receive console events", async () => {
    mocks.getActiveRequests.mockResolvedValue({ activeRequests: [], recentRequests: [], errorProvider: "" });
    const res = await GET(makeRequest("stats"));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    await readFrame(reader, dec); // drain init

    publishConsoleLines(["should-not-appear"]);
    publishConsoleClear();

    const raced = await Promise.race([
      reader.read().then(() => "frame"),
      new Promise((resolve) => setTimeout(() => resolve("quiet"), 120)),
    ]);
    expect(raced).toBe("quiet");
    await reader.cancel();
  });

  it("filters: a console connection does not receive stats events", async () => {
    const res = await GET(makeRequest("console"));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    await readFrame(reader, dec); // drain init

    publishStatsEvent("update");

    const raced = await Promise.race([
      reader.read().then(() => "frame"),
      new Promise((resolve) => setTimeout(() => resolve("quiet"), 120)),
    ]);
    expect(raced).toBe("quiet");
    await reader.cancel();
  });

  it("sends a keepalive ping every 25s and cleans up listeners on abort", async () => {
    vi.useFakeTimers();
    try {
      const ac = new AbortController();
      const res = await GET(makeRequest("console", ac.signal));
      const reader = res.body.getReader();
      const dec = new TextDecoder();

      let { value } = await reader.read();
      expect(dec.decode(value)).toContain('"type":"init"');

      await vi.advanceTimersByTimeAsync(25000);
      ({ value } = await reader.read());
      expect(dec.decode(value)).toBe(": ping\n\n");

      expect(eventBus.listenerCount(EVENT_NAMES.CONSOLE_LINES)).toBe(1);
      ac.abort();
      expect(eventBus.listenerCount(EVENT_NAMES.CONSOLE_LINES)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up listeners when the client cancels the stream", async () => {
    const res = await GET(makeRequest("console"));
    const reader = res.body.getReader();
    await readFrame(reader, new TextDecoder()); // drain init

    expect(eventBus.listenerCount(EVENT_NAMES.CONSOLE_LINES)).toBe(1);
    await reader.cancel();
    expect(eventBus.listenerCount(EVENT_NAMES.CONSOLE_LINES)).toBe(0);
  });
});
