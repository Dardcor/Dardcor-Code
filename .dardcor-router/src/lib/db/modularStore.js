import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR,
  getDataDir,
  BACKUPS_DIR,
  LEGACY_BACKUPS_DIR,
  SYSTEM_DB_DIR,
  SYSTEM_USAGE_DIR,
  PROVIDERS_DIR,
  getProvidersDir,
  getBackupsDir,
  getSystemDbDir,
  getSystemUsageDir,
} from "./paths.js";
import { parseJson, stringifyJson } from "./helpers/jsonCol.js";
import { makeBackupDir, backupFile } from "./backup.js";

function getBaseDir(baseDir) {
  return baseDir || getDataDir();
}

export function getProvidersRootDir(baseDir) {
  baseDir = getBaseDir(baseDir);
  return path.join(baseDir, "provider");
}

// Canonical directory names for known providers
const KNOWN_PROVIDER_DIRS = {
  antigravity: "Antigravity",
  gemini: "Gemini",
  "gemini-cli": "Gemini-CLI",
  openai: "OpenAI",
  codex: "OpenAI-Codex",
  claude: "Claude",
  deepseek: "DeepSeek",
  xai: "Grok",
  "grok-cli": "Grok-CLI",
  "grok-web": "Grok-Web",
  qoder: "Qoder",
  groq: "Groq",
  mistral: "Mistral",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  "ollama-local": "Ollama-Local",
  github: "GitHub-Copilot",
  gitlab: "GitLab-Duo",
  kimi: "Kimi",
  kiro: "Kiro",
  kilocode: "KiloCode",
  perplexity: "Perplexity",
  "perplexity-web": "Perplexity-Web",
  minimax: "Minimax",
  "minimax-cn": "Minimax-CN",
  glm: "GLM",
  "glm-cn": "GLM-CN",
  together: "Together",
  cohere: "Cohere",
  fireworks: "Fireworks",
  cerebras: "Cerebras",
  chutes: "Chutes",
  nebius: "Nebius",
  nvidia: "Nvidia",
  siliconflow: "SiliconFlow",
  "volcengine-ark": "Volcengine",
  alicode: "AliCode",
  "alicode-intl": "AliCode-Intl",
  opencode: "OpenCode",
  "opencode-go": "OpenCode-Go",
  cursor: "Cursor",
  qwen: "Qwen",
  iflow: "iFlow",
};

export const ALL_CANONICAL_PROVIDERS = Array.from(new Set(Object.values(KNOWN_PROVIDER_DIRS)));

// Runtime cache of discovered provider folders
const discoveredProviderDirs = new Map();

export function registerProviderDir(providerId, dirName) {
  if (providerId && dirName) {
    discoveredProviderDirs.set(providerId.toLowerCase(), dirName);
  }
}

export function getProviderDirName(providerId) {
  if (!providerId) return "Unknown";
  const lower = providerId.toLowerCase();
  if (discoveredProviderDirs.has(lower)) {
    return discoveredProviderDirs.get(lower);
  }
  if (KNOWN_PROVIDER_DIRS[providerId]) return KNOWN_PROVIDER_DIRS[providerId];
  if (KNOWN_PROVIDER_DIRS[lower]) return KNOWN_PROVIDER_DIRS[lower];

  // Capitalize words / replace spaces with hyphens
  return providerId
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

export function resolveProviderDbPath(providerId, baseDir) {
  baseDir = getBaseDir(baseDir);
  const provRoot = path.join(baseDir, "provider");
  const preferred = getProviderDirName(providerId);
  const candidates = [
    preferred,
    preferred.replace(/-/g, " "),
    preferred.replace(/\s+/g, "-"),
    providerId,
    providerId.toLowerCase(),
  ];

  for (const name of candidates) {
    // 1. Target path: provider/provider/{Name}/{Name}.json
    const targetFile = path.join(provRoot, name, `${name}.json`);
    if (fs.existsSync(targetFile)) {
      registerProviderDir(providerId, name);
      return { dirName: name, dirPath: path.join(provRoot, name), filePath: targetFile };
    }

    // 2. Migration from older root level: provider/{Name}/{Name}.json
    const olderFile = path.join(baseDir, name, `${name}.json`);
    if (fs.existsSync(olderFile)) {
      try {
        const targetDir = path.join(provRoot, name);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(olderFile, targetFile);
        fs.unlinkSync(olderFile);
        try { fs.rmdirSync(path.join(baseDir, name)); } catch {}
        registerProviderDir(providerId, name);
        return { dirName: name, dirPath: targetDir, filePath: targetFile };
      } catch {
        registerProviderDir(providerId, name);
        return { dirName: name, dirPath: path.join(baseDir, name), filePath: olderFile };
      }
    }

    // 3. Backward compatibility with older nested db folder: provider/{Name}/db/{Name}.json
    const legacyNestedFile = path.join(baseDir, name, "db", `${name}.json`);
    if (fs.existsSync(legacyNestedFile)) {
      try {
        const targetDir = path.join(provRoot, name);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(legacyNestedFile, targetFile);
        fs.unlinkSync(legacyNestedFile);
        try { fs.rmdirSync(path.join(baseDir, name, "db")); } catch {}
        try { fs.rmdirSync(path.join(baseDir, name)); } catch {}
        registerProviderDir(providerId, name);
        return { dirName: name, dirPath: targetDir, filePath: targetFile };
      } catch {}
    }
  }

  const dirPath = path.join(provRoot, preferred);
  const filePath = path.join(dirPath, `${preferred}.json`);
  return { dirName: preferred, dirPath, filePath };
}

/**
 * Ensures all canonical provider folders and their .json files exist in provider/provider/{Name}/{Name}.json
 */
export function ensureAllProviderFoldersExist(baseDir) {
  baseDir = getBaseDir(baseDir);
  const provRoot = path.join(baseDir, "provider");
  if (!fs.existsSync(provRoot)) {
    fs.mkdirSync(provRoot, { recursive: true });
  }

  for (const provDirName of ALL_CANONICAL_PROVIDERS) {
    const dir = path.join(provRoot, provDirName);
    const file = path.join(dir, `${provDirName}.json`);

    // Check if older file exists directly at baseDir/{provDirName}/...
    const olderFile = path.join(baseDir, provDirName, `${provDirName}.json`);
    const legacyNested = path.join(baseDir, provDirName, "db", `${provDirName}.json`);

    if (fs.existsSync(legacyNested)) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(file)) {
          fs.copyFileSync(legacyNested, file);
        }
        fs.unlinkSync(legacyNested);
        try { fs.rmdirSync(path.join(baseDir, provDirName, "db")); } catch {}
        try { fs.rmdirSync(path.join(baseDir, provDirName)); } catch {}
      } catch {}
    }

    if (fs.existsSync(olderFile)) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(file)) {
          fs.copyFileSync(olderFile, file);
        }
        fs.unlinkSync(olderFile);
        try { fs.rmdirSync(path.join(baseDir, provDirName)); } catch {}
      } catch {}
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "[]\n", "utf-8");
    }
  }
}

/**
 * Checks whether modular structure has been established (system/db/settings.json exists)
 */
export function isModularStructureCreated(baseDir) {
  baseDir = getBaseDir(baseDir);
  const settingsFile = path.join(getSystemDbDir(baseDir), "settings.json");
  return fs.existsSync(settingsFile);
}

/**
 * Locates legacy database.json file if present
 */
export function findLegacyDatabaseJson(baseDir) {
  baseDir = getBaseDir(baseDir);
  const inDb = path.join(baseDir, "db", "database.json");
  if (fs.existsSync(inDb)) return inDb;
  const inRoot = path.join(baseDir, "database.json");
  if (fs.existsSync(inRoot)) return inRoot;
  return null;
}

/**
 * Performs automated zero-data-loss migration from monolithic database.json
 * into the modular layout.
 */
export function migrateLegacyDatabaseJson(baseDir) {
  baseDir = getBaseDir(baseDir);
  const legacyPath = findLegacyDatabaseJson(baseDir);
  if (!legacyPath) return false;

  // If modular structure has already been initialized, skip
  if (isModularStructureCreated(baseDir)) return false;

  let legacy;
  try {
    const raw = fs.readFileSync(legacyPath, "utf-8");
    if (!raw.trim()) return false;
    legacy = JSON.parse(raw);
  } catch (e) {
    console.warn(`[DB][migration] Failed to parse ${legacyPath}: ${e.message}`);
    return false;
  }

  console.log(`[DB][migration] Starting automatic migration from ${legacyPath}...`);

  // 1. Create full safety backup in backups/
  const backupsDir = getBackupsDir(baseDir);
  fs.mkdirSync(backupsDir, { recursive: true });
  try {
    const backupDir = makeBackupDir("migrate-database-json");
    backupFile(legacyPath, backupDir, "database.json");
    fs.copyFileSync(legacyPath, path.join(backupsDir, "database.json.bak"));
    console.log(`[DB][migration] Safety backup created at ${backupsDir}`);
  } catch (e) {
    console.warn(`[DB][migration] Warning: Failed to create safety backup: ${e.message}`);
  }

  // 2. Move existing db/backups/ contents to backups/
  const oldBackupsDir = path.join(baseDir, "db", "backups");
  if (fs.existsSync(oldBackupsDir)) {
    try {
      const entries = fs.readdirSync(oldBackupsDir, { withFileTypes: true });
      for (const entry of entries) {
        const src = path.join(oldBackupsDir, entry.name);
        const dst = path.join(backupsDir, entry.name);
        if (!fs.existsSync(dst)) {
          fs.cpSync(src, dst, { recursive: true });
          fs.rmSync(src, { recursive: true, force: true });
        }
      }
      try { fs.rmdirSync(oldBackupsDir); } catch {}
      console.log(`[DB][migration] Moved legacy backups to ${backupsDir}`);
    } catch (e) {
      console.warn(`[DB][migration] Warning: Failed to move old backups: ${e.message}`);
    }
  }

  // 3. Extract all providerConnections rows into provider/{ProviderName}/{ProviderName}.json
  const connections = legacy.providerConnections || [];
  const byProvider = {};
  for (const c of connections) {
    const p = c.provider || "unknown";
    if (!byProvider[p]) byProvider[p] = [];
    byProvider[p].push(c);
  }

  for (const [providerId, connRows] of Object.entries(byProvider)) {
    const { dirName, dirPath, filePath } = resolveProviderDbPath(providerId, baseDir);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(connRows, null, 2), "utf-8");
    registerProviderDir(providerId, dirName);
    console.log(`[DB][migration] Extracted ${connRows.length} account(s) for ${providerId} → ${filePath}`);
  }

  // Ensure all canonical providers also exist immediately
  ensureAllProviderFoldersExist(baseDir);

  // 4. Extract settings, apiKeys, combos, proxyPools, and kv tables into system/db/
  const sysDbDir = getSystemDbDir(baseDir);
  fs.mkdirSync(sysDbDir, { recursive: true });

  // 4a. settings.json
  let settingsObj = {};
  if (Array.isArray(legacy.settings) && legacy.settings.length > 0) {
    const s0 = legacy.settings[0];
    if (s0 && s0.data) {
      settingsObj = parseJson(s0.data, {});
    } else if (s0) {
      const { id, ...rest } = s0;
      settingsObj = rest;
    }
  } else if (legacy.settings && typeof legacy.settings === "object") {
    settingsObj = legacy.settings;
  }
  fs.writeFileSync(path.join(sysDbDir, "settings.json"), JSON.stringify(settingsObj, null, 2), "utf-8");

  // 4b. api-keys.json
  fs.writeFileSync(path.join(sysDbDir, "api-keys.json"), JSON.stringify(legacy.apiKeys || [], null, 2), "utf-8");

  // 4c. combos.json
  fs.writeFileSync(path.join(sysDbDir, "combos.json"), JSON.stringify(legacy.combos || [], null, 2), "utf-8");

  // 4d. proxy-pools.json
  fs.writeFileSync(path.join(sysDbDir, "proxy-pools.json"), JSON.stringify(legacy.proxyPools || [], null, 2), "utf-8");

  // 4e. aliases.json & pricing.json from kv
  const aliasesObj = {
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    disabledModels: {},
  };
  const pricingObj = {};

  for (const r of legacy.kv || []) {
    if (r.scope === "modelAliases") {
      aliasesObj.modelAliases[r.key] = parseJson(r.value, r.value);
    } else if (r.scope === "customModels") {
      aliasesObj.customModels.push(parseJson(r.value, r.value));
    } else if (r.scope === "mitmAlias") {
      aliasesObj.mitmAlias[r.key] = parseJson(r.value, r.value);
    } else if (r.scope === "disabledModels") {
      aliasesObj.disabledModels[r.key] = parseJson(r.value, r.value);
    } else if (r.scope === "pricing") {
      pricingObj[r.key] = parseJson(r.value, r.value);
    }
  }
  fs.writeFileSync(path.join(sysDbDir, "aliases.json"), JSON.stringify(aliasesObj, null, 2), "utf-8");
  fs.writeFileSync(path.join(sysDbDir, "pricing.json"), JSON.stringify(pricingObj, null, 2), "utf-8");

  // 4f. nodes.json
  if (Array.isArray(legacy.providerNodes) && legacy.providerNodes.length > 0) {
    fs.writeFileSync(path.join(sysDbDir, "nodes.json"), JSON.stringify(legacy.providerNodes, null, 2), "utf-8");
  }

  // 4g. meta.json
  const metaObj = {};
  for (const r of legacy._meta || []) {
    metaObj[r.key] = r.value;
  }
  fs.writeFileSync(path.join(sysDbDir, "meta.json"), JSON.stringify(metaObj, null, 2), "utf-8");

  // 5. Extract usageHistory, usageDaily, and requestDetails tables into system/usage/
  const sysUsageDir = getSystemUsageDir(baseDir);
  fs.mkdirSync(sysUsageDir, { recursive: true });
  fs.writeFileSync(path.join(sysUsageDir, "history.json"), JSON.stringify(legacy.usageHistory || [], null, 2), "utf-8");
  fs.writeFileSync(path.join(sysUsageDir, "daily.json"), JSON.stringify(legacy.usageDaily || [], null, 2), "utf-8");
  fs.writeFileSync(path.join(sysUsageDir, "request-details.json"), JSON.stringify(legacy.requestDetails || [], null, 2), "utf-8");

  // 6. Rename legacy database.json to database.json.migrated
  try {
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);
    console.log(`[DB][migration] Successfully renamed ${legacyPath} to ${legacyPath}.migrated`);
  } catch (e) {
    console.warn(`[DB][migration] Could not rename ${legacyPath}: ${e.message}`);
  }

  return true;
}

/**
 * Loads all partitioned provider JSON files from dataDir subdirectories into in-memory store
 */
export function loadAllProvidersFromDisk(adapter, baseDir) {
  baseDir = getBaseDir(baseDir);
  if (!fs.existsSync(baseDir)) return;

  const provRoot = path.join(baseDir, "provider");
  if (!fs.existsSync(provRoot)) {
    fs.mkdirSync(provRoot, { recursive: true });
  }

  // 1. Check for legacy provider folders directly under baseDir and migrate them
  const reserved = new Set(["system", "backups", "db", "logs", "auth", "node_modules", ".git", "catalog", "runtime", "provider"]);
  const rootEntries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    if (reserved.has(entry.name.toLowerCase())) continue;

    const legacyDir = path.join(baseDir, entry.name);
    const targetDir = path.join(provRoot, entry.name);
    const legacyFile = path.join(legacyDir, `${entry.name}.json`);
    const legacyNestedFile = path.join(legacyDir, "db", `${entry.name}.json`);
    const targetFile = path.join(targetDir, `${entry.name}.json`);

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (fs.existsSync(legacyNestedFile) && !fs.existsSync(targetFile)) {
        fs.copyFileSync(legacyNestedFile, targetFile);
        try { fs.unlinkSync(legacyNestedFile); } catch {}
        try { fs.rmdirSync(path.join(legacyDir, "db")); } catch {}
      }
      if (fs.existsSync(legacyFile) && !fs.existsSync(targetFile)) {
        fs.copyFileSync(legacyFile, targetFile);
        try { fs.unlinkSync(legacyFile); } catch {}
      }
      try {
        const remaining = fs.readdirSync(legacyDir);
        if (remaining.length === 0) {
          fs.rmdirSync(legacyDir);
        }
      } catch {}
    } catch (e) {
      console.warn(`[DB] Failed migrating legacy root provider directory ${entry.name}: ${e.message}`);
    }
  }

  // 2. Read all provider directories from provRoot
  const entries = fs.readdirSync(provRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const provDir = path.join(provRoot, entry.name);
    let provFile = path.join(provDir, `${entry.name}.json`);
    if (!fs.existsSync(provFile)) {
      const nestedFile = path.join(provDir, "db", `${entry.name}.json`);
      if (fs.existsSync(nestedFile)) {
        try {
          fs.copyFileSync(nestedFile, provFile);
          fs.unlinkSync(nestedFile);
          try { fs.rmdirSync(path.join(provDir, "db")); } catch {}
        } catch {
          provFile = nestedFile;
        }
      } else {
        const files = fs.readdirSync(provDir).filter((f) => f.endsWith(".json"));
        if (files.length > 0) provFile = path.join(provDir, files[0]);
        else continue;
      }
    }

    try {
      const raw = JSON.parse(fs.readFileSync(provFile, "utf-8"));
      const rows = Array.isArray(raw) ? raw : (raw.connections || raw.providerConnections || []);
      for (const c of rows) {
        const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, data, ...rest } = c;
        const connData = data
          ? (typeof data === "string" ? data : stringifyJson(data))
          : stringifyJson(rest);
        const resolvedProv = provider || entry.name.toLowerCase();
        registerProviderDir(resolvedProv, entry.name);

        adapter.run(
          `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            resolvedProv,
            authType || "oauth",
            name || null,
            email || null,
            priority ?? null,
            isActive === false || isActive === 0 ? 0 : 1,
            connData,
            createdAt || new Date().toISOString(),
            updatedAt || new Date().toISOString(),
          ]
        );
      }
    } catch (e) {
      console.warn(`[DB] Failed to load provider file ${provFile}: ${e.message}`);
    }
  }
}

/**
 * Populates Full JSON in-memory adapter from modular files
 */
export function importFromModular(adapter, baseDir) {
  baseDir = getBaseDir(baseDir);
  const sysDbDir = getSystemDbDir(baseDir);
  const sysUsageDir = getSystemUsageDir(baseDir);

  adapter.transaction(() => {
    // 1. Meta
    const metaPath = path.join(sysDbDir, "meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        for (const [key, value] of Object.entries(meta)) {
          adapter.run(`INSERT OR REPLACE INTO _meta(key, value) VALUES(?, ?)`, [key, String(value)]);
        }
      } catch (e) {
        console.warn(`[DB] Failed to read meta.json: ${e.message}`);
      }
    }

    // 2. Settings
    const settingsPath = path.join(sysDbDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        const dataStr = typeof raw === "object" && raw.data
          ? (typeof raw.data === "string" ? raw.data : stringifyJson(raw.data))
          : stringifyJson(raw);
        adapter.run(
          `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
          [dataStr]
        );
      } catch (e) {
        console.warn(`[DB] Failed to read settings.json: ${e.message}`);
      }
    }

    // 3. API Keys
    const apiKeysPath = path.join(sysDbDir, "api-keys.json");
    if (fs.existsSync(apiKeysPath)) {
      try {
        const keys = JSON.parse(fs.readFileSync(apiKeysPath, "utf-8"));
        const list = Array.isArray(keys) ? keys : (keys.apiKeys || []);
        for (const k of list) {
          adapter.run(
            `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
            [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false || k.isActive === 0 ? 0 : 1, k.createdAt || new Date().toISOString()]
          );
        }
      } catch (e) {
        console.warn(`[DB] Failed to read api-keys.json: ${e.message}`);
      }
    }

    // 4. Combos
    const combosPath = path.join(sysDbDir, "combos.json");
    if (fs.existsSync(combosPath)) {
      try {
        const combos = JSON.parse(fs.readFileSync(combosPath, "utf-8"));
        const list = Array.isArray(combos) ? combos : (combos.combos || []);
        for (const c of list) {
          adapter.run(
            `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
            [c.id, c.name, c.kind || null, typeof c.models === "string" ? c.models : stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
          );
        }
      } catch (e) {
        console.warn(`[DB] Failed to read combos.json: ${e.message}`);
      }
    }

    // 5. Proxy Pools
    const proxyPoolsPath = path.join(sysDbDir, "proxy-pools.json");
    if (fs.existsSync(proxyPoolsPath)) {
      try {
        const pools = JSON.parse(fs.readFileSync(proxyPoolsPath, "utf-8"));
        const list = Array.isArray(pools) ? pools : (pools.proxyPools || []);
        for (const p of list) {
          const { id, isActive, testStatus, createdAt, updatedAt, data, ...rest } = p;
          const poolData = data ? (typeof data === "string" ? data : stringifyJson(data)) : stringifyJson(rest);
          adapter.run(
            `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
            [id, isActive === false || isActive === 0 ? 0 : 1, testStatus || "unknown", poolData, createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
          );
        }
      } catch (e) {
        console.warn(`[DB] Failed to read proxy-pools.json: ${e.message}`);
      }
    }

    // 6. Provider Nodes
    const nodesPath = path.join(sysDbDir, "nodes.json");
    if (fs.existsSync(nodesPath)) {
      try {
        const nodes = JSON.parse(fs.readFileSync(nodesPath, "utf-8"));
        const list = Array.isArray(nodes) ? nodes : (nodes.providerNodes || []);
        for (const n of list) {
          const { id, type, name, createdAt, updatedAt, data, ...rest } = n;
          const nodeData = data ? (typeof data === "string" ? data : stringifyJson(data)) : stringifyJson(rest);
          adapter.run(
            `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
            [id, type || null, name || null, nodeData, createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
          );
        }
      } catch (e) {
        console.warn(`[DB] Failed to read nodes.json: ${e.message}`);
      }
    }

    // 7. Aliases
    const aliasesPath = path.join(sysDbDir, "aliases.json");
    if (fs.existsSync(aliasesPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(aliasesPath, "utf-8"));
        if (Array.isArray(raw)) {
          for (const r of raw) {
            adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)`, [r.scope, r.key, stringifyJson(r.value)]);
          }
        } else if (raw && typeof raw === "object") {
          for (const [alias, model] of Object.entries(raw.modelAliases || {})) {
            adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [alias, stringifyJson(model)]);
          }
          for (const m of raw.customModels || []) {
            const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
            adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
          }
          for (const [tool, mappings] of Object.entries(raw.mitmAlias || {})) {
            adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
          }
          for (const [prov, ids] of Object.entries(raw.disabledModels || {})) {
            adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [prov, stringifyJson(ids || [])]);
          }
        }
      } catch (e) {
        console.warn(`[DB] Failed to read aliases.json: ${e.message}`);
      }
    }

    // 8. Pricing
    const pricingPath = path.join(sysDbDir, "pricing.json");
    if (fs.existsSync(pricingPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(pricingPath, "utf-8"));
        if (Array.isArray(raw)) {
          for (const r of raw) {
            adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [r.key, stringifyJson(r.value)]);
          }
        } else if (raw && typeof raw === "object") {
          for (const [provider, models] of Object.entries(raw)) {
            adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
          }
        }
      } catch (e) {
        console.warn(`[DB] Failed to read pricing.json: ${e.message}`);
      }
    }

    // 9. Usage: history
    const historyPath = path.join(sysUsageDir, "history.json");
    if (fs.existsSync(historyPath)) {
      try {
        const items = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
        const list = Array.isArray(items) ? items : (items.history || []);
        for (const h of list) {
          adapter.run(
            `INSERT OR REPLACE INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [h.id, h.timestamp, h.provider || null, h.model || null, h.connectionId || null, h.apiKey || null, h.endpoint || null, h.promptTokens || 0, h.completionTokens || 0, h.cost || 0, h.status || null, typeof h.tokens === "string" ? h.tokens : stringifyJson(h.tokens || {}), typeof h.meta === "string" ? h.meta : stringifyJson(h.meta || {})]
          );
        }
      } catch (e) {
        console.warn(`[DB] Failed to read history.json: ${e.message}`);
      }
    }

    // 10. Usage: daily
    const dailyPath = path.join(sysUsageDir, "daily.json");
    if (fs.existsSync(dailyPath)) {
      try {
        const items = JSON.parse(fs.readFileSync(dailyPath, "utf-8"));
        if (Array.isArray(items)) {
          for (const d of items) {
            adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [d.dateKey, typeof d.data === "string" ? d.data : stringifyJson(d.data || {})]);
          }
        } else if (items && typeof items === "object") {
          for (const [dateKey, dayData] of Object.entries(items)) {
            adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, typeof dayData === "string" ? dayData : stringifyJson(dayData || {})]);
          }
        }
      } catch (e) {
        console.warn(`[DB] Failed to read daily.json: ${e.message}`);
      }
    }

    // 11. Usage: request-details
    const detailsPath = path.join(sysUsageDir, "request-details.json");
    if (fs.existsSync(detailsPath)) {
      try {
        const items = JSON.parse(fs.readFileSync(detailsPath, "utf-8"));
        const list = Array.isArray(items) ? items : (items.records || []);
        for (const r of list) {
          adapter.run(
            `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.timestamp, r.provider || null, r.model || null, r.connectionId || null, r.status || null, typeof r.data === "string" ? r.data : stringifyJson(r.data || r)]
          );
        }
      } catch (e) {
        console.warn(`[DB] Failed to read request-details.json: ${e.message}`);
      }
    }

    // 12. Providers: scan DATA_DIR subdirectories
    loadAllProvidersFromDisk(adapter, baseDir);
  });

  // Ensure all canonical provider directories and JSON files exist
  ensureAllProviderFoldersExist(baseDir);
}

/**
 * Saves ONLY a single provider's JSON file: provider/{ProviderName}/{ProviderName}.json
 */
export function saveProviderSync(adapter, providerId, baseDir) {
  baseDir = getBaseDir(baseDir);
  if (!providerId || typeof providerId !== "string") return;
  if (!/^[a-zA-Z0-9_.-]+$/.test(providerId) || providerId.includes(":") || providerId.length > 50) return;
  const rows = adapter.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId]);
  const unpacked = rows.map((r) => {
    const extra = parseJson(r.data, {});
    const { data, ...root } = r;
    return {
      ...extra,
      ...root,
      isActive: root.isActive === 1 || root.isActive === true,
    };
  });
  const { dirPath, filePath } = resolveProviderDbPath(providerId, baseDir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(unpacked, null, 2), "utf-8");

  // Clean up legacy nested db file if present
  const legacyNested = path.join(dirPath, "db", path.basename(filePath));
  if (fs.existsSync(legacyNested)) {
    try {
      fs.unlinkSync(legacyNested);
      fs.rmdirSync(path.join(dirPath, "db"));
    } catch {}
  }

  // Clean up legacy root file if present (e.g. baseDir/{dirName}/{dirName}.json)
  const legacyRootFile = path.join(baseDir, path.basename(dirPath), path.basename(filePath));
  if (fs.existsSync(legacyRootFile) && legacyRootFile !== filePath) {
    try {
      fs.unlinkSync(legacyRootFile);
      const parentDir = path.join(baseDir, path.basename(dirPath));
      if (fs.readdirSync(parentDir).length === 0) {
        fs.rmdirSync(parentDir);
      }
    } catch {}
  }
}

/**
 * Saves core system configs in system/db/
 */
export function saveSystemDbSync(adapter, target, baseDir) {
  baseDir = getBaseDir(baseDir);
  const sysDbDir = getSystemDbDir(baseDir);
  fs.mkdirSync(sysDbDir, { recursive: true });

  switch (target) {
    case "settings": {
      const row = adapter.get(`SELECT data FROM settings WHERE id = 1`);
      const data = row ? parseJson(row.data, {}) : {};
      fs.writeFileSync(path.join(sysDbDir, "settings.json"), JSON.stringify(data, null, 2), "utf-8");
      break;
    }
    case "api-keys":
    case "apiKeys": {
      const rows = adapter.all(`SELECT * FROM apiKeys`);
      fs.writeFileSync(path.join(sysDbDir, "api-keys.json"), JSON.stringify(rows, null, 2), "utf-8");
      break;
    }
    case "combos": {
      const rows = adapter.all(`SELECT * FROM combos`);
      fs.writeFileSync(path.join(sysDbDir, "combos.json"), JSON.stringify(rows, null, 2), "utf-8");
      break;
    }
    case "proxy-pools":
    case "proxyPools": {
      const rows = adapter.all(`SELECT * FROM proxyPools`);
      fs.writeFileSync(path.join(sysDbDir, "proxy-pools.json"), JSON.stringify(rows, null, 2), "utf-8");
      break;
    }
    case "aliases": {
      const aliasesObj = { modelAliases: {}, customModels: [], mitmAlias: {}, disabledModels: {} };
      for (const r of adapter.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
        aliasesObj.modelAliases[r.key] = parseJson(r.value, r.value);
      }
      for (const r of adapter.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
        aliasesObj.customModels.push(parseJson(r.value, r.value));
      }
      for (const r of adapter.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) {
        aliasesObj.mitmAlias[r.key] = parseJson(r.value, r.value);
      }
      for (const r of adapter.all(`SELECT key, value FROM kv WHERE scope = 'disabledModels'`)) {
        aliasesObj.disabledModels[r.key] = parseJson(r.value, r.value);
      }
      fs.writeFileSync(path.join(sysDbDir, "aliases.json"), JSON.stringify(aliasesObj, null, 2), "utf-8");
      break;
    }
    case "pricing": {
      const pricingObj = {};
      for (const r of adapter.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) {
        pricingObj[r.key] = parseJson(r.value, r.value);
      }
      fs.writeFileSync(path.join(sysDbDir, "pricing.json"), JSON.stringify(pricingObj, null, 2), "utf-8");
      break;
    }
    case "nodes":
    case "providerNodes": {
      const rows = adapter.all(`SELECT * FROM providerNodes`);
      fs.writeFileSync(path.join(sysDbDir, "nodes.json"), JSON.stringify(rows, null, 2), "utf-8");
      break;
    }
    case "meta":
    case "_meta": {
      const rows = adapter.all(`SELECT key, value FROM _meta`);
      const metaObj = {};
      for (const r of rows) metaObj[r.key] = r.value;
      fs.writeFileSync(path.join(sysDbDir, "meta.json"), JSON.stringify(metaObj, null, 2), "utf-8");
      break;
    }
  }
}

/**
 * Saves usage stats and logs in system/usage/
 */
export function saveSystemUsageSync(adapter, target, baseDir) {
  baseDir = getBaseDir(baseDir);
  const sysUsageDir = getSystemUsageDir(baseDir);
  fs.mkdirSync(sysUsageDir, { recursive: true });

  switch (target) {
    case "history":
    case "usageHistory": {
      const rows = adapter.all(`SELECT * FROM usageHistory`);
      fs.writeFileSync(path.join(sysUsageDir, "history.json"), JSON.stringify(rows, null, 2), "utf-8");
      break;
    }
    case "daily":
    case "usageDaily": {
      const rows = adapter.all(`SELECT * FROM usageDaily`);
      fs.writeFileSync(path.join(sysUsageDir, "daily.json"), JSON.stringify(rows, null, 2), "utf-8");
      break;
    }
    case "request-details":
    case "requestDetails": {
      const rows = adapter.all(`SELECT * FROM requestDetails`);
      fs.writeFileSync(path.join(sysUsageDir, "request-details.json"), JSON.stringify(rows, null, 2), "utf-8");
      break;
    }
  }
}

// Track pending debounced saves
const pendingProviderSaves = new Set();
const pendingSystemDbSaves = new Set();
const pendingSystemUsageSaves = new Set();
let debounceTimer = null;

export function scheduleModularSave(adapter, { provider, systemDb, systemUsage } = {}) {
  if (provider) pendingProviderSaves.add(provider);
  if (systemDb) pendingSystemDbSaves.add(systemDb);
  if (systemUsage) pendingSystemUsageSaves.add(systemUsage);

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushModularSaveSync(adapter);
  }, 500);
}

export function flushModularSaveSync(adapter, baseDir) {
  baseDir = getBaseDir(baseDir);
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  for (const prov of pendingProviderSaves) {
    try {
      saveProviderSync(adapter, prov, baseDir);
    } catch (e) {
      console.error(`[DB] Failed to save provider ${prov}:`, e.message);
    }
  }
  pendingProviderSaves.clear();

  for (const target of pendingSystemDbSaves) {
    try {
      saveSystemDbSync(adapter, target, baseDir);
    } catch (e) {
      console.error(`[DB] Failed to save system DB ${target}:`, e.message);
    }
  }
  pendingSystemDbSaves.clear();

  for (const target of pendingSystemUsageSaves) {
    try {
      saveSystemUsageSync(adapter, target, baseDir);
    } catch (e) {
      console.error(`[DB] Failed to save usage ${target}:`, e.message);
    }
  }
  pendingSystemUsageSaves.clear();
}
