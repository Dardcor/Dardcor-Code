// Phase 3 unified event bus: typed publication, listener hygiene, producer adapters.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  eventBus,
  subscribe,
  publishStatsEvent,
  publishConsoleLines,
  publishConsoleClear,
  publishCacheStatsUpdate,
  EVENT_NAMES,
} from "../../src/lib/eventBus.js";

const cleanups = [];

afterEach(() => {
  for (const unsub of cleanups) unsub();
  cleanups.length = 0;
});

function trackUnsub(unsub) {
  cleanups.push(unsub);
  return unsub;
}

describe("eventBus", () => {
  it("publishes a stats event to its subscribers", () => {
    const handler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.STATS_UPDATE, handler));

    publishStatsEvent("update");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("publishes console lines with their payload", () => {
    const handler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.CONSOLE_LINES, handler));

    publishConsoleLines(["line one", "line two"]);

    expect(handler).toHaveBeenCalledWith(["line one", "line two"]);
  });

  it("publishes a console clear event", () => {
    const handler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.CONSOLE_CLEAR, handler));

    publishConsoleClear();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("publishes cache stats invalidation events", () => {
    const handler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.CACHE_STATS_UPDATE, handler));
    publishCacheStatsUpdate();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps typed events isolated: a stats subscriber does not see console events", () => {
    const statsHandler = vi.fn();
    const consoleHandler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.STATS_UPDATE, statsHandler));
    trackUnsub(subscribe(EVENT_NAMES.CONSOLE_LINES, consoleHandler));

    publishConsoleLines(["console-only"]);
    expect(statsHandler).not.toHaveBeenCalled();
    expect(consoleHandler).toHaveBeenCalledTimes(1);

    publishStatsEvent("update");
    expect(statsHandler).toHaveBeenCalledTimes(1);
    expect(consoleHandler).toHaveBeenCalledTimes(1); // untouched by the stats event
  });

  it("does not register duplicate listeners for the same handler", () => {
    const handler = vi.fn();
    const unsub1 = subscribe(EVENT_NAMES.STATS_UPDATE, handler);
    const unsub2 = subscribe(EVENT_NAMES.STATS_UPDATE, handler);

    expect(eventBus.listenerCount(EVENT_NAMES.STATS_UPDATE)).toBe(1);

    publishStatsEvent("update");
    expect(handler).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
    expect(eventBus.listenerCount(EVENT_NAMES.STATS_UPDATE)).toBe(0);
  });

  it("removes the listener on unsubscribe", () => {
    const handler = vi.fn();
    const unsub = subscribe(EVENT_NAMES.STATS_UPDATE, handler);

    unsub();
    publishStatsEvent("update");

    expect(handler).not.toHaveBeenCalled();
  });

  it("usageRepo schedules stats events onto the bus", async () => {
    const handler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.STATS_PENDING, handler));

    const { trackPendingRequest, statsEmitter } = await import("../../src/lib/db/repos/usageRepo.js");
    const legacy = vi.fn();
    statsEmitter.on("pending", legacy);
    trackPendingRequest("model-x", "provider-y", "conn-1", true);

    await new Promise((r) => setTimeout(r, 250));
    expect(handler).toHaveBeenCalled();
    expect(legacy).toHaveBeenCalled(); // legacy emitter preserved
    statsEmitter.off("pending", legacy);
  });

  it("consoleLogBuffer clear publishes console:clear onto the bus", async () => {
    const handler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.CONSOLE_CLEAR, handler));

    const { clearConsoleLogs, getConsoleEmitter } = await import("../../src/lib/consoleLogBuffer.js");
    const legacy = vi.fn();
    getConsoleEmitter().on("clear", legacy);
    clearConsoleLogs();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledTimes(1); // legacy emitter preserved
    getConsoleEmitter().off("clear", legacy);
  });

  it("consoleLogBuffer publishes flushed lines onto the bus", async () => {
    const handler = vi.fn();
    trackUnsub(subscribe(EVENT_NAMES.CONSOLE_LINES, handler));

    const { initConsoleLogCapture, getConsoleEmitter } = await import("../../src/lib/consoleLogBuffer.js");
    const legacy = vi.fn();
    getConsoleEmitter().on("lines", legacy);
    initConsoleLogCapture();
    console.log("eventBus-producer-test-line");

    await new Promise((r) => setTimeout(r, 250));
    expect(handler).toHaveBeenCalled();
    expect(legacy).toHaveBeenCalled(); // legacy emitter preserved
    getConsoleEmitter().off("lines", legacy);
  });
});
