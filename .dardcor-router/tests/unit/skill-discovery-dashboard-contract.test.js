import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("skill-discovery dashboard contract", () => {
  const page = read("src/app/(dashboard)/dashboard/skill-discovery/page.js");
  const client = read("src/app/(dashboard)/dashboard/skill-discovery/SkillDiscoveryPageClient.js");

  it("fetches the canonical discovery endpoint", () => {
    expect(client).toContain('const API_URL = "/api/skill-discovery"');
    expect(client).toContain('cache: "no-store"');
    expect(client).toContain("buildUrl");
  });

  it("renders the response shape: items, counts, sources, targets, detected", () => {
    expect(client).toContain("data?.items || []");
    expect(client).toContain("data?.counts");
    expect(client).toContain("data?.sources || []");
    expect(client).toContain("data?.targets || []");
    expect(client).toContain("data?.detected || []");
  });

  it("renders search and source/installed filters", () => {
    expect(client).toContain("setSearch");
    expect(client).toContain("sourceFilter");
    expect(client).toContain("installedFilter");
    expect(client).toContain("maxLength={100}");
  });

  it("posts install with explicit target selection", () => {
    expect(client).toContain("/install");
    expect(client).toContain("method: \"POST\"");
    expect(client).toContain("target: mode");
    expect(client).toContain("cliId");
  });

  it("shows manual CLI commands without executing shells", () => {
    expect(client).toContain("npx skills add");
    expect(client).not.toContain("child_process");
    expect(client).not.toContain("exec(");
    expect(client).not.toContain("spawn(");
  });

  it("marks source failure and built-in/installed states", () => {
    expect(client).toContain("source.available === true");
    expect(client).toContain("Unavailable");
    expect(client).toContain("skill.builtin");
    expect(client).toContain("skill.installed");
  });

  it("has no mock or fake fields", () => {
    expect(client).not.toContain("mock");
    expect(client).not.toContain("fake");
    expect(client).not.toContain("comingSoon");
    expect(client).not.toContain("Soon");
  });

  it("exports a page component and metadata", () => {
    expect(page).toContain("SkillDiscoveryPageClient");
    expect(page).toContain("metadata");
  });
});
