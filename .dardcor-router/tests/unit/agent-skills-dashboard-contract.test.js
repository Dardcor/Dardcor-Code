import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("agent-skills dashboard contract", () => {
  const page = read("src/app/(dashboard)/dashboard/agent-skills/page.js");
  const client = read("src/app/(dashboard)/dashboard/agent-skills/AgentSkillsPageClient.js");

  it("fetches the canonical skills endpoint", () => {
    expect(client).toContain('const API_URL = "/api/discovery/skills"');
    expect(client).toContain("fetch(API_URL, { cache: \"no-store\" })");
  });

  it("renders the response shape: items and sources", () => {
    expect(client).toContain("data?.items || []");
    expect(client).toContain("data?.sources || []");
  });

  it("renders skill fields: id, name, description, source, scope, inputSchema, endpoint, status", () => {
    expect(client).toContain("skill.name");
    expect(client).toContain("skill.source");
    expect(client).toContain("skill.scope");
    expect(client).toContain("skill.description");
    expect(client).toContain("skill.endpoint");
    expect(client).toContain("skill.status");
    expect(client).toContain("skill.inputSchema");
    expect(client).toContain("skill.id");
  });

  it("has source filter controls", () => {
    expect(client).toContain("sourceFilter");
    expect(client).toContain('sourceFilter === "all"');
    expect(client).toContain("setSourceFilter");
  });

  it("renders loading, error, and empty states", () => {
    expect(client).toContain("loading");
    expect(client).toContain("CardSkeleton");
    expect(client).toContain("No agent skills registered");
    expect(client).toContain("No skills match your search");
    expect(client).toContain("error");
  });

  it("renders source-unavailable warnings", () => {
    expect(client).toContain('source.status === "available"');
    expect(client).toContain('"error"');
    expect(client).toContain("Unavailable");
  });

  it("has no execution or mutation controls", () => {
    expect(client).not.toContain("execute");
    expect(client).not.toContain("run(");
    expect(client).not.toContain("invoke(");
    expect(client).not.toContain("POST");
    expect(client).not.toContain("DELETE");
    expect(client).not.toContain("PUT");
    expect(client).not.toContain("PATCH");
  });

  it("has no mock or fake fields", () => {
    expect(client).not.toContain("mock");
    expect(client).not.toContain("fake");
    expect(client).not.toContain("Soon");
    expect(client).not.toContain("comingSoon");
  });

  it("exports a page component and metadata", () => {
    expect(page).toContain("AgentSkillsPageClient");
    expect(page).toContain("metadata");
  });
});
