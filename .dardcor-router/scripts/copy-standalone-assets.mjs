import { cpSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function copyStandaloneAssets({ projectRoot = process.cwd(), distDir = process.env.NEXT_DIST_DIR || ".next" } = {}) {
  if (process.env.NEXT_TRACING_ROOT_MODE === "workspace") {
    console.log("[standalone-assets] Skipping workspace-traced CLI build; CLI packaging handles assets");
    return;
  }

  const buildDir = resolve(projectRoot, distDir);
  const standaloneDir = resolve(buildDir, "standalone");

  if (!existsSync(standaloneDir)) {
    console.log(`[standalone-assets] No standalone build found at ${standaloneDir}`);
    return;
  }

  // 1. Fully synchronize server bundle (ensures dynamic route chunks like 9381.js, 5182.js are NEVER omitted)
  const serverSource = resolve(buildDir, "server");
  const serverDestination = resolve(standaloneDir, distDir, "server");
  if (existsSync(serverSource)) {
    cpSync(serverSource, serverDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Fully synchronized server bundle to ${serverDestination}`);
  }

  // 2. Synchronize static assets
  const staticSource = resolve(buildDir, "static");
  const staticDestination = resolve(standaloneDir, distDir, "static");
  if (existsSync(staticSource)) {
    cpSync(staticSource, staticDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied static assets to ${staticDestination}`);
  }

  // 3. Synchronize public assets
  const publicSource = resolve(projectRoot, "public");
  const publicDestination = resolve(standaloneDir, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, publicDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied public assets to ${publicDestination}`);
  }

  // 4. Salin custom-server wrapper
  const serverWrapperSource = resolve(projectRoot, "custom-server.js");
  const serverWrapperDestination = resolve(standaloneDir, "custom-server.js");
  if (existsSync(serverWrapperSource)) {
    cpSync(serverWrapperSource, serverWrapperDestination, { force: true });
    console.log(`[standalone-assets] Copied custom-server.js to ${serverWrapperDestination}`);
  }

  // 5. Salin package.json
  const packageJsonSource = resolve(projectRoot, "package.json");
  const packageJsonDestination = resolve(standaloneDir, "package.json");
  if (existsSync(packageJsonSource)) {
    cpSync(packageJsonSource, packageJsonDestination, { force: true });
    console.log(`[standalone-assets] Copied package.json to ${packageJsonDestination}`);
  }

  // 6. Automated Integrity & Chunk Parity Verification
  const srcChunksDir = resolve(serverSource, "chunks");
  const dstChunksDir = resolve(serverDestination, "chunks");
  if (existsSync(srcChunksDir) && existsSync(dstChunksDir)) {
    const srcFiles = new Set(readdirSync(srcChunksDir));
    const dstFiles = new Set(readdirSync(dstChunksDir));
    const missing = [...srcFiles].filter(f => !dstFiles.has(f));
    if (missing.length > 0) {
      throw new Error(`[standalone-assets] FATAL: Missing ${missing.length} server chunks in standalone distribution: ${missing.join(', ')}`);
    }
    console.log(`[standalone-assets] Integrity verified: All ${dstFiles.size} server chunks verified in standalone output.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), "copy-standalone-assets.mjs")) {
  copyStandaloneAssets();
}

