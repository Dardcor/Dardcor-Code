/**
 * `dardcor-code migrate --from-9router` — migrate an existing 9router install
 * into this Dardcor Code gateway.
 *
 * Data never travels as raw SQLite bytes. The command reads the legacy
 * installation through the same authenticated export/import API the dashboard
 * uses (`GET/POST /api/settings/database`, backed by exportDb/importDb), so the
 * target re-persists every row under its own data dir, machine id and session
 * version. The source install and its files are left untouched.
 *
 * Auth: the legacy server accepts the legacy CLI token (`x-9r-cli-token`,
 * derived from the legacy data dir's machine-id + auth/cli-secret under the
 * `9r-cli-auth` salt); the target accepts the new token (`x-dardcor-cli-token`,
 * `dardcor-cli-auth`). Either side may fall back to its dashboard password.
 *
 * Branded local defaults (localhost:20128 → :21128, legacy token-saver /
 * connection-id headers, `9router` provider/model slot identifiers) are
 * rewritten inside the exported structured payload by a recursive allowlisted
 * transformer. Provider secrets pass through the API boundary byte-identical.
 *
 * The report is honest about what this boundary does and does not do:
 * provider tokens are stored in plaintext JSON in the DB — the API boundary
 * re-persists them under the target, it does not re-encrypt them. Issued
 * `sk-` API keys carry an HMAC CRC derived from the source install's
 * API_KEY_SECRET; unless that secret is shared, re-issue keys after migrating.
 *
 * No credentials or tokens are ever printed.
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { machineIdSync } = require("node-machine-id");

const DEFAULT_LEGACY_HOST = "127.0.0.1";
const DEFAULT_LEGACY_PORT = 20128;
const DEFAULT_TARGET_HOST = "127.0.0.1";
const DEFAULT_TARGET_PORT = 21128;

// Mirror of the server's CLI-token scheme (src/shared/utils/machineId.js and
// src/dashboardGuard.js): sha256(rawMachineId + salt + cliSecret).substring(0,16).
const LEGACY_CLI_TOKEN_SALT = "9r-cli-auth";
const LEGACY_CLI_TOKEN_HEADER = "x-9r-cli-token";
const LEGACY_PASSWORD_HEADER = "x-9r-password";
const TARGET_CLI_TOKEN_SALT = "dardcor-cli-auth";
const TARGET_CLI_TOKEN_HEADER = "x-dardcor-cli-token";
const TARGET_PASSWORD_HEADER = "x-dardcor-password";

const EXPORT_PATH = "/api/settings/database";
const REQUEST_TIMEOUT_MS = 60000;

// Connection fields that hold credentials. Never rewritten, never printed.
const SECRET_KEYS = new Set([
  "accessToken", "refreshToken", "apiKey", "idToken",
  "clientSecret", "password", "crc", "machineId",
]);

// Keys whose string values are allowed to carry branded/local content.
// Everything else in the export payload passes through byte-identical.
const REWRITE_KEYS = new Set([
  // settings keys that can hold local URLs (mitmRouterBaseUrl default is
  // http://localhost:21128; a legacy export stores http://localhost:20128)
  "mitmRouterBaseUrl", "headroomUrl", "tunnelUrl", "tailscaleUrl",
  "outboundProxyUrl", "baseUrl", "cloudUrl",
]);

// Collections whose string values may carry `9router` slot identifiers /
// model prefixes (`9router/…`) — combos models, aliases, mitm mappings,
// custom provider data. Everything outside these collections and the
// REWRITE_KEYS above passes through byte-identical.
const REWRITE_COLLECTIONS = new Set([
  "providerConnections", "providerNodes", "proxyPools", "combos",
  "modelAliases", "customModels", "mitmAlias", "pricing",
]);

const HELP = `
Usage: dardcor-code migrate --from-9router [options]

Migrate data from a legacy 9router install (same machine) into this
Dardcor Code gateway. Reads the source only through the authenticated
export API — never copies data.sqlite, never writes into the source.

Options:
  --from-9router          Name the migration source (legacy 9router install)
  --legacy-host <host>    Legacy gateway host (default: ${DEFAULT_LEGACY_HOST})
  --legacy-port <port>    Legacy gateway port (default: ${DEFAULT_LEGACY_PORT})
  --legacy-dir <dir>      Legacy data dir holding machine-id + auth/cli-secret
                          (default: ~/.9router, Win %APPDATA%\\9router)
  --host <host>           Target Dardcor Code host (default: ${DEFAULT_TARGET_HOST})
  --port <port>           Target Dardcor Code port (default: ${DEFAULT_TARGET_PORT})
  --legacy-password <pw>  Legacy dashboard password (fallback when the legacy
                          CLI token is rejected, e.g. different machine)
  --target-password <pw>  Target dashboard password (fallback for import)
  --force                 Proceed without confirmation when the target already
                          has data (import wipes and replaces target tables)
  -h, --help              Show this help
`;

// ─── Pure helpers (exported for unit tests) ───────────────────────────────

function defaultLegacyDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
    : path.join(os.homedir(), ".9router");
}

function defaultTargetDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "dardcor-code")
    : path.join(os.homedir(), ".dardcor-code");
}

function computeCliToken({ raw, secret, salt }) {
  if (!raw) return "";
  return crypto.createHash("sha256").update(raw + salt + (secret || "")).digest("hex").substring(0, 16);
}

function readRawMachineId(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, "machine-id"), "utf8").trim();
    if (raw) return raw;
  } catch { /* missing → fall back to machineIdSync */ }
  try { return machineIdSync(); } catch { return ""; }
}

// Read-only: never create the legacy secret file (that would corrupt the
// source install's own token). Missing file → empty secret → token won't match
// → caller falls back to --legacy-password.
function readCliSecret(dataDir) {
  try {
    return fs.readFileSync(path.join(dataDir, "auth", "cli-secret"), "utf8").trim();
  } catch { return ""; }
}

function legacyCliToken(legacyDir) {
  return computeCliToken({
    raw: readRawMachineId(legacyDir),
    secret: readCliSecret(legacyDir),
    salt: LEGACY_CLI_TOKEN_SALT,
  });
}

function targetCliToken() {
  return computeCliToken({
    raw: readRawMachineId(defaultTargetDir()),
    secret: readCliSecret(defaultTargetDir()),
    salt: TARGET_CLI_TOKEN_SALT,
  });
}

// String-level rewrite rules, applied in order (specific before generic).
// Only strings in allowlisted positions ever reach these.
function rewriteLocalString(value) {
  if (typeof value !== "string") return value;
  let out = value;
  // Legacy client header names → new names (specific rules run first so the
  // generic slot rewrite below cannot mangle them).
  out = out.replace(/x-9router-token-saver/gi, "x-dardcor-token-saver");
  out = out.replace(/x-9router-connection-id/gi, "x-dardcor-connection-id");
  // Local gateway port 20128 → 21128 (legacy runtime port → new runtime port).
  out = out.replace(/(localhost|127\.0\.0\.1|0\.0\.0\.0):20128\b/gi, "$1:21128");
  // `9router` slot identifiers: bare token or `9router/…` model prefix → dardcor-code.
  // The `9router.com` cloud domain and pinned upstream-contract strings are never
  // matched (followed by `.`, which the negative lookahead rejects).
  out = out.replace(/\b9router\b(?!\.com)/gi, "dardcor-code");
  return out;
}

function isSecretKey(key) {
  return SECRET_KEYS.has(key);
}

function isRewriteKey(key) {
  return REWRITE_KEYS.has(key);
}

// Recursive allowlisted rewrite of the exported structured payload.
//
// - Rewrites the string value of any allowlisted key (settings URL keys,
//   baseUrl) and every string inside an allowlisted collection (provider
//   connections/nodes, combos, aliases, mitm, pricing) so embedded config
//   blobs and `9router/…` model slot identifiers are covered.
// - Never touches values under secret key names (accessToken, refreshToken,
//   apiKey, …) and never rewrites the apiKeys collection at all (the `key`
//   field is a credential).
// - Never mutates the input; returns a new object.
function rewritePayload(payload, inRewriteCollection = false) {
  if (payload === null || typeof payload !== "object") return payload;
  const clone = Array.isArray(payload) ? [] : {};

  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (isSecretKey(key) || key === "apiKeys") {
      // Credentials pass through the API boundary byte-identical.
      clone[key] = value;
      continue;
    }
    if (typeof value === "string") {
      clone[key] = (isRewriteKey(key) || inRewriteCollection) ? rewriteLocalString(value) : value;
      continue;
    }
    if (value !== null && typeof value === "object") {
      clone[key] = rewritePayload(value, inRewriteCollection || REWRITE_COLLECTIONS.has(key));
      continue;
    }
    clone[key] = value;
  }
  return clone;
}

// "Populated" = the target holds user data that a wipe-and-replace import
// would destroy. The auto-provisioned dashboard "Default Key" is not user data
// and does not count.
function isTargetPopulated(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const count = (arr) => (Array.isArray(arr) ? arr.length : 0);
  if (count(payload.providerConnections) > 0) return true;
  if (count(payload.providerNodes) > 0) return true;
  if (count(payload.proxyPools) > 0) return true;
  if (count(payload.combos) > 0) return true;
  if (count(payload.customModels) > 0) return true;
  const userKeys = (payload.apiKeys || []).filter((k) => (k && k.name) !== "Default Key");
  if (userKeys.length > 0) return true;
  if (payload.pricing && typeof payload.pricing === "object" && Object.keys(payload.pricing).length > 0) return true;
  return false;
}

function payloadCounts(payload) {
  const count = (arr) => (Array.isArray(arr) ? arr.length : 0);
  return {
    providerConnections: count(payload && payload.providerConnections),
    providerNodes: count(payload && payload.providerNodes),
    proxyPools: count(payload && payload.proxyPools),
    apiKeys: count(payload && payload.apiKeys),
    combos: count(payload && payload.combos),
    customModels: count(payload && payload.customModels),
    pricing: payload && payload.pricing && typeof payload.pricing === "object" ? Object.keys(payload.pricing).length : 0,
  };
}

// ─── HTTP + auth plumbing (real run only) ─────────────────────────────────

function httpJson({ host, port, method, path: reqPath, body, headers = {} }) {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const h = { Accept: "application/json", ...headers };
    if (payload) {
      h["Content-Type"] = "application/json";
      h["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = http.request(
      { hostname: host, port, path: reqPath, method, headers: h, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* keep raw */ }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      }
    );
    req.on("error", (err) => resolve({ status: 0, error: `Network error: ${err.message}` }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "Request timeout" }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Export: CLI token first; on 401 retry with the dashboard password when supplied.
async function exportFrom(host, port, cliToken, cliHeader, password, passwordHeader) {
  let res = await httpJson({ host, port, method: "GET", path: EXPORT_PATH, headers: { [cliHeader]: cliToken } });
  if (res.status === 401 && password) {
    res = await httpJson({ host, port, method: "GET", path: EXPORT_PATH, headers: { [passwordHeader]: password } });
  }
  return res;
}

// Import: CLI token first; on 401 retry with the target dashboard password.
// The password travels ONLY in the x-dardcor-password header — the DB payload body
// is sent byte-identical, so the password can never enter body logging.
async function importTo(host, port, cliToken, payload, password) {
  let res = await httpJson({
    host, port, method: "POST", path: EXPORT_PATH, body: payload,
    headers: { [TARGET_CLI_TOKEN_HEADER]: cliToken },
  });
  if (res.status === 401 && password) {
    res = await httpJson({
      host, port, method: "POST", path: EXPORT_PATH, body: payload,
      headers: { [TARGET_CLI_TOKEN_HEADER]: cliToken, [TARGET_PASSWORD_HEADER]: password },
    });
  }
  return res;
}

function confirmYesNo(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// ─── Migrate core (dependency-injected for hermetic unit tests) ───────────
//
// opts:
//   exportLegacy()     → { status, body }  (GET /api/settings/database on source)
//   fetchTarget()      → { status, body }  (GET /api/settings/database on target)
//   importTarget(payload) → { status, body } (POST to target)
//   force              → skip the populated-target confirmation
//   confirm()          → Promise<boolean> when target is populated and !force
// Returns { code, report }.
async function runMigrate(opts) {
  const { exportLegacy, fetchTarget, importTarget, force = false, confirm } = opts;
  const report = { counts: {}, rewritten: false };

  const src = await exportLegacy();
  if (!src || src.status !== 200 || !src.body || typeof src.body !== "object") {
    const detail = src && src.status === 401
      ? "authentication failed (CLI token rejected; pass --legacy-password)"
      : (src && (src.body && src.body.error || src.error)) || `HTTP ${src && src.status}`;
    return { code: 1, report: { ...report, error: `Failed to export source: ${detail}` } };
  }

  const target = await fetchTarget();
  if (!target || target.status !== 200 || !target.body || typeof target.body !== "object") {
    const detail = target && target.status === 401
      ? "authentication failed (CLI token rejected; pass --target-password)"
      : (target && (target.body && target.body.error || target.error)) || `HTTP ${target && target.status}`;
    return { code: 1, report: { ...report, error: `Failed to read target: ${detail}` } };
  }

  report.counts.source = payloadCounts(src.body);

  const populated = isTargetPopulated(target.body);
  report.targetPopulated = populated;
  if (populated && !force) {
    const ok = confirm ? await confirm() : false;
    if (!ok) {
      return {
        code: 1,
        report: {
          ...report,
          error: "Target already contains data; nothing was changed. Re-run with --force to overwrite.",
        },
      };
    }
  }

  // Deep-copy then rewrite: the source payload object is never mutated.
  const rewritten = rewritePayload(JSON.parse(JSON.stringify(src.body)));
  report.counts.rewritten = payloadCounts(rewritten);
  report.rewritten = true;

  const imported = await importTarget(rewritten);
  if (!imported || imported.status !== 200) {
    const detail = (imported && (imported.body && imported.body.error || imported.error)) || `HTTP ${imported && imported.status}`;
    return { code: 1, report: { ...report, error: `Import failed: ${detail}` } };
  }
  report.counts.target = payloadCounts(imported.body);
  return { code: 0, report };
}

function printReport(report) {
  const counts = report.counts || {};
  console.log("Migration report");
  console.log("----------------");
  if (counts.source) {
    console.log(`  Source export : ${counts.source.providerConnections} connections, ${counts.source.providerNodes} custom providers, ${counts.source.combos} combos, ${counts.source.apiKeys} API keys`);
  }
  console.log(`  Rewritten     : local URLs/headers/slots → Dardcor Code names (source payload untouched)`);
  console.log(`  Target import : ${counts.target ? `${counts.target.providerConnections} connections, ${counts.target.combos} combos, ${counts.target.apiKeys} API keys` : "done"}`);
  console.log("");
  console.log("Honest notes:");
  console.log("  - Provider tokens and connection secrets are stored in plaintext JSON in the DB.");
  console.log("    They travelled the authenticated export/import API boundary and were re-persisted");
  console.log("    under the target's data dir, machine id and session version — they were NOT");
  console.log("    re-encrypted, because this app does not encrypt them at rest.");
  console.log("  - Issued `sk-` API keys carry an HMAC CRC derived from the source install's");
  console.log("    API_KEY_SECRET. Unless you share that secret across installs, re-issue keys in");
  console.log("    Dashboard → Endpoint after migrating.");
  console.log("  - OAuth sessions may need a re-login on the target if refresh tokens have expired.");
  console.log("  - Usage/log files and OS-level config (autostart, tunnel) are not part of this path.");
}

async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (!opts.from9router) {
    console.error("❌ Use: dardcor-code migrate --from-9router [options]");
    console.log(HELP);
    return 1;
  }

  const legacyToken = legacyCliToken(opts.legacyDir);
  const targetToken = targetCliToken();

  const result = await runMigrate({
    exportLegacy: () => exportFrom(opts.legacyHost, opts.legacyPort, legacyToken, LEGACY_CLI_TOKEN_HEADER, opts.legacyPassword, LEGACY_PASSWORD_HEADER),
    fetchTarget: () => exportFrom(opts.host, opts.port, targetToken, TARGET_CLI_TOKEN_HEADER, opts.targetPassword, TARGET_PASSWORD_HEADER),
    importTarget: (payload) => importTo(opts.host, opts.port, targetToken, payload, opts.targetPassword),
    force: opts.force,
    confirm: () => confirmYesNo("⚠ Target already contains data; importing will wipe and replace it. Continue? (y/N) "),
  });

  if (result.code !== 0) {
    console.error(`❌ ${result.report.error}`);
    return 1;
  }
  console.log("✅ Migration complete. Source 9router install left untouched.");
  printReport(result.report);
  return 0;
}

function parseArgs(argv) {
  const opts = {
    from9router: false,
    legacyHost: DEFAULT_LEGACY_HOST,
    legacyPort: DEFAULT_LEGACY_PORT,
    legacyDir: defaultLegacyDir(),
    host: DEFAULT_TARGET_HOST,
    port: DEFAULT_TARGET_PORT,
    legacyPassword: null,
    targetPassword: null,
    force: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--from-9router") opts.from9router = true;
    else if (a === "--legacy-host") opts.legacyHost = next() || DEFAULT_LEGACY_HOST;
    else if (a === "--legacy-port") opts.legacyPort = parseInt(next(), 10) || DEFAULT_LEGACY_PORT;
    else if (a === "--legacy-dir") opts.legacyDir = next() || defaultLegacyDir();
    else if (a === "--host" || a === "-H") opts.host = next() || DEFAULT_TARGET_HOST;
    else if (a === "--port" || a === "-p") opts.port = parseInt(next(), 10) || DEFAULT_TARGET_PORT;
    else if (a === "--legacy-password") opts.legacyPassword = next();
    else if (a === "--target-password") opts.targetPassword = next();
    else if (a === "--force" || a === "-f") opts.force = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

module.exports = {
  run, parseArgs, runMigrate, rewritePayload, isTargetPopulated,
  computeCliToken, legacyCliToken, targetCliToken, rewriteLocalString, payloadCounts,
  importTo, TARGET_PASSWORD_HEADER,
};
