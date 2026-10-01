import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-status-test-"));
process.env.DATA_DIR = tempDir;

console.log(`[TEST] Using temp DATA_DIR: ${tempDir}`);

// 1. Test modular store initialization
const { ensureAllProviderFoldersExist, ALL_CANONICAL_PROVIDERS } = await import("../src/lib/db/modularStore.js");
ensureAllProviderFoldersExist(tempDir);

const provRoot = path.join(tempDir, "provider");
for (const dirName of ALL_CANONICAL_PROVIDERS) {
  const statusPath = path.join(provRoot, dirName, "status.json");
  assert.ok(fs.existsSync(statusPath), `status.json missing for ${dirName}`);
  const data = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
  assert.equal(data.enabled, true, `Expected ${dirName} status to be enabled`);
}
console.log(`[PASS] 1. Initialized status.json for all ${ALL_CANONICAL_PROVIDERS.length} canonical providers.`);

// 2. Test getProviderStatus and setProviderStatus
const db = await import("../src/lib/db/index.js");
await db.initDb();

// Default should be true
const initGithub = await db.getProviderStatus("github");
assert.equal(initGithub, true, "GitHub default status should be true");

// Toggle GitHub OFF
await db.setProviderStatus("github", false);
const offGithub = await db.getProviderStatus("github");
assert.equal(offGithub, false, "GitHub status should now be false");

// Verify GitHub status.json
const githubStatusFile = path.join(tempDir, "provider", "GitHub-Copilot", "status.json");
assert.ok(fs.existsSync(githubStatusFile), "GitHub status.json file must exist on disk");
const githubData = JSON.parse(fs.readFileSync(githubStatusFile, "utf-8"));
assert.equal(githubData.enabled, false, "On-disk github status should be false");
assert.equal(githubData.provider, "github");

// Verify system aliases.json contains providerStatus
const aliasesFile = path.join(tempDir, "system", "db", "aliases.json");
assert.ok(fs.existsSync(aliasesFile), "aliases.json should exist");
const aliasesData = JSON.parse(fs.readFileSync(aliasesFile, "utf-8"));
assert.ok(aliasesData.providerStatus, "aliases.json should contain providerStatus");
assert.equal(aliasesData.providerStatus.github.enabled, false);
console.log(`[PASS] 2. Individual provider toggle saved to status.json and aliases.json.`);

// 3. Test getAllProviderStatuses
await db.setProviderStatus("claude", false);
const allStatuses = await db.getAllProviderStatuses();
assert.equal(allStatuses.github, false);
assert.equal(allStatuses.claude, false);
assert.equal(allStatuses.openai, true);
assert.equal(allStatuses.antigravity, true);
console.log(`[PASS] 3. getAllProviderStatuses returns accurate map across all canonical providers.`);

// 4. Test re-initialization and persistence across restart
try { global._dbAdapter?.instance?.close?.(); } catch {}
delete global._dbAdapter;

const { initDb, getProviderStatus } = await import(`../src/lib/db/index.js?reload=${Date.now()}`);
await initDb();
assert.equal(await getProviderStatus("github"), false, "github should remain disabled after DB reload");
assert.equal(await getProviderStatus("claude"), false, "claude should remain disabled after DB reload");
assert.equal(await getProviderStatus("openai"), true, "openai should remain enabled after DB reload");
console.log(`[PASS] 4. Successfully restored provider statuses from full JSON store after restart.`);

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true });
console.log("\nALL PROVIDER STATUS VERIFICATIONS PASSED!");
