// TLS-impersonating HTTP client for opencode.ai's free tier.
//
// The free gate keys on the TLS ClientHello:
// Requests with Node's OpenSSL fingerprint fail with 429 FreeUsageLimitError,
// while Bun's BoringSSL fingerprint (JA4: 5b57614c22b0) passes with 200 OK.
//
// This client provides:
// 1. Native wreq-js session if installed.
// 2. Automatic Bun BoringSSL TLS bridge (when bun is present).
// 3. Native fetch fallback.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeDep } from "./lazyRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = path.join(__dirname, "opencodeBunBridge.js");
const BRIDGE_PORT = parseInt(process.env.OPENCODE_BUN_BRIDGE_PORT || "25135", 10);

export const OPENCODE_CIPHER_LIST = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

const DEFAULT_TIMEOUT_MS = 120000;

let sessionPromise = null;
let bridgeProcess = null;
let bridgeReadyPromise = null;

export class OpencodeTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

async function loadWreqSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const wreq = await loadRuntimeDep("wreq-js");
      if (typeof wreq?.createSession !== "function") {
        throw new Error("wreq-js runtime is missing createSession");
      }
      return wreq.createSession({
        emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
      });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

async function ensureBunBridge() {
  if (bridgeReadyPromise) return bridgeReadyPromise;

  // Probe if bridge is already alive
  try {
    const probe = await fetch(`http://127.0.0.1:${BRIDGE_PORT}`, {
      headers: { "x-target-url": "https://opencode.ai/zen/v1/models" },
      signal: AbortSignal.timeout(500),
    });
    if (probe.status < 500) {
      bridgeReadyPromise = Promise.resolve(BRIDGE_PORT);
      return bridgeReadyPromise;
    }
  } catch {}

  bridgeReadyPromise = new Promise((resolve, reject) => {
    try {
      const proc = spawn("bun", [BRIDGE_SCRIPT], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, OPENCODE_BUN_BRIDGE_PORT: String(BRIDGE_PORT) },
      });
      bridgeProcess = proc;

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          bridgeReadyPromise = null;
          reject(new Error("Bun bridge startup timeout"));
        }
      }, 3000);

      proc.stdout.on("data", (data) => {
        if (data.toString().includes("READY:")) {
          resolved = true;
          clearTimeout(timeout);
          resolve(BRIDGE_PORT);
        }
      });

      proc.on("error", (err) => {
        if (!resolved) {
          bridgeReadyPromise = null;
          clearTimeout(timeout);
          reject(err);
        }
      });

      proc.on("exit", () => {
        bridgeReadyPromise = null;
        bridgeProcess = null;
      });

      if (proc.unref) proc.unref();
    } catch (err) {
      bridgeReadyPromise = null;
      reject(err);
    }
  });

  return bridgeReadyPromise;
}

export function resetOpencodeTlsSession() {
  const pending = sessionPromise;
  sessionPromise = null;
  pending?.then((session) => session.close?.()).catch(() => {});
  if (bridgeProcess) {
    try { bridgeProcess.kill(); } catch {}
    bridgeProcess = null;
    bridgeReadyPromise = null;
  }
}

/**
 * Fetch through BoringSSL TLS. Returns a native Response so
 * downstream `.body` / `.text()` / `.json()` consumers keep working unchanged.
 */
export async function opencodeTlsFetch(url, init = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, proxy } = {}) {
  // 1. Try native wreq-js if available
  try {
    const session = await loadWreqSession();
    const options = {
      method: init.method || "GET",
      headers: init.headers,
      redirect: "follow",
      timeout: timeoutMs,
    };
    if (init.body !== undefined) options.body = init.body;
    if (signal) options.signal = signal;

    const res = await session.fetch(url, options);
    const headers = {};
    res.headers?.forEach?.((value, key) => {
      headers[key] = value;
    });
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch {}

  // 2. Try Bun BoringSSL bridge
  try {
    const port = await ensureBunBridge();
    const headers = { ...(init.headers || {}) };
    headers["x-target-url"] = url;
    if (proxy) headers["x-relay-proxy"] = proxy;

    const mergedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: init.method || "GET",
      headers,
      body: init.body,
      signal: mergedSignal,
    });
    return res;
  } catch {}

  // 3. Fallback to native fetch
  return await fetch(url, { ...init, signal });
}

export const __test__ = { OPENCODE_CIPHER_LIST };
