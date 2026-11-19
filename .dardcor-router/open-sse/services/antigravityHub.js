import fs from "fs";
import path from "path";
import os from "os";
import http from "http";

let cachedHub = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Checks if a PID is alive.
 */
export function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  if (typeof process === "undefined" || typeof process.kill !== "function") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probes the local hub HTTP port to ensure it responds to requests.
 */
export async function probeHub(hub, timeoutMs = 1500) {
  if (!hub || !hub.httpPort) return false;
  if (typeof window !== "undefined" || !http || typeof http.request !== "function") return false;
  return new Promise((resolve) => {
    try {
      const req = http.request({
        hostname: "127.0.0.1",
        port: hub.httpPort,
        path: "/",
        method: "GET",
        headers: {
          "X-CSRF-Token": hub.csrfToken || "",
          "User-Agent": "curl/8.4.0",
        },
        timeout: timeoutMs,
      }, (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
      });

      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });

      req.on("error", () => {
        resolve(false);
      });

      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Synchronously retrieves hub info from daemon directory.
 */
export function getActiveAntigravityHubSync() {
  if (typeof window !== "undefined" || !fs || typeof fs.existsSync !== "function") {
    return null;
  }
  const now = Date.now();
  if (cachedHub !== null && (now - lastCheckTime < CACHE_TTL_MS)) {
    return cachedHub;
  }

  const daemonDir = path.join(os.homedir(), ".gemini", "antigravity", "daemon");
  if (!fs.existsSync(daemonDir)) {
    cachedHub = null;
    lastCheckTime = now;
    return null;
  }

  try {
    const files = fs.readdirSync(daemonDir).filter(f => f.startsWith("hub_") && f.endsWith(".json"));
    if (!files.length) {
      cachedHub = null;
      lastCheckTime = now;
      return null;
    }

    // Sort newest first
    files.sort((a, b) => {
      try {
        const sA = fs.statSync(path.join(daemonDir, a)).mtimeMs;
        const sB = fs.statSync(path.join(daemonDir, b)).mtimeMs;
        return sB - sA;
      } catch {
        return 0;
      }
    });

    for (const file of files) {
      try {
        const fullPath = path.join(daemonDir, file);
        const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (!data.pid || !data.httpPort) continue;

        if (isProcessAlive(data.pid)) {
          const hubInfo = {
            pid: data.pid,
            httpPort: data.httpPort,
            httpsPort: data.httpsPort,
            lsVersion: data.lsVersion || "2.29.0",
            csrfToken: data.csrfToken || "",
            baseUrl: `http://127.0.0.1:${data.httpPort}`,
            configFile: fullPath,
          };
          cachedHub = hubInfo;
          lastCheckTime = now;
          return cachedHub;
        }
      } catch {}
    }
  } catch {}

  cachedHub = null;
  lastCheckTime = now;
  return null;
}

/**
 * Asynchronously retrieves active hub info and verifies responsiveness.
 */
export async function getActiveAntigravityHub(force = false) {
  const hub = getActiveAntigravityHubSync();
  if (!hub) return null;

  const isResponsive = await probeHub(hub);
  if (!isResponsive) {
    cachedHub = null;
    return null;
  }

  return hub;
}

/**
 * Returns dynamic language server version or latest default (2.29.0).
 */
export function getAntigravityIdeVersion() {
  const hub = getActiveAntigravityHubSync();
  return hub?.lsVersion || "2.29.0";
}

/**
 * Checks if local hub is active.
 */
export function isHubActive() {
  return getActiveAntigravityHubSync() !== null;
}
