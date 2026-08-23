/**
 * tests/unit/bench-harness.test.js — Phase 9 focused unit test for the
 * runtime adapter in bench/harness.js: the installMockFetch → loadOpenSse
 * ordering guard (fail-closed, no network), the zero-chunk TTFB contract, and
 * the active-provider isolation the integrity replay depends on.
 *
 * Written but intentionally NOT run in this phase; the runner executes it.
 * Importing harness.js is side-effect-light (env vars only); none of these
 * tests call loadOpenSse after installMockFetch, so no open-sse module is
 * ever loaded and no network is touched.
 */

import { describe, it, expect, afterAll } from "vitest";
import { installMockFetch, loadOpenSse, setActiveProvider, drainResponseBody } from "../../bench/harness.js";
import { MockProvider } from "../../bench/mockProvider.js";

const CHAT_URL = "http://mock.test/v1/chat/completions";
const BODY = { model: "mock/gpt-5-mini", messages: [{ role: "user", content: "hi" }] };

describe("bench/harness.js ordering guard", () => {
  it("loadOpenSse fails closed when installMockFetch has not run", () => {
    expect(() => loadOpenSse()).toThrow(/installMockFetch/);
  });
});

describe("bench/harness.js drainResponseBody", () => {
  it("returns null TTFB for a zero-chunk stream (a first byte that never arrived is not measured)", async () => {
    const res = new Response(new ReadableStream({ start(c) { c.close(); } }));
    const { latencyMs, ttfbMs } = await drainResponseBody(res);
    expect(ttfbMs).toBe(null);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns null TTFB for a body-less response", async () => {
    const res = new Response(null);
    const { ttfbMs } = await drainResponseBody(res);
    expect(ttfbMs).toBe(null);
  });

  it("captures TTFB on the first real chunk", async () => {
    const res = new Response("hello");
    const { latencyMs, ttfbMs } = await drainResponseBody(res);
    expect(ttfbMs).not.toBe(null);
    expect(ttfbMs).toBeGreaterThanOrEqual(0);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("bench/harness.js fetch wrapper", () => {
  const restores = [];
  afterAll(() => { for (const r of restores) r(); });

  it("serves chat completions from the active provider and 404s other URLs", async () => {
    restores.push(installMockFetch());
    setActiveProvider(new MockProvider());
    const chat = await fetch(CHAT_URL, { method: "POST", body: JSON.stringify(BODY) });
    expect(chat.status).toBe(200);
    const other = await fetch("http://mock.test/v1/models", { method: "GET" });
    expect(other.status).toBe(404);
  });

  it("setActiveProvider switches which provider serves fetches (integrity isolation)", async () => {
    restores.push(installMockFetch());
    const a = new MockProvider();
    const b = new MockProvider();
    setActiveProvider(a);
    await fetch(CHAT_URL, { method: "POST", body: JSON.stringify(BODY) });
    expect(a.requestCount).toBe(1);
    setActiveProvider(b);
    await fetch(CHAT_URL, { method: "POST", body: JSON.stringify(BODY) });
    expect(a.requestCount).toBe(1); // stale provider must not serve the second call
    expect(b.requestCount).toBe(1);
  });
});
