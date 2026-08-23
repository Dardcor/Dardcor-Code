import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const selectColumns = "id, userId, sessionId, content, metadata, createdAt, updatedAt";

function mapRow(row) {
  return row ? { ...row, metadata: parseJson(row.metadata, {}) } : null;
}

function scopeParams(scope) {
  return [scope.userId, scope.sessionId || ""];
}

function ftsQuery(value) {
  return value.trim().split(/\s+/).map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

export class MemoryFtsUnavailableError extends Error {
  constructor(detail = "FTS5 is unavailable for the active SQLite driver") {
    super(detail);
    this.name = "MemoryFtsUnavailableError";
    this.code = "FTS5_UNAVAILABLE";
    this.status = 503;
  }
}

function hasMemoryFts(db) {
  return Boolean(db.get(
    `SELECT 1 AS available FROM sqlite_master WHERE type = 'table' AND name = 'memoryFts'`
  ));
}

function requireMemoryFts(db) {
  if (!hasMemoryFts(db)) throw new MemoryFtsUnavailableError();
}

export async function createMemory({ userId, sessionId = "", content, metadata = {} }) {
  const db = await getAdapter();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO memories(id, userId, sessionId, content, metadata, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, sessionId, content, stringifyJson(metadata), now, now]
  );
  return getMemory(id, { userId, sessionId });
}

export async function getMemory(id, scope) {
  const db = await getAdapter();
  return mapRow(db.get(
    `SELECT ${selectColumns} FROM memories WHERE id = ? AND userId = ? AND sessionId = ?`,
    [id, ...scopeParams(scope)]
  ));
}

export async function listMemories({ userId, sessionId = "", limit = 50, offset = 0 }) {
  const db = await getAdapter();
  return db.all(
    `SELECT ${selectColumns} FROM memories WHERE userId = ? AND sessionId = ? ORDER BY updatedAt DESC, id LIMIT ? OFFSET ?`,
    [userId, sessionId, limit, offset]
  ).map(mapRow);
}

export async function updateMemory(id, scope, changes) {
  const db = await getAdapter();
  const existing = await getMemory(id, scope);
  if (!existing) return null;
  const content = changes.content ?? existing.content;
  const metadata = changes.metadata ?? existing.metadata;
  const updatedAt = new Date().toISOString();
  db.run(
    `UPDATE memories SET content = ?, metadata = ?, updatedAt = ? WHERE id = ? AND userId = ? AND sessionId = ?`,
    [content, stringifyJson(metadata), updatedAt, id, ...scopeParams(scope)]
  );
  return getMemory(id, scope);
}

export async function deleteMemory(id, scope) {
  const db = await getAdapter();
  return db.run(
    `DELETE FROM memories WHERE id = ? AND userId = ? AND sessionId = ?`,
    [id, ...scopeParams(scope)]
  ).changes > 0;
}

export async function searchMemories({ userId, sessionId = "", query, limit = 20 }) {
  const db = await getAdapter();
  requireMemoryFts(db);
  return db.all(
    `SELECT ${selectColumns.replaceAll(/\b(id|userId|sessionId|content|metadata|createdAt|updatedAt)\b/g, "m.$1")}, bm25(memoryFts) AS score
       FROM memoryFts JOIN memories m ON m.rowid = memoryFts.rowid
      WHERE memoryFts MATCH ? AND m.userId = ? AND m.sessionId = ?
      ORDER BY score, m.updatedAt DESC LIMIT ?`,
    [ftsQuery(query), userId, sessionId, limit]
  ).map(mapRow);
}

export async function reindexMemories() {
  const db = await getAdapter();
  requireMemoryFts(db);
  db.run(`INSERT INTO memoryFts(memoryFts) VALUES('rebuild')`);
  return { indexed: Number(db.get(`SELECT count(*) AS count FROM memoryFts`)?.count || 0) };
}

export async function getMemoryHealth() {
  const db = await getAdapter();
  const entries = Number(db.get(`SELECT count(*) AS count FROM memories`)?.count || 0);
  if (!hasMemoryFts(db)) {
    return {
      ok: false,
      available: false,
      status: "degraded",
      reason: "FTS5 is unavailable for the active SQLite driver",
      driver: db.driver,
      entries,
      indexed: null,
    };
  }
  try {
    const indexed = Number(db.get(`SELECT count(*) AS count FROM memoryFts`)?.count || 0);
    return { ok: entries === indexed, available: true, status: entries === indexed ? "healthy" : "degraded", driver: db.driver, entries, indexed };
  } catch (error) {
    return {
      ok: false,
      available: false,
      status: "degraded",
      reason: `Memory FTS5 index unavailable: ${error.message}`,
      driver: db.driver,
      entries,
      indexed: null,
    };
  }
}
