import { EventEmitter } from "events";

// Stable, namespaced event names for the unified dashboard event bus.
// Stats events are change notifications (client refetches via REST); console
// events carry payloads.
export const EVENT_NAMES = Object.freeze({
  STATS_UPDATE: "stats:update",
  STATS_PENDING: "stats:pending",
  CONSOLE_LINES: "console:lines",
  CONSOLE_CLEAR: "console:clear",
  CACHE_PROBE: "cache:probe",
  CACHE_STATS_UPDATE: "cache:stats:update",
  TOKEN_SAVER: "token-saver:event",
});

export const EVENT_TYPES = Object.freeze({
  STATS: "stats",
  CONSOLE: "console",
  CACHE: "cache",
  SAVER: "saver",
});

const MAX_LISTENERS = 50;

// Global bus survives Next.js dev hot-reload (module state resets on reload).
if (!global._dardcorEventBus) {
  global._dardcorEventBus = new EventEmitter();
  global._dardcorEventBus.setMaxListeners(MAX_LISTENERS);
}

export const eventBus = global._dardcorEventBus;

// Subscribe with duplicate protection and a visible cap. Returns an unsub fn.
// The cap warns instead of silently growing, so a leaked route connection
// shows up in logs rather than being masked.
export function subscribe(eventName, handler) {
  if (eventBus.listenerCount(eventName) >= MAX_LISTENERS) {
    console.warn(`[eventBus] listener cap (${MAX_LISTENERS}) reached for "${eventName}" — dropping new subscriber`);
    return () => {};
  }
  if (!eventBus.listeners(eventName).includes(handler)) {
    eventBus.on(eventName, handler);
  }
  return () => eventBus.off(eventName, handler);
}

export function publishStatsEvent(type) {
  eventBus.emit(`stats:${type}`);
}

export function publishConsoleLines(lines) {
  eventBus.emit(EVENT_NAMES.CONSOLE_LINES, lines);
}

export function publishConsoleClear() {
  eventBus.emit(EVENT_NAMES.CONSOLE_CLEAR);
}

// Prompt-cache orchestration events (cache_probe observations + authoritative
// provider cache_read/cache_creation usage). No-op when no listener is wired.
export function publishCacheEvent(event) {
  eventBus.emit(EVENT_NAMES.CACHE_PROBE, event);
  // Persistence is deliberately detached: telemetry cannot delay or fail a request.
  void import("./db/repos/metricsRepo.js")
    .then(async ({ buildCacheEventMetricRows, saveMetrics }) => {
      const rows = buildCacheEventMetricRows(event);
      if (rows.length && await saveMetrics(rows)) publishCacheStatsUpdate();
    })
    .catch(() => {});
}

export function publishCacheStatsUpdate() {
  eventBus.emit(EVENT_NAMES.CACHE_STATS_UPDATE);
}

// Token-saver telemetry (Caveman/Ponytail/RTK/Headroom/PXPIPE/provider dispatch).
// No-op when no listener is wired; publishers are fail-open.
export function publishTokenSaverEvent(event) {
  eventBus.emit(EVENT_NAMES.TOKEN_SAVER, event);
}
