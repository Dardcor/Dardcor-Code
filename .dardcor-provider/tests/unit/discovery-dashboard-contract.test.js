import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("discovery dashboard contract", () => {
  const page = read("src/app/(dashboard)/dashboard/discovery/page.js");
  const client = read("src/app/(dashboard)/dashboard/discovery/DiscoveryPageClient.js");

  it("fetches the canonical discovery endpoint with query, type, and status params", () => {
    expect(client).toContain('const API_URL = "/api/discovery"');
    expect(client).toContain("fetch(url, { cache: \"no-store\" })");
    expect(client).toContain("params.set(\"query\"");
    expect(client).toContain("params.set(\"type\"");
  });

  it("renders the response shape: items, counts, and sources", () => {
    expect(client).toContain("data?.items || []");
    expect(client).toContain("data?.counts || {}");
    expect(client).toContain("data?.sources || []");
  });

  it("renders all result types: provider, model, agent, skill, endpoint", () => {
    expect(client).toContain("provider");
    expect(client).toContain("model");
    expect(client).toContain("agent");
    expect(client).toContain("skill");
    expect(client).toContain("endpoint");
  });

  it("has type filter controls with counts", () => {
    expect(client).toContain("typeFilter");
    expect(client).toContain("onTypeChange");
    expect(client).toContain("CountPills");
  });

  it("links to known pages only", () => {
    expect(client).toContain("/dashboard/providers/");
    expect(client).toContain("/dashboard/agent-skills");
    expect(client).toContain("/dashboard/api-endpoints");
    expect(client).toContain("/dashboard/cloud-agents");
  });

  it("renders loading, error, and empty states", () => {
    expect(client).toContain("loading");
    expect(client).toContain("CardSkeleton");
    expect(client).toContain("No discovery data available");
    expect(client).toContain("No results for");
    expect(client).toContain("error");
  });

  it("renders source error metadata", () => {
    expect(client).toContain('s.status === "available"');
    expect(client).toContain("Unavailable");
  });

  it("has no mock or fake fields and no comingSoon flag", () => {
    expect(client).not.toContain("mock");
    expect(client).not.toContain("fake");
    expect(client).not.toContain("Soon");
    expect(client).not.toContain("comingSoon");
  });

  it("bounds search query to 100 chars", () => {
    expect(client).toContain("maxLength={100}");
    expect(client).toContain("searchQuery.slice(0, 100)");
  });

  it("has debounce on search input", () => {
    expect(client).toContain("debounceRef");
    expect(client).toContain("debouncedQuery");
  });

  it("exports a page component and metadata", () => {
    expect(page).toContain("DiscoveryPageClient");
    expect(page).toContain("metadata");
  });
});
