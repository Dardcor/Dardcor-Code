import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/shared/components/Sidebar.js"), "utf8");

function entry(route) {
  return source.split("\n").find((line) => line.includes(`href: "${route}"`)) || "";
}

describe("Sidebar Soon audit", () => {
  it.each([
    "/dashboard/health", "/dashboard/runtime", "/dashboard/provider-stats", "/dashboard/activity",
    "/dashboard/logs", "/dashboard/costs", "/dashboard/settings/feature-flags", "/dashboard/guardrails",
    "/dashboard/playground", "/dashboard/mcp", "/dashboard/a2a", "/dashboard/memory",
    "/dashboard/batch", "/dashboard/webhooks", "/dashboard/cloud-agents",
    "/dashboard/api-endpoints", "/dashboard/agent-skills", "/dashboard/discovery",
    "/dashboard/skill-discovery", "/dashboard/cache",
  ])("enables verified functional route %s", (route) => {
    expect(entry(route)).not.toBe("");
    expect(entry(route)).not.toContain("comingSoon");
  });

  it("leaves no remaining Soon entries", () => {
    expect(source).not.toContain("comingSoon: true");
  });
});
