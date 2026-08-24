import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("api-endpoints dashboard contract", () => {
  const page = read("src/app/(dashboard)/dashboard/api-endpoints/page.js");
  const client = read("src/app/(dashboard)/dashboard/api-endpoints/ApiEndpointsPageClient.js");

  it("fetches the canonical endpoints endpoint", () => {
    expect(client).toContain('const API_URL = "/api/discovery/endpoints"');
    expect(client).toContain("fetch(API_URL, { cache: \"no-store\" })");
  });

  it("renders the response shape: items and sources", () => {
    expect(client).toContain("data?.items || []");
    expect(client).toContain("data?.sources || []");
  });

  it("renders endpoint fields: method, path, auth, category, status, capability, description", () => {
    expect(client).toContain("endpoint.method");
    expect(client).toContain("endpoint.path");
    expect(client).toContain("endpoint.auth");
    expect(client).toContain("endpoint.category");
    expect(client).toContain("endpoint.status");
    expect(client).toContain("endpoint.capability");
    expect(client).toContain("endpoint.description");
  });

  it("renders curl examples and copy button", () => {
    expect(client).toContain("endpoint.curl");
    expect(client).toContain("CopyButton");
    expect(client).toContain("Copy cURL");
  });

  it("has auth filter controls", () => {
    expect(client).toContain("authFilter");
    expect(client).toContain('authFilter === "all"');
    expect(client).toContain("setAuthFilter");
  });

  it("renders loading, error, and empty states", () => {
    expect(client).toContain("loading");
    expect(client).toContain("CardSkeleton");
    expect(client).toContain("No API endpoints cataloged");
    expect(client).toContain("No endpoints match your search");
    expect(client).toContain("error");
  });

  it("renders auth-specific badges for public-api-key, dashboard, local-only, experimental", () => {
    expect(client).toContain('"public-api-key"');
    expect(client).toContain("dashboard");
    expect(client).toContain('"local-only"');
    expect(client).toContain('"experimental"');
  });

  it("warns about local-only and experimental routes", () => {
    expect(client).toContain("local-only and not accessible");
    expect(client).toContain("experimental and may change");
  });

  it("has no execution or mutation controls", () => {
    expect(client).not.toMatch(/\bexecute\b/);
    expect(client).not.toContain("run(");
    expect(client).not.toContain("invoke(");
    // copy button is ok — it's read-only cURL copy
    expect(client).not.toContain("send(");
    // No fetch calls with mutation methods
    expect(client).not.toContain('method: "DELETE"');
    expect(client).not.toContain('method: "PUT"');
    expect(client).not.toContain('method: "PATCH"');
    expect(client).not.toContain('method: "POST"');
  });

  it("has no mock or fake fields", () => {
    expect(client).not.toContain("mock");
    expect(client).not.toContain("fake");
    expect(client).not.toContain("Soon");
    expect(client).not.toContain("comingSoon");
  });

  it("uses placeholder credentials, never real ones", () => {
    expect(client).toContain("$DARDCOR CODE_BASE_URL");
    expect(client).toContain("$DARDCOR CODE_API_KEY");
    // No real keys or paths
    expect(client).not.toContain("sk-");
    expect(client).not.toContain("/home/");
  });

  it("exports a page component and metadata", () => {
    expect(page).toContain("ApiEndpointsPageClient");
    expect(page).toContain("metadata");
  });
});
