// Focused tests for the Phase 1 Wave 0.2 baseline gate (scripts/test-baseline.mjs).
// These assert the comparison behavior only — the gate's spawn/CLI glue is
// exercised by `node scripts/test-baseline.mjs` itself.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  normalizeTestPath,
  failureSignature,
  buildFailureSet,
  compareFailures,
  verifyCharacterization,
  evaluateGate,
  flakyClassSignature,
  writeAtomic,
} from "../../scripts/test-baseline.mjs";

const sig = (text) => failureSignature([text]);
// valid 64-hex SHA-256 signatures for characterization fixtures
const HX1 = "a".repeat(64);
const HX2 = "b".repeat(64);
const HX3 = "c".repeat(64);

describe("baseline gate comparison", () => {
  it("normalizeTestPath maps absolute checkout paths to the tests/ root cross-platform", () => {
    expect(normalizeTestPath("/Users/me/app/tests/unit/a.test.js")).toBe("tests/unit/a.test.js");
    expect(normalizeTestPath("C:\\repo\\tests\\unit\\a.test.js")).toBe("tests/unit/a.test.js");
    expect(normalizeTestPath("/tmp/clone/tests/unit/b.test.js")).toBe("tests/unit/b.test.js");
    expect(normalizeTestPath("tests/unit/c.test.js")).toBe("tests/unit/c.test.js");
  });

  it("failureSignature is stable for identical text and sensitive to real changes", () => {
    const a = sig("AssertionError: expected 2 to be 100 // Object.is equality\n at tests/unit/db-concurrent.test.js:40:33");
    const b = sig("AssertionError: expected 2 to be 100 // Object.is equality\n at tests/unit/db-concurrent.test.js:40:33");
    expect(a).toBe(b);
    expect(a).not.toBe(sig("AssertionError: expected 3 to be 100 // Object.is equality"));
  });

  it("failureSignature normalizes the repo root so path prefix changes do not break the signature", () => {
    const rooted = sig("Cannot find module 'x' imported from /mnt/Data/dardcor-code/tests/unit/a.test.js");
    const bare = sig("Cannot find module 'x' imported from <ROOT>/tests/unit/a.test.js");
    expect(rooted).toBe(bare);
  });

  it("compareFailures reports matched, new, removed and changed failures as explicit deltas", () => {
    const idA = "tests/unit/a.test.js :: one";
    const idB = "tests/unit/b.test.js :: two";
    const idC = "tests/unit/c.test.js :: three";
    const baseline = new Map([
      [idA, { signature: "S1" }],
      [idB, { signature: "S2" }],
    ]);
    const actual = new Map([
      [idA, { signature: "S1" }],
      [idB, { signature: "S2-CHANGED" }],
      [idC, { signature: "S3" }],
    ]);
    const r = compareFailures(actual, baseline);
    expect(r.matched).toEqual([idA]);
    expect(r.changed).toEqual([idB]);
    expect(r.newFailures).toEqual([idC]);
    expect(r.removed).toEqual([]);
  });

  it("compareFailures reports a removed failure as an improvement, not silent rewriting", () => {
    const id = "tests/unit/a.test.js :: gone";
    const r = compareFailures(new Map(), new Map([[id, { signature: "S" }]]));
    expect(r.removed).toEqual([id]);
    expect(r.matched).toEqual([]);
  });

  it("verifyCharacterization rejects missing, unclassified, or unknown categories", () => {
    const base = {
      categories: { ok: { label: "fine", evidence: "e" } },
      failures: [{ id: "a", category: "ok", signature: HX1 }],
    };
    expect(verifyCharacterization(base)).toEqual([]);

    const missing = { ...base, failures: [{ id: "a", category: "ok", signature: HX1 }, { id: "b", category: "nope", signature: HX2 }] };
    expect(verifyCharacterization(missing).length).toBe(1);

    const unclassified = { ...base, failures: [{ id: "a", category: "unclassified", signature: HX1 }] };
    expect(verifyCharacterization(unclassified).length).toBe(1);

    const emptyCat = { ...base, failures: [{ id: "a", category: "", signature: HX1 }] };
    expect(verifyCharacterization(emptyCat).length).toBe(1);
  });

  it("failureSignature ignores stack frames after the first (async-frame variance)", () => {
    const base = "AssertionError: expected 200 to be 400 // Object.is equality";
    const withNodeFrame = `${base}\n    at <ROOT>/tests/unit/oauth-cursor-auto-import.test.js:181:29\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)`;
    const withVitestFrame = `${base}\n    at <ROOT>/tests/unit/oauth-cursor-auto-import.test.js:181:29\n    at <ROOT><NM>`;
    const changedSite = `${base}\n    at <ROOT>/tests/unit/oauth-cursor-auto-import.test.js:200:29\n    at <ROOT><NM>`;
    expect(failureSignature([withNodeFrame])).toBe(failureSignature([withVitestFrame]));
    expect(failureSignature([withNodeFrame])).not.toBe(failureSignature([changedSite]));
  });

  it("compareFailures compares digit-stripped class signatures for flaky entries", () => {
    const id = "tests/unit/db-concurrent.test.js :: mixed concurrent";
    const baseline = new Map([
      [id, { signature: "full-sig", flaky: true, classSignature: flakyClassSignature("AssertionError: expected 13 to be 50 // Object.is equality") }],
    ]);
    const sameClass = new Map([[id, { signature: "full-other", classSignature: flakyClassSignature("AssertionError: expected 12 to be 50 // Object.is equality") }]]);
    const differentClass = new Map([[id, { signature: "full-other", classSignature: flakyClassSignature("TypeError: boom") }]]);
    expect(compareFailures(sameClass, baseline).changed).toEqual([]);
    expect(compareFailures(differentClass, baseline).changed).toEqual([id]);
  });

  it("verifyCharacterization requires flaky entries to carry a class signature", () => {
    const ok = {
      categories: { cat: { label: "x", evidence: "e" } },
      failures: [{ id: "a", category: "cat", signature: HX1, flaky: true, classSignature: HX2 }],
    };
    expect(verifyCharacterization(ok)).toEqual([]);
    const noClass = {
      categories: { cat: { label: "x", evidence: "e" } },
      failures: [{ id: "a", category: "cat", signature: HX1, flaky: true }],
    };
    expect(verifyCharacterization(noClass).length).toBe(1);
  });

  it("evaluateGate passes only when failures match exactly and every entry is classified", () => {
    const char = {
      categories: { cat: { label: "x", evidence: "e" } },
      failures: [{ id: "tests/unit/a.test.js :: one", category: "cat", signature: HX1 }],
    };
    const exact = new Map([["tests/unit/a.test.js :: one", { signature: HX1 }]]);
    expect(evaluateGate(exact, char).pass).toBe(true);

    const newFail = new Map([...exact, ["tests/unit/x.test.js :: y", { signature: HX2 }]]);
    expect(evaluateGate(newFail, char).pass).toBe(false);
    expect(evaluateGate(newFail, char).report).toContain("NEW");

    const unclassifiedChar = {
      categories: { cat: { label: "x", evidence: "e" } },
      failures: [{ id: "tests/unit/a.test.js :: one", category: "unclassified", signature: HX1 }],
    };
    expect(evaluateGate(exact, unclassifiedChar).pass).toBe(false);
  });

  it("buildFailureSet includes file-level collection failures with a stable id", () => {
    const run = {
      testResults: [
        {
          name: "/mnt/Data/dardcor-code/tests/unit/embeddings.cloud.test.js",
          status: "failed",
          message: "Cannot find module '/cloud/src/handlers/embeddings.js' imported from /mnt/Data/dardcor-code/tests/unit/embeddings.cloud.test.js",
          assertionResults: [],
        },
        {
          name: "/mnt/Data/dardcor-code/tests/unit/db-concurrent.test.js",
          status: "failed",
          assertionResults: [
            { status: "failed", fullName: "atomic safety 100 parallel", failureMessages: ["AssertionError: expected 2 to be 100"] },
            { status: "passed", fullName: "a passing test" },
          ],
        },
      ],
    };
    const set = buildFailureSet(run);
    expect(set.has("tests/unit/embeddings.cloud.test.js :: [collection]")).toBe(true);
    expect(set.has("tests/unit/db-concurrent.test.js :: atomic safety 100 parallel")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("writeAtomic replaces an existing characterization file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "baseline-write-"));
    const file = path.join(dir, "characterization.json");
    try {
      writeFileSync(file, "old\n");
      writeAtomic(file, "new\n");
      expect(readFileSync(file, "utf8")).toBe("new\n");
      expect(readdirSync(dir)).toEqual(["characterization.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
