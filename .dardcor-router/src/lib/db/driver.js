import fs from "node:fs";
import path from "node:path";
import { ensureDirs, DB_DIR, DATA_DIR, SYSTEM_DIR } from "./paths.js";
import { TABLES, buildCreateTableSql } from "./schema.js";
import {
  migrateLegacyDatabaseJson,
  importFromModular,
  scheduleModularSave,
  flushModularSaveSync,
  saveProviderSync,
  saveSystemDbSync,
  saveSystemUsageSync,
} from "./modularStore.js";
import { createJsonStoreAdapter } from "./jsonEngine.js";

if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

function detectAndScheduleSave(adapter, sql, params, preDeleteProvider = null) {
  if (!sql || typeof sql !== "string") return;
  const upper = sql.toUpperCase();
  if (upper.startsWith("SELECT") || upper.startsWith("PRAGMA")) return;

  if (upper.includes("SETTINGS")) {
    scheduleModularSave(adapter, { systemDb: "settings" });
  }
  if (upper.includes("APIKEYS") || upper.includes("API_KEYS")) {
    scheduleModularSave(adapter, { systemDb: "api-keys" });
  }
  if (upper.includes("COMBOS")) {
    scheduleModularSave(adapter, { systemDb: "combos" });
  }
  if (upper.includes("PROXYPOOLS") || upper.includes("PROXY_POOLS")) {
    scheduleModularSave(adapter, { systemDb: "proxy-pools" });
  }
  if (upper.includes("PROVIDERNODES") || upper.includes("PROVIDER_NODES")) {
    scheduleModularSave(adapter, { systemDb: "nodes" });
  }
  if (upper.includes("KV")) {
    scheduleModularSave(adapter, { systemDb: "aliases" });
    scheduleModularSave(adapter, { systemDb: "pricing" });
  }
  if (upper.includes("_META")) {
    scheduleModularSave(adapter, { systemDb: "meta" });
  }
  if (upper.includes("USAGEHISTORY") || upper.includes("USAGE_HISTORY")) {
    scheduleModularSave(adapter, { systemUsage: "history" });
  }
  if (upper.includes("USAGEDAILY") || upper.includes("USAGE_DAILY")) {
    scheduleModularSave(adapter, { systemUsage: "daily" });
  }
  if (upper.includes("REQUESTDETAILS") || upper.includes("REQUEST_DETAILS")) {
    scheduleModularSave(adapter, { systemUsage: "request-details" });
  }
  if (upper.includes("PROVIDERCONNECTIONS") || upper.includes("PROVIDER_CONNECTIONS")) {
    let savedAny = false;
    if (preDeleteProvider) {
      scheduleModularSave(adapter, { provider: preDeleteProvider });
      savedAny = true;
    }
    if (params && Array.isArray(params)) {
      for (const p of params) {
        if (
          typeof p === "string" &&
          p.length > 1 &&
          p.length <= 40 &&
          /^[a-zA-Z0-9_-]+$/.test(p) &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(p) &&
          !p.startsWith("dsw-") &&
          !p.startsWith("cgw-") &&
          !p.startsWith("gmw-") &&
          p !== "oauth" &&
          p !== "apikey" &&
          p !== "access_token" &&
          p !== "password"
        ) {
          scheduleModularSave(adapter, { provider: p });
          savedAny = true;
        }
      }
      if (!savedAny) {
        for (const p of params) {
          if (typeof p === "string" && p.length >= 8) {
            const row = adapter.get(`SELECT provider FROM providerConnections WHERE id = ?`, [p]);
            if (row?.provider) {
              scheduleModularSave(adapter, { provider: row.provider });
              savedAny = true;
            }
          }
        }
      }
    }
    if (!savedAny) {
      scheduleModularSave(adapter);
    }
  }
}

function createMemoryAdapter() {
  try {
    const engine = createJsonStoreAdapter();

    const adapterObj = {
      driver: "Full JSON Store",
      tables: engine.tables,
      run: (sql, params = []) => engine.run(sql, params),
      get: (sql, params = []) => engine.get(sql, params),
      all: (sql, params = []) => engine.all(sql, params),
      exec: (sql) => engine.exec(sql),
      transaction: (fn) => engine.transaction(fn),
      flushSync: () => {
        flushModularSaveSync(adapterObj);
      },
      close: () => {
        try { flushModularSaveSync(adapterObj); } catch {}
      },
    };

    return adapterObj;
  } catch (e) {
    console.warn(`[DB] Full JSON Store engine error: ${e.message}`);
    return null;
  }
}

async function initAdapter() {
  ensureDirs();

  const adapter = createMemoryAdapter();
  if (!adapter) throw new Error("[DB] JSON Store initialization failed");

  for (const [name, def] of Object.entries(TABLES)) {
    adapter.exec(buildCreateTableSql(name, def));
  }

  migrateLegacyDatabaseJson();
  importFromModular(adapter);

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);

  const originalRun = adapter.run.bind(adapter);
  adapter.run = (sql, params) => {
    let preDeleteProvider = null;
    if (sql && /DELETE\s+FROM\s+providerConnections/i.test(sql) && Array.isArray(params) && params.length === 1) {
      const existing = adapter.get(`SELECT provider FROM providerConnections WHERE id = ?`, [params[0]]);
      if (existing?.provider) preDeleteProvider = existing.provider;
    }
    const res = originalRun(sql, params);
    detectAndScheduleSave(adapter, sql, params, preDeleteProvider);
    return res;
  };

  const originalTransaction = adapter.transaction.bind(adapter);
  adapter.transaction = (fn) => {
    const res = originalTransaction(fn);
    scheduleModularSave(adapter);
    return res;
  };

  if (!state.exitHookRegistered) {
    state.exitHookRegistered = true;
    const onExitFlush = () => {
      try {
        flushModularSaveSync(adapter);
      } catch {}
    };
    process.once("exit", onExitFlush);
  }

  if (!state.logged) {
    console.log(`[DB] Driver: Full JSON Store | path: ${DATA_DIR}`);
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
