import { describe, expect, it } from "vitest";
import { detectInstalledSkills, skillRoots } from "@/lib/skillDiscovery/installed";

function makeFs(tree) {
  // tree: { [rootDir]: [{ name, hasSkill }] }
  return {
    async readdir(dir) {
      const list = tree[dir];
      if (!list) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return list.map((e) => ({ name: e.name, isDirectory: () => true }));
    },
    async stat(p) {
      const parts = p.split("/");
      const root = parts.slice(0, -2).join("/");
      const name = parts[parts.length - 2];
      const list = tree[root] || [];
      const entry = list.find((e) => e.name === name);
      if (entry && entry.hasSkill && p.endsWith("/SKILL.md")) return { isFile: () => true };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  };
}

describe("installed skill detection", () => {
  it("scans known skill directories across platforms", () => {
    const roots = skillRoots("/home/u");
    expect(roots.map((r) => r.dir)).toEqual([
      "/home/u/.agents/skills",
      "/home/u/.claude/skills",
      "/home/u/.codex/skills",
      "/home/u/.config/opencode/skills",
      "/home/u/.cursor/skills",
    ]);
  });

  it("detects only directories containing SKILL.md", async () => {
    const fsImpl = makeFs({
      "/home/u/.claude/skills": [
        { name: "foo", hasSkill: true },
        { name: "empty-dir", hasSkill: false },
      ],
      "/home/u/.codex/skills": [{ name: "baz", hasSkill: true }],
    });
    const detected = await detectInstalledSkills({ fsImpl, homeDir: "/home/u" });
    expect(detected).toEqual([
      { slug: "foo", name: "foo", source: "Claude Code" },
      { slug: "baz", name: "baz", source: "Codex" },
    ]);
  });

  it("ignores missing roots and never exposes absolute paths", async () => {
    const fsImpl = makeFs({}); // nothing exists
    const detected = await detectInstalledSkills({ fsImpl, homeDir: "/home/u" });
    expect(detected).toEqual([]);
    expect(JSON.stringify(detected)).not.toContain("/home/");
  });
});
