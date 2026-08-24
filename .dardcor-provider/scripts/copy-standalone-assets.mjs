import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// Tiny CJS wrapper that replaces the Next-generated standalone server.js. It
// refuses to boot with a known-weak supplied secret before any listener opens,
// then loads the real server (stashed next to it as next-server.js).
const SECRET_GATE_WRAPPER = `// dardcor-code weak-secret gate: refuse to boot with a known-weak supplied
// secret before any listener opens. Managed by scripts/copy-standalone-assets.mjs.
"use strict";
require("./secret-policy.cjs").assertNoWeakSecrets();
require("./next-server.js");
`;

const GATE_MARK = 'require("./secret-policy.cjs").assertNoWeakSecrets()';

function findStandaloneServer(standaloneDir) {
  const direct = resolve(standaloneDir, "server.js");
  if (existsSync(direct)) return direct;
  // Workspace-traced CLI builds nest the app under a subdir (pkg name / app).
  for (const entry of readdirSync(standaloneDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = resolve(standaloneDir, entry.name, "server.js");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function installSecretGate(standaloneDir, projectRoot) {
  const policySource = resolve(projectRoot, "secret-policy.cjs");
  const serverPath = findStandaloneServer(standaloneDir);
  const hasPolicy = existsSync(policySource);

  // Asset-only fixture: neither server nor policy → nothing to gate.
  if (!serverPath && !hasPolicy) return;

  if (!serverPath) {
    throw new Error(
      "[standalone-assets] secret-policy.cjs exists but no standalone server.js found; cannot gate the boot",
    );
  }
  if (!hasPolicy) {
    throw new Error(
      "[standalone-assets] standalone server.js found but root secret-policy.cjs is missing; refusing to ship an ungated server",
    );
  }

  const serverDir = dirname(serverPath);
  const nextServerPath = join(serverDir, "next-server.js");
  const policyDest = join(serverDir, "secret-policy.cjs");
  cpSync(policySource, policyDest, { force: true });

  const current = readFileSync(serverPath, "utf8");
  if (current.includes(GATE_MARK)) {
    // Already wrapped — repeated postbuild runs must not double-wrap.
    return;
  }

  // A fresh build regenerated the real server over our wrapper: stash it and
  // replace it with the gate wrapper.
  writeFileSync(nextServerPath, current);
  writeFileSync(serverPath, SECRET_GATE_WRAPPER);
  console.log(`[standalone-assets] Wrapped ${serverPath} with weak-secret gate`);
}

export function copyStandaloneAssets({ projectRoot = process.cwd(), distDir = process.env.NEXT_DIST_DIR || ".next" } = {}) {
  const buildDir = resolve(projectRoot, distDir);
  const standaloneDir = resolve(buildDir, "standalone");

  if (!existsSync(standaloneDir)) {
    console.log(`[standalone-assets] No standalone build found at ${standaloneDir}`);
    return;
  }

  // The gate must land in every standalone layout (default and workspace-traced
  // CLI), so it runs before the workspace-mode asset skip.
  installSecretGate(standaloneDir, projectRoot);

  if (process.env.NEXT_TRACING_ROOT_MODE === "workspace") {
    console.log("[standalone-assets] Skipping workspace-traced CLI build; CLI packaging handles assets");
    return;
  }

  const staticSource = resolve(buildDir, "static");
  const staticDestination = resolve(standaloneDir, distDir, "static");
  if (existsSync(staticSource)) {
    cpSync(staticSource, staticDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied static assets to ${staticDestination}`);
  }

  const publicSource = resolve(projectRoot, "public");
  const publicDestination = resolve(standaloneDir, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, publicDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied public assets to ${publicDestination}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), "copy-standalone-assets.mjs")) {
  copyStandaloneAssets();
}
