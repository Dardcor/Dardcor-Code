// Shared fail-open emitter for L1/L2/L3 cache events (l0.js keeps its inline
// emitter). Events flow through the optional onCacheEvent callback provided by
// the app handler, which forwards them to /api/events?type=cache.
export function emitCacheEvent(onCacheEvent, event) {
  try {
    const pending = onCacheEvent?.(event);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch { /* stats must never break requests */ }
}
