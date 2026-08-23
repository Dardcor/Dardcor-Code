// Phase 7: per provider+connection circuit breaker — hot-path in-memory health cache.
// CLOSED → (FAILURE_THRESHOLD fallback-worthy failures within WINDOW_MS) → OPEN
//       → (COOLDOWN_MS) → HALF_OPEN → exactly one probe admitted:
//            probe success → CLOSED, probe failure → OPEN (new cooldown).
// No persistence: state lives for the process lifetime only.
// Constants live here (not errorConfig.js) so a parallel worker can own errorConfig.js.

export const BREAKER_CONFIG = {
  FAILURE_THRESHOLD: 5,
  WINDOW_MS: 60 * 1000,
  COOLDOWN_MS: 30 * 1000,
};

const BreakerState = {
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half_open",
};

// key (`provider:connectionId`) → { state, failures[], openedAt, probeInFlight, probeAt }
const circuits = new Map();

function key(provider, connectionId) {
  return `${provider}:${connectionId}`;
}

function entryFor(k) {
  let entry = circuits.get(k);
  if (!entry) {
    entry = { state: BreakerState.CLOSED, failures: [], openedAt: null, probeInFlight: false, probeAt: 0 };
    circuits.set(k, entry);
  }
  return entry;
}

// Lazy transitions evaluated on every read.
function settle(entry, t) {
  // Cooldown elapsed → OPEN becomes HALF_OPEN (next probe decides).
  if (entry.state === BreakerState.OPEN && t - entry.openedAt >= BREAKER_CONFIG.COOLDOWN_MS) {
    entry.state = BreakerState.HALF_OPEN;
    entry.openedAt = null;
    entry.probeInFlight = false;
    entry.probeAt = 0;
  }
  // Self-heal: a probe admitted but never reported (e.g. STT/TTS handlers record
  // no success/failure callback) is released after the failure window so the
  // circuit can be probed again instead of staying locked.
  if (entry.state === BreakerState.HALF_OPEN && entry.probeInFlight && t - entry.probeAt > BREAKER_CONFIG.WINDOW_MS) {
    entry.probeInFlight = false;
  }
}

/**
 * Should this connection be skipped at selection time?
 * True when the circuit is OPEN, or HALF_OPEN with a probe already in flight
 * (exactly one half-open probe may be admitted).
 */
export function isCircuitBlocked(provider, connectionId) {
  if (!provider || !connectionId) return false;
  const entry = entryFor(key(provider, connectionId));
  settle(entry, Date.now());
  if (entry.state === BreakerState.OPEN) return true;
  return entry.state === BreakerState.HALF_OPEN && entry.probeInFlight;
}

/**
 * Admit the single half-open probe. No-op unless this circuit is HALF_OPEN
 * with no probe in flight. Call only when the connection is actually selected.
 */
export function admitProbe(provider, connectionId) {
  if (!provider || !connectionId) return;
  const entry = entryFor(key(provider, connectionId));
  settle(entry, Date.now());
  if (entry.state === BreakerState.HALF_OPEN && !entry.probeInFlight) {
    entry.probeInFlight = true;
    entry.probeAt = Date.now();
  }
}

/**
 * Release an admitted probe without changing state (used when a request finishes
 * with a non-fallback-worthy error, so the circuit can be probed again).
 */
export function releaseProbe(provider, connectionId) {
  if (!provider || !connectionId) return;
  const entry = entryFor(key(provider, connectionId));
  settle(entry, Date.now());
  entry.probeInFlight = false;
}

/**
 * Record a fallback-worthy failure.
 * - CLOSED: accumulate in the rolling window; at threshold → OPEN.
 * - HALF_OPEN: probe failed → reopen immediately.
 * - OPEN: ignored (cooldown governs reopening).
 */
export function recordFailure(provider, connectionId) {
  if (!provider || !connectionId) return;
  const entry = entryFor(key(provider, connectionId));
  const t = Date.now();
  entry.probeInFlight = false;
  if (entry.state === BreakerState.OPEN) return;
  if (entry.state === BreakerState.HALF_OPEN) {
    entry.state = BreakerState.OPEN;
    entry.openedAt = t;
    entry.failures = [];
    return;
  }
  entry.failures.push(t);
  entry.failures = entry.failures.filter((f) => t - f < BREAKER_CONFIG.WINDOW_MS);
  if (entry.failures.length >= BREAKER_CONFIG.FAILURE_THRESHOLD) {
    entry.state = BreakerState.OPEN;
    entry.openedAt = t;
    entry.failures = [];
  }
}

/**
 * Record a successful request.
 * - HALF_OPEN: probe succeeded → CLOSED.
 * - CLOSED: reset the rolling failure window.
 * - OPEN: ignored (only cooldown → HALF_OPEN probe decides).
 */
export function recordSuccess(provider, connectionId) {
  if (!provider || !connectionId) return;
  const entry = entryFor(key(provider, connectionId));
  entry.probeInFlight = false;
  entry.failures = [];
  if (entry.state === BreakerState.HALF_OPEN) entry.state = BreakerState.CLOSED;
}
