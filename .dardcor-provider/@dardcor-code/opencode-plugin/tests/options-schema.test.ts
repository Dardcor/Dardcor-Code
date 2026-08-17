/**
 * T-08 options-schema tests.
 *
 * Covers `parseDardcorCodePluginOptions(opts)` — the strict Zod gate that
 * validates the second-arg `PluginOptions` bag from opencode.json before
 * any hook is wired. Anti-pattern checklist mirrored here:
 *
 *  - `null` / `undefined` must collapse to `{}` (defaults apply downstream).
 *  - Unknown keys must THROW (`.strict()` catches opencode.json typos).
 *  - Validation runs at parse time, not import time (module loads cleanly).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseDardcorCodePluginOptions } from "../src/index.js";

test("parseDardcorCodePluginOptions: undefined → {}", () => {
  assert.deepEqual(parseDardcorCodePluginOptions(undefined), {});
});

test("parseDardcorCodePluginOptions: null → {}", () => {
  assert.deepEqual(parseDardcorCodePluginOptions(null), {});
});

test("parseDardcorCodePluginOptions: empty object → {}", () => {
  assert.deepEqual(parseDardcorCodePluginOptions({}), {});
});

test("parseDardcorCodePluginOptions: valid providerId → returns it", () => {
  const r = parseDardcorCodePluginOptions({ providerId: "dardcorCode-preprod" });
  assert.equal(r.providerId, "dardcorCode-preprod");
});

test("parseDardcorCodePluginOptions: invalid providerId (special chars) → throws", () => {
  assert.throws(
    () => parseDardcorCodePluginOptions({ providerId: "dardcorCode prod!" }),
    /providerId.*slug/i
  );
});

test("parseDardcorCodePluginOptions: empty providerId → throws", () => {
  assert.throws(() => parseDardcorCodePluginOptions({ providerId: "" }), /providerId/i);
});

test("parseDardcorCodePluginOptions: valid modelCacheTtl → returns it", () => {
  const r = parseDardcorCodePluginOptions({ modelCacheTtl: 60_000 });
  assert.equal(r.modelCacheTtl, 60_000);
});

test("parseDardcorCodePluginOptions: negative modelCacheTtl → throws", () => {
  assert.throws(() => parseDardcorCodePluginOptions({ modelCacheTtl: -1 }), /modelCacheTtl/i);
});

test("parseDardcorCodePluginOptions: zero modelCacheTtl → throws (positive required)", () => {
  assert.throws(() => parseDardcorCodePluginOptions({ modelCacheTtl: 0 }), /modelCacheTtl/i);
});

test("parseDardcorCodePluginOptions: invalid baseURL (not a URL) → throws", () => {
  assert.throws(() => parseDardcorCodePluginOptions({ baseURL: "not-a-url" }), /baseURL/i);
});

test("parseDardcorCodePluginOptions: unknown key → throws (strict mode catches typos)", () => {
  assert.throws(
    () =>
      parseDardcorCodePluginOptions({
        providerId: "dardcorCode",
        provider_id: "typo-here",
      }),
    /provider_id|unrecognized/i
  );
});

test("parseDardcorCodePluginOptions: all four fields populated correctly → returns them", () => {
  const opts = {
    providerId: "dardcorCode-prod",
    displayName: "DardcorCode Production",
    modelCacheTtl: 120_000,
    baseURL: "https://or.example.com/v1",
  };
  const r = parseDardcorCodePluginOptions(opts);
  assert.deepEqual(r, opts);
});

test("parseDardcorCodePluginOptions: error message lists every issue path", () => {
  // Two bad fields at once → error string should mention BOTH.
  try {
    parseDardcorCodePluginOptions({
      providerId: "",
      baseURL: "garbage",
    });
    assert.fail("expected throw");
  } catch (err) {
    const msg = (err as Error).message;
    assert.match(msg, /providerId/);
    assert.match(msg, /baseURL/);
  }
});

test("parseDardcorCodePluginOptions: module import alone does NOT throw", async () => {
  // Re-importing the entry must not trigger validation; validation only fires
  // on explicit parseDardcorCodePluginOptions / DardcorCodePlugin invocation.
  const mod = await import("../src/index.js");
  assert.equal(typeof mod.parseDardcorCodePluginOptions, "function");
});
