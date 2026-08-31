import { beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { listSkills, installSkill, uninstallSkill, listInstalled, __test__ } from "@/lib/skillDiscovery/service";
import { createInstallStore } from "@/lib/skillDiscovery/store";
import { normalizeSkillsShSkill, normalizeLocalSkill, skillFromSkillUrl } from "@/lib/skillDiscovery/sources";

const noDetect = async () => [];

const SEARCH_ROWS = {
  skills: [{
    id: "vercel-labs/agent-skills/vercel-react-best-practices",
    skillId: "vercel-react-best-practices",
    name: "vercel-react-best-practices",
    installs: 635059,
    source: "vercel-labs/agent-skills",
  }],
};

const SKILLS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices</loc></url>
  <url><loc>https://www.skills.sh/anthropics/skills/frontend-design</loc></url>
</urlset>`;

function sitemapIndexXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.skills.sh/sitemap-skills-1.xml</loc></sitemap>
</sitemapindex>`;
}

function makeFetch({ searchPayload = SEARCH_ROWS, failSearch = false, failCatalog = false } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.includes("/api/search")) {
      if (failSearch) throw new Error("network down");
      return { ok: true, status: 200, json: async () => searchPayload };
    }
    if (url.endsWith("sitemap.xml")) {
      if (failCatalog) throw new Error("sitemap down");
      return { ok: true, status: 200, text: async () => sitemapIndexXml() };
    }
    if (url.includes("sitemap-skills")) {
      return { ok: true, status: 200, text: async () => SKILLS_XML };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
  return { fn, calls };
}

const CLIS = [{ id: "claude", label: "Claude Code", available: true, command: "npx skills add" }];

beforeEach(() => __test__.resetCatalogCache());

describe("skill discovery service", () => {
  it("normalizes local and remote skills with distinct sources", () => {
    const local = normalizeLocalSkill({ id: "dardcor-code-chat", name: "Chat", description: "d" });
    expect(local.source).toBe("dardcor-code");
    expect(local.installed).toBe(true);

    const remote = normalizeSkillsShSkill(SEARCH_ROWS.skills[0]);
    expect(remote.source).toBe("skills.sh");
    expect(remote.installed).toBe(false);
    expect(remote.slug).toBe("vercel-react-best-practices");
    expect(remote.installCommand).toBe("npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices");
  });

  it("rejects non-allowlisted hosts when parsing sitemap URLs", () => {
    expect(skillFromSkillUrl("https://evil.example.com/a/b/c")).toBeNull();
    expect(skillFromSkillUrl("http://www.skills.sh/a/b/c")).toBeNull(); // non-https
    expect(skillFromSkillUrl("https://www.skills.sh/a/b")).toBeNull(); // too few segments
    expect(skillFromSkillUrl("https://www.skills.sh/owner/repo/slug")?.slug).toBe("slug");
  });

  it("renders the skills.sh catalog on load without a query (sitemap browse)", async () => {
    const { fn } = makeFetch();
    const result = await listSkills({ fetchImpl: fn, cliTargets: CLIS, detect: noDetect });
    expect(result.items.some((i) => i.source === "skills.sh" && i.slug === "vercel-react-best-practices")).toBe(true);
    expect(result.items.some((i) => i.source === "skills.sh" && i.slug === "frontend-design")).toBe(true);
    const remote = result.sources.find((s) => s.id === "skills.sh");
    expect(remote.available).toBe(true);
    expect(remote.count).toBe(2);
    expect(remote.note).toContain("catalog");
  });

  it("uses the search endpoint for queries of 2+ characters", async () => {
    const { fn, calls } = makeFetch();
    const result = await listSkills({ query: "react", fetchImpl: fn, cliTargets: CLIS, detect: noDetect });
    expect(result.items.some((i) => i.source === "skills.sh")).toBe(true);
    expect(calls.some((u) => u.includes("/api/search"))).toBe(true);
    expect(calls.some((u) => u.includes("sitemap"))).toBe(false);
  });

  it("marks remote search failures unavailable without fabricating data", async () => {
    const { fn } = makeFetch({ failSearch: true });
    const failed = await listSkills({ query: "react", fetchImpl: fn, cliTargets: CLIS, detect: noDetect });
    expect(failed.sources.find((s) => s.id === "skills.sh").available).toBe(false);
    expect(failed.items.some((i) => i.source === "skills.sh")).toBe(false);
  });

  it("marks catalog failures unavailable on browse", async () => {
    const { fn } = makeFetch({ failCatalog: true });
    const failed = await listSkills({ fetchImpl: fn, cliTargets: CLIS, detect: noDetect });
    expect(failed.sources.find((s) => s.id === "skills.sh").available).toBe(false);
  });

  it("marks skills as installed when detected on disk", async () => {
    const { fn } = makeFetch();
    const detect = async () => [{ slug: "vercel-react-best-practices", name: "vercel-react-best-practices", source: "Claude Code" }];
    const result = await listSkills({ fetchImpl: fn, cliTargets: CLIS, detect });
    const item = result.items.find((i) => i.slug === "vercel-react-best-practices");
    expect(item.installed).toBe(true);
    expect(result.detected).toEqual([{ slug: "vercel-react-best-practices", name: "vercel-react-best-practices", source: "Claude Code" }]);
    expect(result.counts.installed).toBeGreaterThan(0);
  });

  it("marks recorded installs as installed on subsequent lists", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skilltest-"));
    const store = createInstallStore(path.join(tmp, "records.json"));
    const { fn } = makeFetch();
    const installed = await installSkill("vercel-react-best-practices", "dardcor-code", { fetchImpl: fn, dataDir: tmp, store, detect: noDetect });
    expect(installed.ok).toBe(true);

    const result = await listSkills({ fetchImpl: fn, cliTargets: CLIS, store, detect: noDetect });
    const item = result.items.find((i) => i.slug === "vercel-react-best-practices");
    expect(item.installed).toBe(true);
  });

  it("filters by source and installed state", async () => {
    const { fn } = makeFetch();
    const result = await listSkills({ fetchImpl: fn, cliTargets: CLIS, detect: noDetect });
    expect(result.items.some((i) => i.slug === "dardcor-code-chat")).toBe(true);
    const installed = await listSkills({ fetchImpl: fn, installed: "true", cliTargets: CLIS, detect: noDetect });
    expect(installed.items.every((i) => i.installed)).toBe(true);
  });

  it("installs into the dardcor-code registry without executing or downloading", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skilltest-"));
    const store = createInstallStore(path.join(tmp, "records.json"));
    const { fn } = makeFetch();
    const result = await installSkill("dardcor-code-chat", "dardcor-code", { fetchImpl: fn, dataDir: tmp, store, detect: noDetect });
    expect(result.ok).toBe(true);
    const manifest = await fs.readFile(path.join(tmp, "skills", "dardcor-code-chat", "skill.json"), "utf8");
    const parsed = JSON.parse(manifest);
    expect(parsed.name).toBe("Chat");
    expect(JSON.stringify(parsed)).not.toMatch(/token|secret|password/i);
  });

  it("returns a manual command for remote CLI targets and never writes to CLI dirs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skilltest-"));
    const store = createInstallStore(path.join(tmp, "records.json"));
    const { fn } = makeFetch();
    const result = await installSkill("vercel-react-best-practices", "cli", {
      fetchImpl: fn,
      cliId: "claude",
      cliTargets: CLIS,
      dataDir: tmp,
      store,
      detect: noDetect,
    });
    expect(result.ok).toBe(true);
    const cli = result.targets.find((t) => t.id === "claude");
    expect(cli.command).toContain("npx skills add");
    expect(cli.command).toContain("vercel-labs/agent-skills");
    expect(cli.ownedFiles).toEqual([]);
  });

  it("never fabricates an install command for built-in skills", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skilltest-"));
    const store = createInstallStore(path.join(tmp, "records.json"));
    const { fn } = makeFetch();
    const result = await installSkill("dardcor-code-chat", "cli", {
      fetchImpl: fn,
      cliId: "claude",
      cliTargets: CLIS,
      dataDir: tmp,
      store,
      detect: noDetect,
    });
    expect(result.ok).toBe(true);
    expect(result.targets.find((t) => t.id === "claude").command).toBe("");
  });

  it("rejects unknown targets and undetected CLIs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skilltest-"));
    const store = createInstallStore(path.join(tmp, "records.json"));
    const { fn } = makeFetch();
    const unknown = await installSkill("dardcor-code-chat", "nope", { fetchImpl: fn, store, dataDir: tmp, detect: noDetect });
    expect(unknown).toMatchObject({ ok: false, code: "UNKNOWN_TARGET" });

    const missing = await installSkill("dardcor-code-chat", "cli", {
      fetchImpl: fn,
      cliId: "codex",
      cliTargets: [],
      store,
      dataDir: tmp,
      detect: noDetect,
    });
    expect(missing).toMatchObject({ ok: false, code: "CLI_NOT_DETECTED" });
  });

  it("uninstalls only owned files and clears the record", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skilltest-"));
    const store = createInstallStore(path.join(tmp, "records.json"));
    const { fn } = makeFetch();
    await installSkill("dardcor-code-chat", "dardcor-code", { fetchImpl: fn, dataDir: tmp, store, detect: noDetect });
    const removed = await uninstallSkill("dardcor-code/dardcor-code-chat", "dardcor-code", { dataDir: tmp, store });
    expect(removed.ok).toBe(true);
    expect(removed.removed).toContain("skill.json");
    const records = await listInstalled({ store });
    expect(records.find((r) => r.slug === "dardcor-code-chat")).toBeUndefined();
  });
});
