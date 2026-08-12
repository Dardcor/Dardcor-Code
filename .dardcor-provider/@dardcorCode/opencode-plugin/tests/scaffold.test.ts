import test from "node:test";
import assert from "node:assert/strict";
import {
  DardcorCodePlugin,
  OMNIROUTE_PROVIDER_KEY,
  DEFAULT_MODEL_CACHE_TTL_MS,
  resolveDardcorCodePluginOptions,
} from "../src/index.js";

test("scaffold: exports public surface", () => {
  assert.equal(
    typeof DardcorCodePlugin,
    "function",
    "DardcorCodePlugin must be a function (Plugin factory)"
  );
  assert.equal(OMNIROUTE_PROVIDER_KEY, "dardcorCode");
  assert.equal(DEFAULT_MODEL_CACHE_TTL_MS, 300_000);
});

test("scaffold: default export is v1 plugin shape { id, server: DardcorCodePlugin }", async () => {
  const mod = await import("../src/index.js");
  assert.equal(typeof mod.default, "object");
  assert.equal(mod.default.id, "@dardcorCode/opencode-plugin");
  assert.equal(mod.default.server, mod.DardcorCodePlugin);
});

test("resolveDardcorCodePluginOptions: defaults", () => {
  const r = resolveDardcorCodePluginOptions();
  assert.equal(r.providerId, "opencode-dardcorCode");
  assert.equal(r.displayName, "DardcorCode");
  assert.equal(r.modelCacheTtl, 300_000);
  assert.equal(r.baseURL, undefined);
});

test("resolveDardcorCodePluginOptions: custom providerId derives displayName", () => {
  const r = resolveDardcorCodePluginOptions({ providerId: "dardcorCode-preprod" });
  assert.equal(r.providerId, "opencode-dardcorCode-preprod");
  assert.equal(r.displayName, "DardcorCode (opencode-dardcorCode-preprod)");
});

test("resolveDardcorCodePluginOptions: explicit displayName wins", () => {
  const r = resolveDardcorCodePluginOptions({
    providerId: "dardcorCode-x",
    displayName: "Custom Label",
  });
  assert.equal(r.displayName, "Custom Label");
});

test("resolveDardcorCodePluginOptions: invalid TTL falls back to default", () => {
  assert.equal(resolveDardcorCodePluginOptions({ modelCacheTtl: 0 }).modelCacheTtl, 300_000);
  assert.equal(resolveDardcorCodePluginOptions({ modelCacheTtl: -1 }).modelCacheTtl, 300_000);
});

test("resolveDardcorCodePluginOptions: positive TTL respected", () => {
  assert.equal(resolveDardcorCodePluginOptions({ modelCacheTtl: 60_000 }).modelCacheTtl, 60_000);
});

test("DardcorCodePlugin: returns an empty hooks object (scaffold)", async () => {
  const fakeCtx = {} as Parameters<typeof DardcorCodePlugin>[0];
  const hooks = await DardcorCodePlugin(fakeCtx);
  assert.equal(typeof hooks, "object");
  assert.notEqual(hooks, null);
});

test("scaffold: built ESM default export resolves with the v1 plugin shape", async () => {
  // The plugin is ESM-only now — the CJS bundle was dropped to fix the OpenCode
  // loader (#3883), so there is no more ../dist/index.cjs. Validate that the built
  // distributable's default export still carries the OpenCode v1 { id, server } shape.
  const mod = await import("../dist/index.js");
  assert.strictEqual(typeof mod.default, "object");
  assert.strictEqual(mod.default.id, "@dardcorCode/opencode-plugin");
  assert.strictEqual(typeof mod.default.server, "function");
});
