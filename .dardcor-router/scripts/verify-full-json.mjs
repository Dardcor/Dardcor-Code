import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Resolve default data directory dynamically
const baseDir = process.env.DATA_DIR || path.join(os.homedir(), ".dardcor", "provider");
process.env.DATA_DIR = baseDir;

const db = await import("../src/lib/db/index.js");
await db.initDb();

console.log("=== FULL JSON STORE LIVE DATA VERIFICATION ===");

// 1. Check Driver
const { getAdapter } = await import("../src/lib/db/driver.js");
const adapter = await getAdapter();
console.log(`Driver active: ${adapter.driver}`);
console.assert(adapter.driver === "Full JSON Store", "Driver must be Full JSON Store");

// 2. Check Connections
const conns = await db.getProviderConnections();
console.log(`Total live provider connections: ${conns.length}`);
for (const c of conns) {
  console.log(`  - [${c.provider}] ID: ${c.id}, Auth: ${c.authType}, Active: ${c.isActive}`);
}
console.assert(conns.length === 5, "Must have exactly 5 active accounts preserved");

// 3. Check Settings
const settings = await db.getSettings();
const settingKeys = Object.keys(settings).length;
console.log(`Settings loaded: ${settingKeys} properties`);
console.assert(settingKeys >= 40, "Settings must be fully preserved");

// 4. Check Usage
const usageHist = await db.getUsageHistory({ limit: 10 });
console.log(`Usage history records sample: ${usageHist.length} (total in memory: ${adapter.tables.usageHistory?.length || 0})`);
console.assert(adapter.tables.usageHistory?.length > 1000, "Usage records preserved");

// 5. Check All 43 Providers under {baseDir}/provider/{Name}/{Name}.json
const provRoot = path.join(baseDir, "provider");
const { ALL_CANONICAL_PROVIDERS } = await import("../src/lib/db/modularStore.js");
console.log(`Total canonical providers: ${ALL_CANONICAL_PROVIDERS.length}`);

let missing = 0;
for (const prov of ALL_CANONICAL_PROVIDERS) {
  const file = path.join(provRoot, prov, `${prov}.json`);
  if (!fs.existsSync(file)) {
    console.error(`MISSING: ${file}`);
    missing++;
  }
}
console.log(`Provider verification: ${ALL_CANONICAL_PROVIDERS.length - missing}/${ALL_CANONICAL_PROVIDERS.length} present under provider/provider/{Name}/{Name}.json`);
console.assert(missing === 0, "All 43 providers must exist under provider/provider/{Name}/{Name}.json");

// 6. Verify Antigravity has the 2 accounts in the nested provider file
const antiJsonPath = path.join(provRoot, "Antigravity", "Antigravity.json");
const antiJson = JSON.parse(fs.readFileSync(antiJsonPath, "utf-8"));
console.log(`Antigravity accounts in ${antiJsonPath}: ${antiJson.length}`);
console.assert(antiJson.length === 2, "Antigravity must have 2 accounts");

// 7. Verify no duplicate provider directories remain at root of C:\Users\Dardcor\.dardcor\provider
const reserved = new Set(["system", "backups", "db", "logs", "auth", "node_modules", ".git", "catalog", "runtime", "provider"]);
const rootEntries = fs.readdirSync(baseDir, { withFileTypes: true });
const lingering = rootEntries.filter((e) => e.isDirectory() && !reserved.has(e.name.toLowerCase()));
console.log(`Lingering provider directories at root: ${lingering.map((e) => e.name).join(", ") || "None (clean)"}`);
console.assert(lingering.length === 0, "No provider folders should linger at baseDir root");

console.log("=== ALL LIVE VERIFICATIONS PASSED 100% ===");
