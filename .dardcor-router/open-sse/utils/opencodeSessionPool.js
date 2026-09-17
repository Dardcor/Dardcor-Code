import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import crypto from "crypto";

const LOG_PATHS = [
  join(homedir(), ".local", "share", "opencode", "log", "opencode.log"),
  join(homedir(), "AppData", "Local", "opencode", "log", "opencode.log"),
  join(homedir(), "AppData", "Roaming", "opencode", "log", "opencode.log"),
];

// ses_<alphanumeric> from opencode log: "message=created id=ses_..."
const SESSION_RE = /\bid=(ses_[A-Za-z0-9]+)/g;

// Re-parse at most once every 5 minutes
const REFRESH_MS = 5 * 60 * 1000;

let pool = [];
let lastRefreshed = 0;
let poolIndex = 0;

function findLogPath() {
  for (const p of LOG_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function parseLog(logPath) {
  try {
    const TAIL = 131072;
    const raw = readFileSync(logPath, "utf8");
    const tail = raw.slice(-TAIL);
    const found = new Set();
    SESSION_RE.lastIndex = 0;
    let m;
    while ((m = SESSION_RE.exec(tail)) !== null) found.add(m[1]);
    return [...found];
  } catch {
    return [];
  }
}

function refresh() {
  const now = Date.now();
  if (now - lastRefreshed < REFRESH_MS) return;
  lastRefreshed = now;
  const logPath = findLogPath();
  if (!logPath) return;
  const sessions = parseLog(logPath);
  if (sessions.length > 0) {
    pool = sessions;
    poolIndex = 0;
  }
}

// Seed immediately at import time
refresh();

/**
 * Return a valid OpenCode CLI session ID, rotating through harvested sessions.
 *
 * OpenCode's free tier rejects requests that don't carry a session created by
 * the official CLI (x-opencode-client: "tui"). We source IDs from the opencode
 * log file and rotate round-robin to spread load across sessions.
 *
 * Falls back to a random ses_<uuid> if the log is absent (no opencode install).
 */
export function getOpencodeSessionId() {
  refresh();
  if (pool.length === 0) {
    return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  const id = pool[poolIndex % pool.length];
  poolIndex = (poolIndex + 1) % pool.length;
  return id;
}
