/**
 * Shared lazy TLS-impersonating HTTP transport for web-session executors
 * (ChatGPT / Claude / Notion / similar Cloudflare-protected hosts).
 *
 * Why: Cloudflare pins `cf_clearance` to the client's TLS fingerprint
 * (JA3/JA4 + HTTP/2 SETTINGS frame ordering). Node's undici fetch presents an
 * obvious "not a browser" handshake and gets challenged even with all the
 * right cookies. This wraps `tls-client-node` (native shared library built
 * from bogdanfinn/tls-client) to send a real browser handshake instead.
 *
 * One shared transport replaces the three copy-pasted per-provider clients
 * (chatgpt/claude/notion) — the only per-provider knob is the TLS `profile`.
 *
 * The dependency is OPTIONAL: it is loaded only via dynamic `import()` inside
 * the call path, so importing this module (and the whole app) succeeds when
 * tls-client-node is not installed. When it is missing, `webTlsFetch()`
 * rejects with `WebTlsClientUnavailableError` instead of a module-load
 * failure, and `isTlsClientAvailable()` reports the state side-effect-free.
 */

import { homedir } from "node:os";
import { join } from "node:path";

// Writable cache dir for the native library binary. Adapted from OmniRoute's
// tlsClientDownloadDir.ts: without an explicit `downloadDir` the library
// defaults to its own package node_modules/tls-client-node/bin, which is
// root-owned on global installs and fails with EACCES for normal users.
const TLS_DOWNLOAD_DIR = join(process.env.DATA_DIR || join(homedir(), ".miawrouter"), "tls-client", "bin");

const DEFAULT_TIMEOUT_MS =
  Number.parseInt(process.env.MIAW_TLS_TIMEOUT_MS || "", 10) || 60_000;
// Grace added to the wire timeout before the JS-level hard race fires. Under
// healthy operation the binding honors `timeoutMilliseconds` and rejects on
// its own; the JS race only wins when the koffi-loaded native call is wedged
// (which the binding's own timer can't escape).
const HARD_TIMEOUT_GRACE_MS =
  Number.parseInt(process.env.MIAW_TLS_GRACE_MS || "", 10) || 10_000;

let clientPromise = null;
let exitHookInstalled = false;

export class WebTlsClientUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebTlsClientUnavailableError";
  }
}

class TlsClientHangError extends Error {
  constructor(message) {
    super(message);
    this.name = "TlsClientHangError";
  }
}

/**
 * True when the optional tls-client-node dependency can be imported.
 * Module resolution only — does not start the native client or download
 * binaries, so it is fast and has no side effects.
 */
export async function isTlsClientAvailable() {
  try {
    await import(/* turbopackOptional: true */ "tls-client-node");
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop the cached client so the next call respawns it. Called when a request
 * observes the native binding has wedged — a fresh TLSClient (and koffi load)
 * takes over without a process restart.
 */
function resetClientCache() {
  clientPromise = null;
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const mod = await import(/* turbopackOptional: true */ "tls-client-node");
      const { TLSClient } = mod;
      // Native mode loads the shared library directly via koffi, avoiding the
      // managed sidecar's localhost HTTP calls that MiawRouter's global fetch
      // proxy patch interferes with.
      const client = new TLSClient({ runtimeMode: "native", downloadDir: TLS_DOWNLOAD_DIR });
      await client.start();
      installExitHook();
      return client;
    })().catch((err) => {
      clientPromise = null; // allow a clean retry on the next call
      const msg = err instanceof Error ? err.message : String(err);
      throw new WebTlsClientUnavailableError(
        `tls-client-node unavailable: ${msg}. ` +
          `Install the optional tls-client-node dependency and let its native binary download.`
      );
    });
  }
  return clientPromise;
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const stop = async () => {
    if (!clientPromise) return;
    try {
      const c = await clientPromise;
      await c?.stop?.();
    } catch {
      // ignore
    }
  };
  process.once("beforeExit", stop);
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

/**
 * Race a `client.request()` promise against a JS-level hard timeout and the
 * caller's abort signal. The binding's `timeoutMilliseconds` covers the wire
 * path; this guards the case where the koffi binding itself deadlocks, where
 * neither the binding's own timer nor a post-call `signal.aborted` re-check
 * can recover.
 */
async function raceWithTimeout(promise, timeoutMs, signal) {
  let timer = null;
  let onAbort = null;
  try {
    const racers = [
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new TlsClientHangError(`tls-client-node call exceeded ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ];
    if (signal) {
      racers.push(
        new Promise((_, reject) => {
          if (signal.aborted) {
            reject(makeAbortError(signal));
            return;
          }
          onAbort = () => reject(makeAbortError(signal));
          signal.addEventListener("abort", onAbort, { once: true });
        })
      );
    }
    return await Promise.race(racers);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function makeAbortError(signal) {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(typeof reason === "string" ? reason : "The operation was aborted");
  err.name = "AbortError";
  return err;
}

function toHeaders(raw) {
  const h = new Headers();
  for (const [k, vs] of Object.entries(raw || {})) {
    for (const v of vs) h.append(k, v);
  }
  return h;
}

// ─── Proxy resolution ──────────────────────────────────────────────────────
// Mirrors open-sse/utils/proxyFetch.js (resolveConnectionProxyUrl +
// getEnvProxyUrl, both private there) so the tls transport honors the same
// connection proxyOptions + NO_PROXY / *_PROXY env semantics as native fetch.
// Kept self-contained instead of importing proxyFetch.js because that module
// also installs its global-fetch patch as a side effect; this transport drives
// the native library directly and only needs the resolved URL. # ponytail:
// two private helpers duplicated from proxyFetch.js — extract to a shared
// util if a third consumer appears.

function normalizeProxyUrl(proxyUrl) {
  const s = (proxyUrl ?? "").trim();
  if (!s) return null;
  try {
    new URL(s);
    return s;
  } catch {
    return `http://${s}`; // allow "host:port" style values
  }
}

function bypassesNoProxy(targetUrl, noProxyValue) {
  const noProxy = (noProxyValue ?? "").trim();
  if (!noProxy) return false;
  let hostname;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const patterns = noProxy
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Resolve the proxy URL for a tls-client request: connection proxyOptions win,
 * else the POSIX-standard *_PROXY env vars (both honoring NO_PROXY). Returns
 * undefined for a legitimate direct connection. Never returns a proxy host
 * that NO_PROXY explicitly bypasses.
 */
function resolveProxyForRequest(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (enabled) {
    const raw = proxyOptions?.url ?? proxyOptions?.connectionProxyUrl;
    const noProxy = proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy;
    if (raw && !bypassesNoProxy(targetUrl, noProxy)) {
      return normalizeProxyUrl(raw);
    }
  }
  if (bypassesNoProxy(targetUrl, process.env.NO_PROXY || process.env.no_proxy)) return null;

  let protocol;
  try {
    protocol = new URL(targetUrl).protocol;
  } catch {
    return null;
  }
  const envProxy =
    protocol === "https:"
      ? process.env.HTTPS_PROXY || process.env.https_proxy ||
        process.env.ALL_PROXY || process.env.all_proxy
      : process.env.HTTP_PROXY || process.env.http_proxy ||
        process.env.ALL_PROXY || process.env.all_proxy;
  return normalizeProxyUrl(envProxy);
}

/**
 * Make a single browser-fingerprinted HTTP request through the shared
 * tls-client-node transport.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method]        HTTP method (default "GET")
 * @param {Record<string,string>} [options.headers]  request headers
 * @param {string} [options.body]          request body
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]     wire timeout in ms (default 60s)
 * @param {string} [options.profile]       tls-client identifier, e.g. "chrome_146" / "firefox_148"
 * @param {object} [options.proxyOptions]  connection proxy config (same shape as proxyAwareFetch's)
 * @param {boolean} [options.byteResponse] return the body as decoded bytes instead of text
 * @returns {Promise<{status:number, headers:Headers, text:string|null, body:Uint8Array|null}>}
 * @throws {WebTlsClientUnavailableError} when tls-client-node is not installed or failed to start
 */
export async function webTlsFetch(url, options = {}) {
  const { method, headers, body, signal, timeoutMs, profile, proxyOptions, byteResponse } = options;

  // The koffi binding can't accept an AbortSignal mid-flight, so honor it
  // up-front and re-check after the call (never return a stale response).
  if (signal?.aborted) throw makeAbortError(signal);
  const client = await getClient();
  if (signal?.aborted) throw makeAbortError(signal);

  const requestOptions = {
    method: method || "GET",
    headers: headers || {},
    body,
    tlsClientIdentifier: profile,
    timeoutMilliseconds: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    followRedirects: true,
    withRandomTLSExtensionOrder: true,
    isByteResponse: byteResponse === true,
    proxyUrl: resolveProxyForRequest(url, proxyOptions),
  };

  let tlsResponse;
  try {
    tlsResponse = await raceWithTimeout(
      client.request(url, requestOptions),
      (timeoutMs ?? DEFAULT_TIMEOUT_MS) + HARD_TIMEOUT_GRACE_MS,
      signal
    );
  } catch (err) {
    // The native binding is wedged — respawn a fresh client next call.
    if (err instanceof TlsClientHangError) resetClientCache();
    throw err;
  }
  if (signal?.aborted) throw makeAbortError(signal);

  return {
    status: tlsResponse.status,
    headers: toHeaders(tlsResponse.headers),
    text: byteResponse === true ? null : tlsResponse.body,
    body: byteResponse === true ? await tlsResponse.bytes() : null,
  };
}
