import { getAdapter } from "../driver.js";

export async function getMeta(key, fallback = null) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const db = await getAdapter();
  db.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}

export function getMetaSync(adapter, key, fallback = null) {
  const row = adapter.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

export function setMetaSync(adapter, key, value) {
  adapter.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}
