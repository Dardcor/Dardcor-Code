import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("baseline verifier paths", () => {
  it("matches a known failure outside an /app checkout", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "miaw-baseline-"));
    tempDirs.push(dir);
    const resultsPath = path.join(dir, "results.json");
    writeFileSync(resultsPath, JSON.stringify({
      testResults: [{
        name: "/tmp/clone/tests/unit/openai-to-claude.test.js",
        assertionResults: [{
          status: "failed",
          fullName: "openaiToClaudeResponse omits empty Read pages tool argument before emitting Claude input deltas",
        }],
      }],
    }));

    const result = spawnSync(process.execPath, [
      path.resolve("__baseline__/verify-no-regression.mjs"),
      resultsPath,
    ], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("No regression");
  });
});
