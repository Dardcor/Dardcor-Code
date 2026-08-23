import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const lockPath = join(ROOT, "package-lock.json");
const pkgPath = join(ROOT, "package.json");
const gitignorePath = join(ROOT, ".gitignore");

describe("lockfile policy", () => {
  it("root package-lock.json is tracked (exists in repo)", () => {
    expect(existsSync(lockPath)).toBe(true);
  });

  it("lockfile name matches package.json name", () => {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    expect(lock.name).toBe(pkg.name);
  });

  it("lockfile version matches package.json version", () => {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    expect(lock.version).toBe(pkg.version);
  });

  it(".gitignore does not ignore package-lock.json", () => {
    const lines = readFileSync(gitignorePath, "utf8").split("\n");
    const ignoring = lines.some((l) => l.trim() === "package-lock.json");
    expect(ignoring).toBe(false);
  });
});
