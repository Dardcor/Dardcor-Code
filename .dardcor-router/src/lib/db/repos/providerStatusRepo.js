import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { saveProviderStatusSync, ALL_CANONICAL_PROVIDERS, KNOWN_DIR_TO_PROVIDER } from "../modularStore.js";

const SCOPE = "providerStatus";

export async function getAllProviderStatuses() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const statuses = {};

  for (const dirName of ALL_CANONICAL_PROVIDERS) {
    const defaultKey = KNOWN_DIR_TO_PROVIDER[dirName.toLowerCase()] || dirName.toLowerCase();
    statuses[defaultKey] = false;
  }

  for (const r of rows) {
    const parsed = parseJson(r.value, null);
    if (parsed && typeof parsed === "object" && typeof parsed.enabled === "boolean") {
      statuses[r.key.toLowerCase()] = parsed.enabled;
    } else if (typeof parsed === "boolean") {
      statuses[r.key.toLowerCase()] = parsed;
    }
  }
  return statuses;
}

export async function getProviderStatus(providerId) {
  if (!providerId) return false;
  const db = await getAdapter();
  const key = providerId.toLowerCase();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, key]);
  if (!row) return false;
  const parsed = parseJson(row.value, null);
  if (parsed && typeof parsed === "object" && typeof parsed.enabled === "boolean") {
    return parsed.enabled;
  }
  if (typeof parsed === "boolean") return parsed;
  return false;
}

export async function setProviderStatus(providerId, enabled) {
  if (!providerId) return { provider: providerId, enabled: false };
  const db = await getAdapter();
  const key = providerId.toLowerCase();
  const isEnabled = Boolean(enabled);
  const data = {
    provider: key,
    enabled: isEnabled,
    updatedAt: new Date().toISOString(),
  };

  db.transaction(() => {
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, key, stringifyJson(data)]
    );
  });

  try {
    saveProviderStatusSync(db, key, isEnabled);
  } catch (err) {
    console.warn(`[DB] Failed to sync provider status file for ${providerId}:`, err.message);
  }

  return { provider: key, enabled: isEnabled, updatedAt: data.updatedAt };
}
