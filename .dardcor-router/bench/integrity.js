/**
 * bench/integrity.js — Phase 9 cache-prefix integrity check.
 *
 * Enforces the §10 rule for the `cache-integrity` fixture: compression +
 * translation + routing must leave the cached-prefix bytes byte-identical.
 *
 * The check is built on the EXISTING L0 contract (open-sse/cache/l0.js):
 *  - `begin(body)` snapshots the cacheable prefix (top-level system/tools and
 *    the message prefix) and hashes it BEFORE compression runs. Those hashes
 *    are the "before" bytes.
 *  - The L0 input is built to match chatCore's ACTUAL snapshot point: a
 *    structured clone of the fixture request with enabled caveman/ponytail
 *    injectors applied (harness-identical defaults), the exact body chatCore
 *    hands to beginCacheOrchestration. The replay still receives the RAW
 *    fixture request so chatCore applies injection exactly once.
 *  - The turn is replayed through the real pipeline (harness), which captures
 *    the OUTBOUND body at the executor fetch boundary — i.e. after
 *    compression and translation — and runs `finish()` on it, the real
 *    structural-compression interlock.
 *  - "after" hashes of the same regions on the outbound body must equal the
 *    "before" hashes (byte identity). `info.restored` records whether the
 *    interlock had to restore a mutated prefix (an observation, never a pass
 *    for a mutated region).
 *  - Cross-turn: the fixture's stable regions (system, tools, spec document)
 *    must be byte-identical across the fixture's `turnWithFullStablePrefix`
 *    turns, and the only churn must be the final user message.
 *
 * Never fakes a pass: if L0 returns null (no cacheable shape), the pipeline
 * failed, or no outbound body was captured, the turn is INCONCLUSIVE (a
 * failure), never "passed".
 */

import crypto from "node:crypto";
import { begin as l0Begin, finish as l0Finish } from "../open-sse/cache/l0.js";
import { injectCaveman } from "../open-sse/rtk/caveman.js";
import { injectPonytail } from "../open-sse/rtk/ponytail.js";
import { FORMATS } from "../open-sse/translator/formats.js";

/** sha256 of JSON.stringify(value) — matches open-sse/cache/l0.js contentHash. */
export function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

/** Structural extraction of the fixture's stable regions from a chat body. */
export function extractRegions(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const systemMsg = messages.find((m) => m?.role === "system") ?? null;
  const firstUser = messages.find((m) => m?.role === "user") ?? null;
  const prefix = messages.length > 1 ? messages.slice(0, -1) : [];
  return {
    system: systemMsg, // role==="system" message (OpenAI shape) or null
    tools: Array.isArray(body?.tools) ? body.tools : null,
    spec: firstUser, // the frozen first user message (the "t1 spec document")
    prefix,
    last: messages[messages.length - 1] ?? null,
  };
}

/** sha256 per structural region (null when the region is absent). */
export function regionHashes(body) {
  const r = extractRegions(body);
  return {
    system: r.system ? sha256Json(r.system) : null,
    tools: r.tools ? sha256Json(r.tools) : null,
    spec: r.spec ? sha256Json(r.spec) : null,
    prefix: r.prefix.length ? sha256Json(r.prefix) : null,
    last: r.last ? sha256Json(r.last) : null,
  };
}

/** Map a fixture stable-region name onto its extractRegions key. */
export function regionKeyForName(name) {
  const n = String(name || "").toLowerCase();
  if (n === "system") return "system";
  if (n === "tools") return "tools";
  if (n.includes("spec") || n.includes("document")) return "spec";
  return null; // unknown region → ignored (reported as not-applicable)
}

/** Hash of the outbound messages prefix, clamped to L0's protected length. */
function prefixHashOf(body, prefixLen) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (prefixLen > 0 && messages.length >= prefixLen) {
    return sha256Json(messages.slice(0, prefixLen));
  }
  return null;
}

/**
 * Mirror of bench/harness.js settingsFromConfig injector knobs: enabled
 * booleans with levels defaulting to "full". Kept in sync so the L0 snapshot
 * here sees the same injection as chatCore's replay path.
 */
function injectorSettings(config) {
  const s = config?.settings ?? {};
  return {
    cavemanEnabled: !!s.cavemanEnabled,
    cavemanLevel: s.cavemanLevel || "full",
    ponytailEnabled: !!s.ponytailEnabled,
    ponytailLevel: s.ponytailLevel || "full",
  };
}

/**
 * Build the body L0 must snapshot: a structured clone of the fixture request
 * with enabled caveman/ponytail injectors applied, matching chatCore's actual
 * pre-L0 snapshot point (chatCore.js: injectCaveman/injectPonytail run on the
 * final-format body BEFORE beginCacheOrchestration). Bench fixtures are
 * OpenAI-shaped and the mock upstream is OpenAI-compatible, so the final
 * format is FORMATS.OPENAI — the same single-format world the harness runs.
 * The original request is never mutated: the replay path still receives the
 * raw clone and chatCore applies injection exactly once.
 */
export function buildL0Input(request, config) {
  const body = structuredClone(request || {});
  const { cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel } = injectorSettings(config);
  if (cavemanEnabled && cavemanLevel) injectCaveman(body, FORMATS.OPENAI, cavemanLevel);
  if (ponytailEnabled && ponytailLevel) injectPonytail(body, FORMATS.OPENAI, ponytailLevel);
  return body;
}

/**
 * Check one turn of the cache-integrity fixture.
 * @param {object} opts - { turn, fixture, config, replay }
 *   replay(body) => Promise<{ ok, error, outboundBody, events }> (harness
 *   replayTurn; body is the RAW fixture request — chatCore applies injection)
 * @returns {object} {
 *   turnId, inconclusive, regions: [{name, identical, before, after}],
 *   restored, passed, outboundStructural: {system, tools, spec, last}
 * }
 */
export async function checkTurnIntegrity({ turn, fixture, config, replay }) {
  const result = {
    turnId: turn.id,
    inconclusive: null,
    regions: [],
    restored: null,
    passed: false,
    outboundStructural: { system: null, tools: null, spec: null, last: null },
  };

  // chatCore's L0 snapshot point is AFTER caveman/ponytail injection and
  // BEFORE any compressor (chatCore.js lines 243-265). Build that exact body
  // for the comparison state; the replay below still gets the RAW fixture
  // clone so chatCore applies injection exactly once on its own path.
  const l0Input = buildL0Input(turn.request, config);
  const state = l0Begin(l0Input);
  if (!state) {
    result.inconclusive = "l0.begin returned null (no cacheable messages[] shape)";
    return result;
  }

  const out = await replay(structuredClone(turn.request || {}));
  if (!out || !out.ok) {
    result.inconclusive = `pipeline failed: ${out?.error || "replay returned no result"}`;
    return result;
  }
  if (!out.outboundBody || typeof out.outboundBody !== "object") {
    result.inconclusive = "no outbound body captured at the executor fetch boundary (integrity cannot be asserted)";
    return result;
  }
  const outbound = out.outboundBody;
  result.outboundStructural = regionHashes(outbound);

  // "Before" bytes = L0's pre-compression snapshot, taken from the injected
  // clone built above — the same point chatCore reaches
  // beginCacheOrchestration (after caveman/ponytail, before any compressor).
  // The provider's cached prefix is exactly these bytes.
  const beforeHashes = regionHashes({
    system: state.snapshot.system,
    tools: state.snapshot.tools,
    messages: state.snapshot.messages,
  });
  // Fallback for regions absent from a short-prefix snapshot. Use the
  // post-injection clone so system bytes compare against what the pipeline
  // actually cached — injectors only touch system content, so spec/user
  // fallbacks are unaffected.
  const inboundHashes = regionHashes(l0Input);

  const stableRegions = fixture?.expect?.stableRegions ?? ["system", "tools"];
  const seenKeys = new Set();
  for (const name of stableRegions) {
    const key = regionKeyForName(name);
    if (!key) {
      result.regions.push({ name, identical: null, before: null, after: null, note: "unknown region name — not-applicable" });
      continue;
    }
    seenKeys.add(key);
    // Short prefixes (e.g. the fixture's t1) may not contain a region in the
    // snapshot; fall back to the inbound structural hash. Safe for user/spec
    // messages — injectors only touch system content.
    const before = beforeHashes[key] ?? inboundHashes[key];
    const after = key === "prefix"
      ? prefixHashOf(outbound, state.prefixLen)
      : (extractRegions(outbound)[key] ? sha256Json(extractRegions(outbound)[key]) : null);
    if (before === undefined || before === null) {
      result.regions.push({ name, identical: null, before, after, note: "region absent in the pre-compression snapshot" });
      continue;
    }
    result.regions.push({ name, identical: before === after, before, after });
  }
  // tools is a top-level region L0 always hashes when present — ensure it is
  // covered even when the fixture does not list it.
  if (state.integrity?.tools != null && !seenKeys.has("tools")) {
    const after = extractRegions(outbound).tools ? sha256Json(extractRegions(outbound).tools) : null;
    result.regions.push({ name: "tools", identical: beforeHashes.tools === after, before: beforeHashes.tools, after });
  }

  // Exercise the real L0 finish interlock on the captured outbound body.
  try {
    const fin = l0Finish(outbound, state, {
      cacheKey: "bench-integrity",
      provider: "mock",
      model: turn?.request?.model || "mock/model",
      onCacheEvent: null,
    });
    result.restored = Boolean(fin?.info?.restored);
  } catch {
    result.restored = null;
    result.inconclusive = result.inconclusive || "l0.finish threw on the outbound body";
  }

  // Pass requires every compared region byte-identical AND at least one region
  // actually compared — absent regions are neutral, a vacuous pass is not.
  result.passed = !result.inconclusive
    && result.regions.some((r) => r.identical === true)
    && result.regions.every((r) => r.identical !== false);
  return result;
}

/**
 * Run the full cache-integrity fixture check.
 * @param {object} opts - { fixture, config, replay }
 * @returns {object} {
 *   checked: true, passed, turns: [checkTurnIntegrity results],
 *   crossTurn: { stable: boolean, regions: {system: boolean|null, tools: boolean|null,
 *   spec: boolean|null} (true=observed & stable, false=observed & divergent,
 *   null=never observed), tailOnlyChurn: boolean|null },
 *   restored: boolean
 * }
 */
export async function checkFixtureIntegrity({ fixture, config, replay }) {
  const turns = [];
  for (const turn of fixture.turns) {
    turns.push(await checkTurnIntegrity({ turn, fixture, config, replay }));
  }
  const allTurnsPass = turns.length > 0 && turns.every((t) => !t.inconclusive && t.passed);

  // Cross-turn stability of the fixture's stable regions across the
  // turnWithFullStablePrefix turns. The growing message prefix is NOT compared
  // here — only the frozen regions, which must stay byte-identical.
  const stableIds = fixture?.expect?.turnWithFullStablePrefix ?? [];
  const stableTurns = turns.filter((t) => stableIds.includes(t.turnId));
  const crossSets = { system: new Set(), tools: new Set(), spec: new Set() };
  for (const t of stableTurns) {
    for (const key of ["system", "tools", "spec"]) {
      const h = t.outboundStructural?.[key];
      if (h !== null && h !== undefined) crossSets[key].add(h);
    }
  }
  const crossStable = Object.values(crossSets).some((s) => s.size > 0)
    && Object.values(crossSets).every((s) => s.size <= 1);
  const crossRegions = Object.fromEntries(
    // Per-region verdict: true when observed and byte-stable, false when
    // observed and divergent, null when never observed (no vacuous true).
    Object.entries(crossSets).map(([k, s]) => [k, s.size === 0 ? null : s.size === 1])
  );

  // Tail-only churn: consecutive full-prefix turns share every stable region
  // and differ in the final user message.
  let tailOnlyChurn = null;
  if (stableTurns.length > 1) {
    tailOnlyChurn = true;
    for (let i = 1; i < stableTurns.length; i++) {
      const prev = stableTurns[i - 1].outboundStructural;
      const cur = stableTurns[i].outboundStructural;
      const stableSame = ["system", "tools", "spec"].every((k) =>
        (prev[k] === null && cur[k] === null) || prev[k] === cur[k]
      );
      const tailDiffers = prev.last !== cur.last;
      if (!stableSame || !tailDiffers) { tailOnlyChurn = false; break; }
    }
  }

  return {
    checked: true,
    passed: allTurnsPass && crossStable,
    turns,
    crossTurn: { stable: crossStable, regions: crossRegions, tailOnlyChurn },
    restored: turns.some((t) => t.restored === true),
  };
}
