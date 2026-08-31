#!/usr/bin/env node
/**
 * scripts/upstream-diff.mjs — Dardcor Code Phase 8 upstream drift check.
 *
 * Spawns `diff -ru` between the upstream reference tree (../9router-reference)
 * and the current tree, with the same excludes the old Makefile target used.
 * The diff output is a display-only text stream: rebrand identifiers are
 * reverse-mapped (dardcor-code → 9router, 21127 → 20127, …) so genuine upstream
 * drift is readable and the identity rename itself doesn't flood the diff.
 *
 * The reverse-map touches only the emitted text — the underlying diff and its
 * exit code are unchanged (exit 0 = identical, 1 = differences, 2 = error).
 *
 * Usage: node scripts/upstream-diff.mjs [reference-root]
 * Exit:  same as `diff -ru` (0 / 1 / 2).
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REFERENCE_ROOT = resolve(process.argv[2] || "../9router-reference");
const CURRENT_ROOT = resolve(".");

const EXCLUDES = [
  "node_modules",
  ".next",
  "dist",
  "build",
  "graphify-out",
  ".omo",
  ".opencode",
  ".remember",
];

/** Reverse map applied to diff display text only (identity map from docs/REBRAND.md §2). */
const REVERSE_MAP = [
  [/dardcor-code\.web\.id/gi, "9router.com"],
  [/dardcor-code/gi, "9router"],
  [/dardcor_/gi, "9r_"],
  [/DARDCOR_/gi, "NINEROUTER_"],
  [/x-dardcor/gi, "x-9router"],
  [/X-Dardcor/gi, "X-9Router"],
  [/21127/g, "20127"],
  [/21128/g, "20128"],
  [/21129/g, "20129"],
];

function reverseMap(text) {
  let out = text;
  for (const [re, replacement] of REVERSE_MAP) out = out.replace(re, replacement);
  return out;
}

const args = ["-ru", ...EXCLUDES.flatMap((e) => ["--exclude", e]), REFERENCE_ROOT, CURRENT_ROOT];
const child = spawn("diff", args, { stdio: ["ignore", "pipe", "pipe"] });

let exitCode = 1;
child.stdout.on("data", (buf) => process.stdout.write(reverseMap(buf.toString("utf8"))));
child.stderr.on("data", (buf) => process.stderr.write(buf));
child.on("error", (err) => {
  console.error(`upstream-diff: failed to spawn diff: ${err.message}`);
  process.exit(2);
});
child.on("close", (code) => {
  exitCode = code == null ? 2 : code;
  process.exit(exitCode);
});
