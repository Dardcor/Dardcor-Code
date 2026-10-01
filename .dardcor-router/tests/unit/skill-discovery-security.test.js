import { describe, expect, it } from "vitest";
import {
  validateRelativePath,
  validateFileEntry,
  validateManifest,
  redactMetadata,
  sha256,
  sanitizeSlug,
  LIMITS,
} from "@/lib/skillDiscovery/security";

describe("skill discovery security", () => {
  it("rejects traversal, absolute, and unsafe paths", () => {
    expect(validateRelativePath("../etc/passwd").ok).toBe(false);
    expect(validateRelativePath("a/../../b").ok).toBe(false);
    expect(validateRelativePath("/etc/passwd").ok).toBe(false);
    expect(validateRelativePath("C:/windows").ok).toBe(false);
    expect(validateRelativePath("a\\b").ok).toBe(false);
    expect(validateRelativePath("a\0b").ok).toBe(false);
    expect(validateRelativePath(".").ok).toBe(false);
    expect(validateRelativePath("a//b").ok).toBe(false);
  });

  it("accepts safe nested relative paths", () => {
    expect(validateRelativePath("SKILL.md").ok).toBe(true);
    expect(validateRelativePath("skills/foo/SKILL.md").ok).toBe(true);
  });

  it("refuses executable or oversized entries", () => {
    expect(validateFileEntry({ path: "install.sh", size: 10, sha256: "a".repeat(64) }).ok).toBe(false);
    expect(validateFileEntry({ path: "a.exe", size: 10, sha256: "a".repeat(64) }).ok).toBe(false);
    expect(validateFileEntry({ path: "SKILL.md", size: LIMITS.MAX_SKILL_FILE_BYTES + 1, sha256: "a".repeat(64) }).ok).toBe(false);
    expect(validateFileEntry({ path: "SKILL.md", size: 10, sha256: "not-a-sha" }).ok).toBe(false);
  });

  it("validates a manifest and rejects duplicates and script hooks", () => {
    const good = { name: "demo", files: [{ path: "SKILL.md", size: 10, sha256: "a".repeat(64) }] };
    expect(validateManifest(good).ok).toBe(true);

    const dup = { name: "demo", files: [
      { path: "SKILL.md", size: 10, sha256: "a".repeat(64) },
      { path: "SKILL.md", size: 10, sha256: "b".repeat(64) },
    ] };
    expect(validateManifest(dup).ok).toBe(false);

    const script = { name: "demo", files: [{ path: "run.sh", size: 10, sha256: "a".repeat(64) }] };
    expect(validateManifest(script).ok).toBe(false);
  });

  it("redacts secret-bearing keys recursively", () => {
    const input = {
      name: "demo",
      apiKey: "secret",
      headers: { authorization: "Bearer x" },
      nested: { password: "pw", safe: "ok", list: [{ token: "t" }, { ok: 1 }] },
    };
    const out = redactMetadata(input);
    expect(out).not.toHaveProperty("apiKey");
    expect(out).not.toHaveProperty("headers");
    expect(out.nested).not.toHaveProperty("password");
    expect(out.nested.list[0]).not.toHaveProperty("token");
    expect(out.nested.safe).toBe("ok");
  });

  it("produces a stable sha256 and safe slug", () => {
    expect(sha256("abc")).toHaveLength(64);
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sanitizeSlug("Owner/Repo/My Skill!")).toBe("owner-repo-my-skill");
  });
});
