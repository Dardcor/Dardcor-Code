import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sidebar = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/shared/components/Sidebar.js"), "utf8");
const mitmConfig = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/mitm/config.js"), "utf8");
const registry = fs.readFileSync(path.resolve(import.meta.dirname, "../../open-sse/providers/registry/antigravity.js"), "utf8");

describe("sidebar version label", () => {
  it("shows V0.1.1 only in the sidebar", () => {
    expect(sidebar).toContain('const SIDEBAR_VERSION = "V0.1.1"');
    expect(sidebar).toContain("{SIDEBAR_VERSION}");
    // must not touch the package version source
    expect(sidebar).not.toContain("v{APP_CONFIG.version}");
  });
});

describe("antigravity gemini 3.7 flash low→high coverage", () => {
  it("registers all three 3.7 flash tiers plus the plain-key alias in the registry", () => {
    expect(registry).toContain('id: "gemini-3.7-flash-high"');
    expect(registry).toContain('id: "gemini-3.7-flash-medium"');
    expect(registry).toContain('id: "gemini-3.7-flash-low"');
    expect(registry).toContain('aliases: ["gemini-3.7-flash"]');
  });

  it("maps the plain 3.7 flash model in the MITM synonym table", () => {
    expect(mitmConfig).toContain('"gemini-3.7-flash": "gemini-3.7-flash-high"');
    expect(mitmConfig).toContain('"gemini-3.7-flash-low": "gemini-3.7-flash-low"');
    expect(mitmConfig).toContain('"gemini-3.7-flash-medium": "gemini-3.7-flash-medium"');
  });
});
