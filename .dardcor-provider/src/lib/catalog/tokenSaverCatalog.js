// Token-saver / engine catalog. Browser-safe: pure ESM, no node imports, no
// I/O. Consumed by the grouped UI (TokenSaverClient). Every entry carries
// label/id/tier/safeDefault/status/control/detail. "covered" means a real
// runtime path exists in this repo; "unavailable" is never wired to a fake
// toggle — enabling a control is only meaningful when the engine exists.

// status: "covered" | "unavailable"
// tier: one of TOKEN_SAVER_TIERS ids
// safeDefault: true when turning the engine on cannot hurt / it is the
//   recommended default posture when available (not "on by default").
// control: settings key(s) that toggle it, or null when there is no runtime
//   to toggle.
export const TOKEN_SAVER_CATALOG = [
  {
    id: "rtk",
    label: "RTK (request token-killer)",
    tier: "safe-default",
    safeDefault: true,
    status: "covered",
    control: "rtkEnabled",
    coverage: "open-sse/rtk/index.js — in-process tool_result compressor (OpenAI/Claude/Responses/Kiro shapes)",
    detail: "Single pass over tool_result/function_call_output text; fail-open. On by default.",
  },
  {
    id: "lite",
    label: "RTK mode: lite",
    tier: "safe-default",
    safeDefault: true,
    status: "covered",
    control: "rtkMode",
    coverage: "open-sse/rtk/constants.js MODE_MIN_COMPRESS_SIZE.lite (2KB threshold)",
    detail: "Exclusive mode over the same single RTK pass; compresses only blobs >= 2KB. Least aggressive.",
  },
  {
    id: "standard",
    label: "RTK mode: standard",
    tier: "safe-default",
    safeDefault: true,
    status: "covered",
    control: "rtkMode",
    coverage: "open-sse/rtk/constants.js MODE_MIN_COMPRESS_SIZE.standard (500B threshold, default)",
    detail: "Historical behavior; byte-identical to pre-mode RTK. The default mode.",
  },
  {
    id: "aggressive",
    label: "RTK mode: aggressive",
    tier: "full",
    safeDefault: false,
    status: "covered",
    control: "rtkMode",
    coverage: "open-sse/rtk/constants.js MODE_MIN_COMPRESS_SIZE.aggressive (100B threshold)",
    detail: "Exclusive mode over the same single RTK pass; lowers the per-blob threshold to 100B so more blobs are eligible. It does NOT summarize or age conversation turns.",
  },
  {
    id: "codex-responses",
    label: "Codex Responses tool outputs",
    tier: "standard",
    safeDefault: true,
    status: "covered",
    control: "rtkEnabled",
    coverage: "open-sse/rtk/index.js — shape 4 handles { type: \"function_call_output\", output }",
    detail: "Covered WITHIN RTK: compresses Responses-format function_call_output output in-place. Toggled by rtkEnabled; no separate runtime.",
  },
  {
    id: "ccr",
    label: "Cache-control referencing (CCR)",
    tier: "safe-default",
    safeDefault: false,
    status: "unavailable",
    control: null,
    coverage: null,
    detail: "No CCR runtime exists. L0's cache_control breakpoints (open-sse/cache/l0.js) are prompt-cache hint markers inserted on a stable prefix — NOT content-addressed retrieval markers. Existing L0 (breakpoints) and L3 (within-request content-address dedup, open-sse/cache/l3.js) stay as-is; neither is CCR.",
  },
  {
    id: "session-dedup",
    label: "Cross-turn session dedup",
    tier: "safe-default",
    safeDefault: false,
    status: "unavailable",
    control: null,
    coverage: null,
    detail: "UNAVAILABLE: no cross-turn dedup store exists. L3 (open-sse/cache/l3.js) dedups only identical blocks WITHIN one outgoing request (the mutable last message) — this is not a fake cross-turn marker and not a toggle.",
  },
  {
    id: "headroom",
    label: "Headroom external proxy",
    tier: "standard",
    safeDefault: false,
    status: "covered",
    control: "headroomEnabled",
    coverage: "open-sse/rtk/headroom.js — external compression proxy",
    detail: "Requires a reachable HEADROOM_URL endpoint; fails open (skips) when absent. Opt-in.",
  },
  {
    id: "relevance",
    label: "Relevance retrieval",
    tier: "standard",
    safeDefault: false,
    status: "unavailable",
    control: null,
    coverage: null,
    detail: "UNAVAILABLE: requires a real retrieval/ranking backend wired for token saving; none exists in this repo. Not a toggle.",
  },
  {
    id: "caveman",
    label: "Caveman output style",
    tier: "standard",
    safeDefault: false,
    status: "covered",
    control: "cavemanEnabled, cavemanLevel",
    coverage: "open-sse/rtk/caveman.js — system-prompt injector (level lite/full/ultra/wenyan)",
    detail: "Injects a response-shaping instruction into the system message; it does not rewrite provider output. Opt-in.",
  },
  {
    id: "terse-prose",
    label: "Output style: terse prose",
    tier: "output-styles",
    safeDefault: false,
    status: "covered",
    control: "cavemanEnabled, cavemanLevel",
    coverage: "covered by existing Caveman prompt injection (open-sse/rtk/caveman.js)",
    detail: "Covered: Caveman injects terse-prose response-shaping instructions into the system message without rewriting output. No separate engine — toggled via caveman settings.",
  },
  {
    id: "less-code",
    label: "Output style: less code",
    tier: "output-styles",
    safeDefault: false,
    status: "covered",
    control: "ponytailEnabled, ponytailLevel",
    coverage: "covered by existing Ponytail prompt injection (open-sse/rtk/ponytail.js)",
    detail: "Covered: Ponytail injects less-code response-shaping instructions into the system message without rewriting output. No separate engine — toggled via ponytail settings.",
  },
  {
    id: "ponytail",
    label: "Ponytail output style",
    tier: "output-styles",
    safeDefault: false,
    status: "covered",
    control: "ponytailEnabled, ponytailLevel",
    coverage: "open-sse/rtk/ponytail.js — system-prompt injector (level lite/full/ultra)",
    detail: "Injects the lazy-senior-dev response-shaping instruction into the system message. Opt-in.",
  },
  {
    id: "llmlingua",
    label: "LLMLingua prompt compression",
    tier: "ultra",
    safeDefault: false,
    status: "unavailable",
    control: null,
    coverage: null,
    detail: "Heuristic status: unavailable — dependency not installed; no runtime path.",
  },
  {
    id: "ultra",
    label: "Ultra compression (SLM)",
    tier: "ultra",
    safeDefault: false,
    status: "unavailable",
    control: null,
    coverage: null,
    detail: "Heuristic status: unavailable — requires a local small language model; none is wired.",
  },
  {
    id: "omniglyph",
    label: "OmniGlyph encoding",
    tier: "ultra",
    safeDefault: false,
    status: "unavailable",
    control: null,
    coverage: null,
    detail: "Heuristic status: unavailable — dependency/model not installed; no runtime path.",
  },
  {
    id: "mcp-accessibility",
    label: "MCP tool-output accessibility",
    tier: "standard",
    safeDefault: false,
    status: "unavailable",
    control: null,
    coverage: null,
    detail: "UNAVAILABLE: the MCP stdio/SSE bridge (src/app/api/mcp/[plugin]/sse, src/lib/mcp/stdioSseBridge.js) exposes dashboard MCP plugins, but that bridging is NOT separate-store/scoped MCP tool-output compression. No such compression exists — not a toggle.",
  },
];

// Tier/group metadata matching the requested UI. `heuristic: true` tiers
// report availability by heuristic (installed deps / wired models), never by
// a real runtime.
export const TOKEN_SAVER_TIERS = [
  { id: "safe-default", label: "Safe default", engineIds: ["session-dedup", "ccr", "lite", "rtk", "standard"] },
  { id: "standard", label: "Standard", engineIds: ["codex-responses", "headroom", "relevance", "caveman", "mcp-accessibility"] },
  { id: "full", label: "Full", engineIds: ["aggressive"] },
  { id: "ultra", label: "Ultra", heuristic: true, engineIds: ["llmlingua", "ultra", "omniglyph"] },
  { id: "output-styles", label: "Output styles", engineIds: ["terse-prose", "less-code", "ponytail"] },
];

// Fixed, non-user-toggleable guarantees. Preserve-system and cache-aligned
// live zone are enforced by the runtime (L0 snapshot + RTK prefixLen start),
// not settings.
export const TOKEN_SAVER_GENERAL_SETTINGS = {
  autoTrigger: {
    control: "tokenSaverAutoTriggerTokens",
    default: 4000,
    zeroMeansAlways: true,
    detail: "RTK runs only when the deterministic request-size estimate is >= this token count; 0 = always.",
  },
  preserveSystem: {
    value: "always",
    fixed: true,
    detail: "The system prompt is always captured in the L0 snapshot before token savers run and restored by the cache interlock (open-sse/cache/l0.js). Not user-toggleable.",
  },
  liveZone: {
    status: "covered",
    fixed: true,
    detail: "RTK compresses only the cache-aligned live tail (messages from cacheState.prefixLen onward); Kiro/Responses keep full-body behavior. Not user-toggleable.",
  },
};

// Grouped shape for TokenSaverClient: tiers with their entries resolved.
export function getTokenSaverGroups() {
  return TOKEN_SAVER_TIERS.map((tier) => ({
    ...tier,
    entries: tier.engineIds
      .map((id) => TOKEN_SAVER_CATALOG.find((entry) => entry.id === id))
      .filter(Boolean),
  }));
}

// Return copies so callers can't mutate the catalog.
export function getTokenSaverCatalog() {
  return TOKEN_SAVER_CATALOG.map((entry) => ({ ...entry }));
}

// Convenience: status lookup for a single engine id ("covered"/"unavailable"/null).
export function getTokenSaverStatus(id) {
  const entry = TOKEN_SAVER_CATALOG.find((e) => e.id === id);
  return entry ? entry.status : null;
}
