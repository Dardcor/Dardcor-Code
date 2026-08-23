import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { DEFAULT_RTK_MODE, DEFAULT_AUTO_TRIGGER_TOKENS } from "open-sse/rtk/constants.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:21128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: false,
  requireApiKey: false,
  tunnelDashboardAccess: true,
  sessionVersion: 0,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  privacyMode: "normal",
  enableObservability: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  rtkMode: DEFAULT_RTK_MODE,
  tokenSaverAutoTriggerTokens: DEFAULT_AUTO_TRIGGER_TOKENS,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  // Response cache layers (L1 exact / L2 semantic / L3 content-address dedup).
  // L2 and L3 are opt-in: L2 needs a configured embedding model; L3 rewrites
  // the request body and is off until explicitly enabled.
  cacheL1Enabled: true,
  cacheL2Enabled: false,
  cacheL3Enabled: false,
  semanticCacheModel: "",
  semanticCacheThreshold: 0.92,
  semanticCacheTtl: 3600000,
  semanticCacheMaxEntries: 100,
  cacheL3MinChars: 1000,
  // OpenCode Zen catalog behavior. zenFreeOnly hard-filters OpenCode routing
  // and /v1/models to the classified free set; the override maps let users pin
  // free classification / data-retention per model id.
  zenFreeOnly: false,
  zenFreeModelOverrides: {},
  zenRetentionOverrides: {},
  privacyMode: "normal",
  privacyBlockedProviders: [],
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Apply recognized env overrides to the merged settings object (mutates in place).
// Only exact lowercase "true"/"false" are recognized; anything else is ignored.
// ponytail: env-gated override for requireApiKey only; add more keys here when needed.
function applyEnvOverrides(settings) {
  const raw = process.env.REQUIRE_API_KEY;
  if (raw === "true") settings.requireApiKey = true;
  else if (raw === "false") settings.requireApiKey = false;
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  applyEnvOverrides(merged);
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    // Any password write invalidates previously issued dashboard JWTs.
    if (Object.prototype.hasOwnProperty.call(updates, "password")) {
      next.sessionVersion = (Number(current.sessionVersion) || 0) + 1;
    }
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)],
    );
  });
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
