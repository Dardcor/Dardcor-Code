import path from "node:path";
import fs from "node:fs";
import { getDataDir, DATA_DIR } from "../dataDir.js";

export { DATA_DIR, getDataDir };

export const DB_DIR = path.join(DATA_DIR, "db");
export const DATA_FILE = path.join(DB_DIR, "database.json");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const LEGACY_BACKUPS_DIR = path.join(DB_DIR, "backups");

export const PROVIDERS_DIR = path.join(DATA_DIR, "provider");

export const SYSTEM_DIR = path.join(DATA_DIR, "system");
export const SYSTEM_DB_DIR = path.join(SYSTEM_DIR, "db");
export const SYSTEM_USAGE_DIR = path.join(SYSTEM_DIR, "usage");

export const LEGACY_FILES = {
  main: path.join(DATA_DIR, "db.json"),
  usage: path.join(DATA_DIR, "usage.json"),
  disabled: path.join(DATA_DIR, "disabledModels.json"),
  details: path.join(DATA_DIR, "request-details.json"),
};

export function getProvidersDir(baseDir = DATA_DIR) {
  return path.join(baseDir, "provider");
}

export function getBackupsDir(baseDir = DATA_DIR) {
  return path.join(baseDir, "backups");
}

export function getSystemDbDir(baseDir = DATA_DIR) {
  return path.join(baseDir, "system", "db");
}

export function getSystemUsageDir(baseDir = DATA_DIR) {
  return path.join(baseDir, "system", "usage");
}

export function ensureDirs(baseDir = DATA_DIR) {
  const dirs = [
    baseDir,
    path.join(baseDir, "provider"),
    path.join(baseDir, "backups"),
    path.join(baseDir, "system"),
    path.join(baseDir, "system", "db"),
    path.join(baseDir, "system", "usage"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
