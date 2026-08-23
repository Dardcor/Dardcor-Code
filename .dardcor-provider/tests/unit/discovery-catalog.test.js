import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { API_ENDPOINT_CATALOG } from "../../src/lib/discovery/catalog.js";
import { serializeEndpoint, serializeSkill } from "../../src/lib/discovery/serializers.js";

const root = path.resolve(import.meta.dirname, "../..");

function routeFor(apiPath) {
  const relative = apiPath.replace(/^\/api\//, "");
  return path.join(root, "src/app/api", relative, "route.js");
}

function keys(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)]);
}

describe("discovery endpoint catalog", () => {
  it("is immutable, classified, and backed by real route families", () => {
    expect(Object.isFrozen(API_ENDPOINT_CATALOG)).toBe(true);
    expect(API_ENDPOINT_CATALOG).toHaveLength(16);
    for (const endpoint of API_ENDPOINT_CATALOG) {
      expect(Object.isFrozen(endpoint)).toBe(true);
      expect(["public-api-key", "dashboard", "local-only", "experimental"]).toContain(endpoint.auth);
      expect(fs.existsSync(routeFor(endpoint.path))).toBe(true);
    }
  });

  it("uses allowlisted, secret-safe serializer output", () => {
    const skill = serializeSkill({
      id: "safe", name: "Safe", description: "metadata", source: "test", scope: "read",
      schema: { type: "object", properties: { query: { type: "string" }, password: { type: "string" } } },
      endpoint: "/api/safe", token: "do-not-return", headers: { authorization: "secret" },
    });
    const endpoint = serializeEndpoint({
      ...API_ENDPOINT_CATALOG[0], secret: "do-not-return", payload: { password: "secret" },
    });

    expect(keys(skill).join(" ")).not.toMatch(/token|secret|password|authorization|cookie|headers|payload|pathOnDisk/i);
    expect(keys(endpoint).join(" ")).not.toMatch(/token|secret|password|authorization|cookie|headers|payload|pathOnDisk/i);
    expect(endpoint.curl).toContain("$MIAWROUTER_API_KEY");
    expect(JSON.stringify({ skill, endpoint })).not.toContain("do-not-return");
  });
});
