/**
 * bench/resolve-hook.mjs — Node ESM loader hook for the offline harness.
 *
 * chatCore.js and its dependencies import `@/lib/...` (a Next.js/vitest alias)
 * and, in a couple of dynamic imports, bare `open-sse/...`. Plain Node cannot
 * resolve either. This hook is registered in-process via
 * `module.register()` before the harness dynamically imports open-sse, mapping:
 *   @/         → <repo>/src/
 *   open-sse/  → <repo>/open-sse/
 *
 * It is resolve-only (no load/format hooks) so nothing else about module
 * semantics changes.
 */

import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(REPO_ROOT, "src");
const OPEN_SSE_DIR = join(REPO_ROOT, "open-sse");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(pathToFileURL(join(SRC_DIR, specifier.slice(2))).href, context);
  }
  if (specifier === "open-sse") {
    return nextResolve(pathToFileURL(join(OPEN_SSE_DIR, "index.js")).href, context);
  }
  if (specifier.startsWith("open-sse/")) {
    return nextResolve(pathToFileURL(join(OPEN_SSE_DIR, specifier.slice("open-sse/".length))).href, context);
  }
  return nextResolve(specifier, context);
}
