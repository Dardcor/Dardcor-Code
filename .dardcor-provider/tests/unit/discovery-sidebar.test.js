import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("discovery sidebar navigation", () => {
  const sidebar = read("src/shared/components/Sidebar.js");

  it("enables Agent Skills as a navigable link", () => {
    expect(sidebar).toContain('{ href: "/dashboard/agent-skills", label: "Agent Skills", icon: "smart_toy" }');
    // Should NOT have comingSoon on this line
    const lines = sidebar.split("\n");
    const skillsLine = lines.find((l) => l.includes("/dashboard/agent-skills"));
    expect(skillsLine).toBeDefined();
    expect(skillsLine).not.toContain("comingSoon");
  });

  it("enables API Endpoints as a navigable link", () => {
    expect(sidebar).toContain('{ href: "/dashboard/api-endpoints", label: "API Endpoints", icon: "api" }');
    const lines = sidebar.split("\n");
    const endpointsLine = lines.find((l) => l.includes("/dashboard/api-endpoints"));
    expect(endpointsLine).toBeDefined();
    expect(endpointsLine).not.toContain("comingSoon");
  });

  it("enables Discovery as a navigable link", () => {
    expect(sidebar).toContain('{ href: "/dashboard/discovery", label: "Discovery", icon: "explore" }');
    const lines = sidebar.split("\n");
    const discoveryLine = lines.find((l) => l.includes("/dashboard/discovery"));
    expect(discoveryLine).toBeDefined();
    expect(discoveryLine).not.toContain("comingSoon");
  });

  it("enables Cache as a navigable link", () => {
    expect(sidebar).toContain('{ href: "/dashboard/cache", label: "Cache", icon: "cached" }');
    const lines = sidebar.split("\n");
    const cacheLine = lines.find((l) => l.includes("/dashboard/cache"));
    expect(cacheLine).toBeDefined();
    expect(cacheLine).not.toContain("comingSoon");
  });

  it("enables Skill Discovery as a navigable link", () => {
    expect(sidebar).toContain('{ href: "/dashboard/skill-discovery", label: "Skill Discovery", icon: "rocket_launch" }');
    const lines = sidebar.split("\n");
    const skillDiscoveryLine = lines.find((l) => l.includes("/dashboard/skill-discovery"));
    expect(skillDiscoveryLine).toBeDefined();
    expect(skillDiscoveryLine).not.toContain("comingSoon");
  });

  it("places Agent Skills in the Agents section", () => {
    expect(sidebar).toContain("agentItems");
    const agentSection = sidebar.slice(sidebar.indexOf("const agentItems"));
    expect(agentSection).toContain("/dashboard/agent-skills");
  });

  it("places API Endpoints in the Integrations section", () => {
    expect(sidebar).toContain("integrationItems");
    const integrationSection = sidebar.slice(sidebar.indexOf("const integrationItems"));
    expect(integrationSection).toContain("/dashboard/api-endpoints");
  });

  it("places Discovery in the Agents section", () => {
    expect(sidebar).toContain("agentItems");
    const agentSection = sidebar.slice(sidebar.indexOf("const agentItems"));
    expect(agentSection).toContain("/dashboard/discovery");
  });
});
