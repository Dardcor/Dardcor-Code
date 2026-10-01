import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("A2A dashboard contract", () => {
  it("renders A2A as a sidebar link in the integrations section", () => {
    const sidebar = read("src/shared/components/Sidebar.js");
    expect(sidebar).toContain('{ href: "/dashboard/a2a", label: "A2A", icon: "swap_horiz"');
  });

  it("exists as a page component at the expected route", () => {
    const page = read("src/app/(dashboard)/dashboard/a2a/page.js");
    expect(page).toContain("A2aPageClient");
  });

  it("imports shared components (Card, Badge, Button)", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("Card");
    expect(client).toContain("Badge");
    expect(client).toContain("Button");
  });

  it("fetches from /api/a2a/status endpoint", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("/api/a2a/status");
  });

  it("shows agent card with name, version, and capabilities", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("agentCard.name");
    expect(client).toContain("agentCard.version");
    expect(client).toContain("Capabilities");
  });

  it("shows endpoint and auth state", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("Endpoint");
    expect(client).toContain("auth.requireLogin");
    expect(client).toContain("auth.hasApiKeys");
  });

  it("shows skills as read-only advertisements", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("Agent Skills");
    expect(client).toContain("Read-only");
    expect(client).toContain("skill.id");
    expect(client).toContain("skill.description");
  });

  it("shows task history section", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("Task History");
    expect(client).toContain("No A2A tasks have been submitted yet");
  });

  it("shows honest loading state", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("CardSkeleton");
    expect(client).toContain('loading ? "—"');
  });

  it("shows honest error state", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("error &&");
    expect(client).toContain("border-red-500/30");
  });

  it("shows honest empty state for tasks", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("inbox");
    expect(client).toContain("No A2A tasks have been submitted yet");
  });

  it("shows honest empty state for skills", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain("No skills advertised by this agent");
  });

  it("has a refresh button", () => {
    const client = read("src/app/(dashboard)/dashboard/a2a/A2aPageClient.js");
    expect(client).toContain('"Refresh"');
    expect(client).toContain('icon="refresh"');
  });

  it("API route uses the local-only guard", () => {
    const route = read("src/app/api/a2a/status/route.js");
    expect(route).toContain("canAccessLocalOnlyRoute");
    expect(route).toContain("Local only: CLI token required");
  });

  it("API route returns honest error on failure", () => {
    const route = read("src/app/api/a2a/status/route.js");
    expect(route).toContain("[a2a/status] error:");
    expect(route).toContain("status: 500");
  });

  it("status reads the shared A2A task history", () => {
    const route = read("src/app/api/a2a/status/route.js");
    expect(route).toContain("getRecentA2ATasks");
  });

  it("provides a canonical root test command", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.test).toBe("npm --prefix tests test --");
  });
});
