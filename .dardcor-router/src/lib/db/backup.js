// DB safety backups — taken ONLY before a schema change (see migrate.js).
//
// ⚠️ AGENT/DEV NOTES:
// - Backups are a best-effort safety net before schema migrations. There is NO
//   automated restore path; recovery is manual (copy a backup file back).
// - Backups intentionally EXCLUDE the `requestDetails` table (observability log,
//   auto-pruned, non-critical) so a multi-hundred-MB DB backs up as a few MB.
// - Only the newest KEEP_BACKUPS are kept; older ones are pruned automatically.
import fs from "node:fs";
import path from "node:path";
import { getBackupsDir, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
const BACKUP_EXCLUDE_TABLES = ["requestDetails"];

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  const dir = path.join(getBackupsDir(), slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

// Lightweight DB backup: serializes in-memory table collections into JSON,
// excluding observability log, so the backup stays small regardless of DB size.
export function backupDbLite(adapter, destDir, destName = "database.json") {
  const dest = path.join(destDir, destName);
  try {
    const excluded = new Set(BACKUP_EXCLUDE_TABLES);
    const tables = adapter
      .all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .filter((t) => !excluded.has(t.name));

    const dump = {};
    for (const t of tables) {
      dump[t.name] = adapter.all(`SELECT * FROM ${t.name}`);
    }
    fs.writeFileSync(dest, JSON.stringify(dump, null, 2), "utf-8");
  } catch (e) {
    console.warn(`[DB] JSON Backup failed: ${e.message}`);
  }
  return dest;
}

export function pruneOldBackups() {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) return;
  const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(backupsDir, e.name), mtime: fs.statSync(path.join(backupsDir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch {}
  }
}
