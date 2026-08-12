/**
 * MCP Authorization Scopes — Defines permission scopes for each MCP tool.
 *
 * Each tool requires specific scopes to execute. API keys can be configured
 * with a subset of scopes to limit tool access (least-privilege).
 */

// ============ Scope Definitions ============

/** All available MCP scopes */
export const MCP_SCOPE_LIST = [
  "read:health",
  "read:combos",
  "write:combos",
  "read:quota",
  "read:usage",
  "read:models",
  "execute:completions",
  "execute:search",
  "write:budget",
  "write:resilience",
  "pricing:write",
  "read:cache",
  "write:cache",
  "read:compression",
  "write:compression",
  "read:proxies",
] as const;

export type McpScope = (typeof MCP_SCOPE_LIST)[number];

// ============ Tool → Scope Mapping ============

/** Maps each MCP tool to its required scopes */
export const MCP_TOOL_SCOPES: Record<string, readonly McpScope[]> = {
  // Phase 1: Essential Tools
  dardcorCode_get_health: ["read:health"],
  dardcorCode_list_combos: ["read:combos"],
  dardcorCode_get_combo_metrics: ["read:combos"],
  dardcorCode_switch_combo: ["write:combos"],
  dardcorCode_check_quota: ["read:quota"],
  dardcorCode_route_request: ["execute:completions"],
  dardcorCode_web_search: ["execute:search"],
  dardcorCode_web_fetch: ["execute:search"],
  dardcorCode_cost_report: ["read:usage"],
  dardcorCode_list_models_catalog: ["read:models"],

  // Phase 2: Advanced Tools
  dardcorCode_simulate_route: ["read:health", "read:combos"],
  dardcorCode_set_budget_guard: ["write:budget"],
  dardcorCode_set_resilience_profile: ["write:resilience"],
  dardcorCode_test_combo: ["execute:completions", "read:combos"],
  dardcorCode_get_provider_metrics: ["read:health"],
  dardcorCode_best_combo_for_task: ["read:combos", "read:health"],
  dardcorCode_explain_route: ["read:health", "read:usage"],
  dardcorCode_get_session_snapshot: ["read:usage"],
  dardcorCode_db_health_check: ["read:health", "write:resilience"],
  dardcorCode_sync_pricing: ["pricing:write"],
  dardcorCode_cache_stats: ["read:cache"],
  dardcorCode_cache_flush: ["write:cache"],
  dardcorCode_compression_status: ["read:compression"],
  dardcorCode_compression_configure: ["write:compression"],
  dardcorCode_set_compression_engine: ["write:compression"],
  dardcorCode_list_compression_combos: ["read:compression"],
  dardcorCode_compression_combo_stats: ["read:compression"],
  dardcorCode_ccr_store: ["write:compression"],
  dardcorCode_ccr_retrieve: ["read:compression"],
  dardcorCode_ccr_inspect: ["read:compression"],
  dardcorCode_ccr_list: ["read:compression"],
  dardcorCode_ccr_delete: ["write:compression"],
  dardcorCode_ccr_stats: ["read:compression"],
  dardcorCode_oneproxy_fetch: ["read:proxies"],
  dardcorCode_oneproxy_rotate: ["read:proxies"],
  dardcorCode_oneproxy_stats: ["read:proxies"],

  // Web-session pool observability (read) + lifecycle (write)
  dardcorCode_pool_status: ["read:health"],
  dardcorCode_pool_sessions: ["read:health"],
  dardcorCode_pool_health: ["read:health"],
  dardcorCode_pool_reset: ["write:resilience"],
  dardcorCode_pool_warm: ["write:resilience"],
  // Stealth browser pool observability (#3368 PR7)
  dardcorCode_browser_pool_status: ["read:health"],
} as const;
