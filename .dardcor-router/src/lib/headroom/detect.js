import { execFileSync, execSync } from "child_process";
import path from "path";

export const HEADROOM_COMPRESSION_EXTRAS = ["code", "ml"];

export const EXTRA_MARKERS = {
  code: ["tree-sitter", "tree-sitter-language-pack"],
  ml: ["torch", "huggingface-hub"],
};

const HEADROOM_PIP_TIMEOUT_MS = 8000;

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

const EXTRA_BINS = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

export function findHeadroomBinary() {
  try {
    const out = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

function pythonCandidates() {
  const list = [];
  const bin = findHeadroomBinary();
  if (bin) {
    const dir = path.dirname(bin);
    const names = IS_WIN ? ["python.exe", "python3.exe"] : ["python3", "python3.13", "python"];
    for (const n of names) list.push(path.join(dir, n));
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES) list.push(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  list.push(...PYTHON_CANDIDATES);
  return list;
}

export function findPython310() {
  let fallback = null;
  for (const candidate of pythonCandidates()) {
    try {
      const ver = execSync(`${candidate} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      }).toString().trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) continue;
      if (!fallback) fallback = candidate;
      try {
        execFileSync(candidate, ["-m", "pip", "show", "headroom-ai"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: HEADROOM_PIP_TIMEOUT_MS,
          env: { ...process.env, PATH: EXTENDED_PATH },
        });
        return candidate;
      } catch {
      }
    } catch {
    }
  }
  return fallback;
}

export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function getHeadroomStatus(url) {
  const path = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(path);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  const extrasStatus = installed ? getInstalledHeadroomExtras(python) : { installed: false, version: null, extras: { code: false, ml: false } };
  return {
    installed,
    path,
    running,
    python,
    localUrl,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
  };
}

export function getInstalledHeadroomExtras(python) {
  const py = python || findPython310();
  if (!py) return { installed: false, version: null, extras: { code: false, ml: false } };
  try {
    const out = execFileSync(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: HEADROOM_PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString();
    const packages = JSON.parse(out);
    const names = new Set(packages.map((p) => String(p.name || "").toLowerCase()));
    const installed = names.has("headroom-ai");
    if (!installed) return { installed: false, version: null, extras: { code: false, ml: false } };
    const version = packages.find((p) => p.name?.toLowerCase() === "headroom-ai")?.version || null;
    const extras = {};
    for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
      extras[extra] = EXTRA_MARKERS[extra].some((m) => names.has(m));
    }
    return { installed: true, version, extras };
  } catch {
    return { installed: false, version: null, extras: { code: false, ml: false } };
  }
}
