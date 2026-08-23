import crypto from "node:crypto";
import path from "node:path";

// Secret-bearing or unsafe keys that must never survive into API responses,
// audit records, or install manifests.
const REDACTED_KEYS = /token|secret|password|authorization|cookie|headers|payload|pathOnDisk|apikey|api_key/i;

// Hard limits applied to any remote manifest or file before it is staged.
export const LIMITS = Object.freeze({
  MAX_SKILL_FILE_BYTES: 256 * 1024, // 256 KiB per file
  MAX_MANIFEST_BYTES: 64 * 1024, // 64 KiB manifest payload
  MAX_FILES: 64, // files per skill
  MAX_META_FIELDS: 256, // manifest metadata entries
});

const SAFE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Collapse an arbitrary string into a filesystem-safe slug.
 * Rejects nothing (best-effort sanitize) so a bad upstream name cannot break
 * discovery — it just becomes a normalized directory name.
 */
export function sanitizeSlug(value) {
  const raw = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return raw || "skill";
}

export function isSafeSlug(value) {
  return typeof value === "string" && SAFE_SLUG_RE.test(value);
}

/**
 * Reject any relative path that could escape the install root via traversal,
 * absolute paths, NUL bytes, or Windows separators.
 */
export function validateRelativePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return { ok: false, reason: "empty path" };
  }
  if (relativePath.includes("\0")) return { ok: false, reason: "null byte" };
  if (relativePath.includes("\\")) return { ok: false, reason: "backslash" };
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    return { ok: false, reason: "absolute path" };
  }
  const segments = relativePath.split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) {
    return { ok: false, reason: "traversal" };
  }
  return { ok: true };
}

/**
 * Verify a resolved path stays inside the given root (symlink-safe at install
 * time by re-resolving realpath before writes).
 */
export function assertWithinRoot(root, resolved) {
  const rootResolved = path.resolve(root);
  const targetResolved = path.resolve(resolved);
  if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + path.sep)) {
    return false;
  }
  return true;
}

export function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Strip secret-bearing or unsafe keys recursively from a metadata object.
 * Returns a new object; never mutates the input.
 */
export function redactMetadata(value, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => redactMetadata(v, depth + 1)).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (REDACTED_KEYS.test(key)) continue;
      const cleaned = redactMetadata(val, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

/**
 * Validate a file manifest entry. Each entry must carry a relative path and a
 * bounded size; checksums are mandatory for anything staged from a remote.
 */
export function validateFileEntry(entry) {
  if (!entry || typeof entry !== "object") return { ok: false, reason: "invalid entry" };
  const rel = validateRelativePath(entry.path);
  if (!rel.ok) return rel;
  const size = Number(entry.size);
  if (!Number.isFinite(size) || size < 0 || size > LIMITS.MAX_SKILL_FILE_BYTES) {
    return { ok: false, reason: "size out of range" };
  }
  if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    return { ok: false, reason: "missing checksum" };
  }
  // No executable scripts, hooks, or binaries are ever staged or run.
  if (/\.(sh|exe|bat|cmd|ps1|dll|so|dylib)$/i.test(entry.path)) {
    return { ok: false, reason: "executable entry refused" };
  }
  return { ok: true, entry: { path: entry.path, size, sha256: entry.sha256 } };
}

/**
 * Validate a whole manifest: bounded files, no duplicate paths, no executable
 * hook entries we refuse to stage.
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return { ok: false, reason: "invalid manifest" };
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    return { ok: false, reason: "missing name" };
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length > LIMITS.MAX_FILES) return { ok: false, reason: "too many files" };
  const seen = new Set();
  const cleaned = [];
  for (const entry of files) {
    const result = validateFileEntry(entry);
    if (!result.ok) return result;
    if (seen.has(result.entry.path)) return { ok: false, reason: "duplicate path" };
    seen.add(result.entry.path);
    // No executable scripts, hooks, or binaries are ever staged or run.
    if (/\.(sh|exe|bat|cmd|ps1|dll|so|dylib)$/i.test(result.entry.path)) {
      return { ok: false, reason: "executable entry refused" };
    }
    cleaned.push(result.entry);
  }
  return { ok: true, manifest: { name: manifest.name.trim(), files: cleaned } };
}

export const __test__ = { validateRelativePath, assertWithinRoot, redactMetadata, sanitizeSlug };
