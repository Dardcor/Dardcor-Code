import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("Cloud Agents dashboard contract", () => {
  it("renders the agent registry as an enabled sidebar link", () => {
    const sidebar = read("src/shared/components/Sidebar.js");
    expect(sidebar).toContain('{ href: "/dashboard/cloud-agents", label: "Agent Registry", icon: "cloud" }');
  });

  it("exists as a page component at the expected route", () => {
    const page = read("src/app/(dashboard)/dashboard/cloud-agents/page.js");
    expect(page).toContain("CloudAgentsPageClient");
  });

  it("imports shared components (Card, Badge, Button)", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).toContain("Card");
    expect(client).toContain("Badge");
    expect(client).toContain("Button");
  });

  it("fetches from the canonical agent registry endpoint", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).toContain('const STATUS_URL = "/api/agents"');
    expect(client).not.toContain("/api/cloud-agents/status");
  });

  it("renders the real registry schema", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).toContain("agent.name");
    expect(client).toContain("agent.kind");
    expect(client).toContain("agent.status.state");
    expect(client).toContain("agent.status.available");
    expect(client).toContain("agent.status.configured");
    expect(client).toContain("agent.status.running");
    expect(client).toContain("agent.status.error");
    expect(client).toContain("Object.entries(agent.capabilities");
    expect(client).toContain("data?.lifecycle");
    expect(client).toContain("agent.capabilities");
  });

  it("does not render fields absent from the registry", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).not.toMatch(/agent\.(version|description|lastActivity|unsupportedActions|config)\b/);
    expect(client).not.toContain("active processes");
  });

  it("shows honest loading state", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).toContain("CardSkeleton");
    expect(client).toContain('loading ? "—"');
  });

  it("shows honest error state", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).toContain("error &&");
    expect(client).toContain("border-red-500/30");
  });

  it("shows honest empty state", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).toContain("No agents registered.");
  });

  it("has a refresh button", () => {
    const client = read("src/app/(dashboard)/dashboard/cloud-agents/CloudAgentsPageClient.js");
    expect(client).toContain('"Refresh"');
    expect(client).toContain('icon="refresh"');
  });

  it("keeps the legacy status route as a thin registry adapter", () => {
    const route = read("src/app/api/cloud-agents/status/route.js");
    expect(route).toContain("canAccessLocalOnlyRoute");
    expect(route).toContain("agentRegistry.list()");
    expect(route).toContain("getAgentRegistryLifecycle()");
    expect(route).not.toContain("MOCK_AGENTS");
    expect(route).not.toContain("timestamp: Date.now()");
  });

  it("provides a canonical root test command", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.test).toBe("npm --prefix tests test --");
  });
});
