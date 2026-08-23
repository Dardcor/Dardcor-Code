import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("MCP dashboard contract", () => {
  it("renders MCP as an enabled sidebar link", () => {
    const sidebar = read("src/shared/components/Sidebar.js");
    expect(sidebar).toContain('{ href: "/dashboard/mcp", label: "MCP", icon: "cable" }');
  });

  it("labels endpoint reachability and forwarded-call metrics honestly", () => {
    const page = read("src/app/(dashboard)/dashboard/mcp/McpPageClient.js");
    expect(page).toContain('value: loading ? "—" : data?.api?.responding ? "Responding" : "Error"');
    expect(page).toContain("Forwarded Tool Calls");
    expect(page).not.toContain('data?.ok ? "Healthy"');
  });

  it("keeps quota reads independent from the credential-refreshing usage route", () => {
    const adapters = read("src/lib/mcp/adapters.js");
    expect(adapters).not.toContain('from "@/app/api/usage/[connectionId]/route"');
    expect(adapters).not.toContain("refreshAndUpdateCredentials");
    expect(adapters).toContain("getUsageForProvider(connection");
  });
});
