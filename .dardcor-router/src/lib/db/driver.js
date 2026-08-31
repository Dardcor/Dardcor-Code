import fs from "node:fs";
import path from "node:path";
import { ensureDirs, DB_DIR, DATA_FILE } from "./paths.js";

const DATA_FILE_JSON = path.join(DB_DIR, "database.json");

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

let saveTimeout = null;

function scheduleJsonSave(adapter) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      const tables = adapter.all("SELECT name FROM sqlite_master WHERE type='table'");
      const dump = {};
      for (const t of tables) {
        if (t.name === 'sqlite_sequence') continue;
        dump[t.name] = adapter.all(`SELECT * FROM ${t.name}`);
      }
      fs.writeFileSync(DATA_FILE_JSON, JSON.stringify(dump, null, 2), "utf-8");
    } catch (e) {
      console.error("[DB] Failed to save database.json:", e.message);
    }
  }, 1000);
}

function flushJsonSaveSync(adapter) {
  try {
    const tables = adapter.all("SELECT name FROM sqlite_master WHERE type='table'");
    const dump = {};
    for (const t of tables) {
      if (t.name === 'sqlite_sequence') continue;
      dump[t.name] = adapter.all(`SELECT * FROM ${t.name}`);
    }
    fs.writeFileSync(DATA_FILE_JSON, JSON.stringify(dump, null, 2), "utf-8");
  } catch (e) {
    console.error("[DB] Failed to save database.json:", e.message);
  }
}

function importFromJson(adapter) {
  // If database.json doesn't exist yet, check for legacy data.sqlite and migrate data from it
  const legacySqlite = path.join(DB_DIR, "data.sqlite");
  if (!fs.existsSync(DATA_FILE_JSON) && fs.existsSync(legacySqlite)) {
    try {
      const { DatabaseSync } = require("node:sqlite");
      const oldDb = new DatabaseSync(legacySqlite);
      const tables = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      adapter.transaction(() => {
        for (const t of tables) {
          if (t.name === 'sqlite_sequence') continue;
          const rows = oldDb.prepare(`SELECT * FROM ${t.name}`).all();
          if (!rows || rows.length === 0) continue;
          const cols = Object.keys(rows[0]).map(c => `"${c}"`).join(", ");
          const placeholders = Object.keys(rows[0]).map(() => "?").join(", ");
          const stmt = `INSERT OR REPLACE INTO ${t.name} (${cols}) VALUES (${placeholders})`;
          for (const row of rows) {
            adapter.run(stmt, Object.values(row));
          }
        }
      });
      oldDb.close();
      flushJsonSaveSync(adapter);
      console.log(`[DB] Migrated data from legacy ${legacySqlite} to ${DATA_FILE_JSON}`);
      return;
    } catch (e) {
      console.warn(`[DB] Migration from legacy data.sqlite failed: ${e.message}`);
    }
  }

  if (!fs.existsSync(DATA_FILE_JSON)) return;
  try {
    const dump = JSON.parse(fs.readFileSync(DATA_FILE_JSON, "utf-8"));
    adapter.transaction(() => {
      for (const [table, rows] of Object.entries(dump)) {
        if (!rows || rows.length === 0) continue;
        // Check if table exists
        const exists = adapter.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (!exists) continue;
        
        const cols = Object.keys(rows[0]).map(c => `"${c}"`).join(", ");
        const placeholders = Object.keys(rows[0]).map(() => "?").join(", ");
        const stmt = `INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${placeholders})`;
        for (const row of rows) {
          adapter.run(stmt, Object.values(row));
        }
      }
    });
    console.log(`[DB] Loaded data from ${DATA_FILE_JSON}`);
  } catch (e) {
    console.error("[DB] Failed to load database.json:", e.message);
  }
}

function createMemoryAdapter() {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    
    function executeStmt(stmt, method, params) {
      if (!params || (Array.isArray(params) && params.length === 0)) {
        return stmt[method]();
      }
      if (Array.isArray(params)) {
        return stmt[method](...params);
      }
      return stmt[method](params);
    }

    return {
      driver: "JSON Store",
      run: (sql, params = []) => {
        const stmt = db.prepare(sql);
        const result = executeStmt(stmt, 'run', params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      },
      get: (sql, params = []) => {
        const stmt = db.prepare(sql);
        return executeStmt(stmt, 'get', params);
      },
      all: (sql, params = []) => {
        const stmt = db.prepare(sql);
        return executeStmt(stmt, 'all', params);
      },
      exec: (sql) => {
        db.exec(sql);
      },
      transaction: (fn) => {
        db.exec("BEGIN");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
      close: () => {
        db.close();
      }
    };
  } catch (e) {
    console.warn(`[DB] JSON Store engine unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter() {
  ensureDirs();
  
  const adapter = createMemoryAdapter();
  if (!adapter) throw new Error("[DB] JSON Store initialization failed");

  // Run migrations FIRST to create schema before importing JSON
  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);

  // Import existing JSON data
  importFromJson(adapter);

  // Wrap adapter methods to intercept writes and sync to database.json
  const originalRun = adapter.run.bind(adapter);
  adapter.run = (sql, params) => {
    const res = originalRun(sql, params);
    if (!sql.toUpperCase().startsWith("SELECT")) {
      scheduleJsonSave(adapter);
    }
    return res;
  };

  const originalTransaction = adapter.transaction.bind(adapter);
  adapter.transaction = (fn) => {
    const res = originalTransaction(fn);
    scheduleJsonSave(adapter);
    return res;
  };

  if (!state.logged) {
    console.log(`[DB] Driver: JSON Store | file: ${DATA_FILE_JSON}`);
    state.logged = true;
  }

  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
