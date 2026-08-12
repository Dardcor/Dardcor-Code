/**
 * T-02 auth-hook contract tests.
 *
 * Covers the `createDardcorCodeAuthHook(opts)` factory and its loader behaviour
 * against every Auth flavor (`api`, `oauth`, null, empty key). Validates the
 * multi-instance fix: provider id flows from plugin options, not a module
 * constant.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createDardcorCodeAuthHook } from "../src/index.js";

test("createDardcorCodeAuthHook: default providerId is 'dardcorCode'", () => {
  const hook = createDardcorCodeAuthHook();
  assert.equal(hook.provider, "opencode-dardcorCode");
});

test("createDardcorCodeAuthHook: custom providerId binds to hook.provider (multi-instance)", () => {
  const hook = createDardcorCodeAuthHook({ providerId: "dardcorCode-preprod" });
  assert.equal(hook.provider, "opencode-dardcorCode-preprod");
});

test("createDardcorCodeAuthHook: methods[0] is type 'api' with label including displayName", () => {
  const hook = createDardcorCodeAuthHook();
  assert.equal(Array.isArray(hook.methods), true);
  assert.equal(hook.methods.length, 1);
  const m = hook.methods[0];
  assert.equal(m.type, "api");
  assert.equal(m.label, "DardcorCode API Key");

  const custom = createDardcorCodeAuthHook({ providerId: "dardcorCode-preprod" });
  assert.equal(custom.methods[0].label, "DardcorCode (opencode-dardcorCode-preprod) API Key");
});

test("createDardcorCodeAuthHook: prompts[0] uses key='apiKey' per @opencode-ai/plugin contract", () => {
  // NOTE: spec referenced `name: "apiKey"`; the official
  // @opencode-ai/plugin@1.15.6 prompt shape uses `key` + `message` (no
  // `name`/`label`/`mask` fields). Asserting against the real type contract.
  const hook = createDardcorCodeAuthHook();
  const m = hook.methods[0];
  assert.equal(m.type, "api");
  // narrow: api method may carry prompts
  const prompts = "prompts" in m ? m.prompts : undefined;
  assert.ok(Array.isArray(prompts) && prompts.length === 1, "expected one prompt");
  const p = prompts![0];
  assert.equal(p.type, "text");
  assert.equal((p as { key: string }).key, "apiKey");
  assert.ok(
    typeof (p as { message: string }).message === "string" &&
      (p as { message: string }).message.includes("dardcorCode"),
    "prompt message should mention provider id"
  );
});

test("loader: valid api auth → {apiKey} when no baseURL option (T-04: fetch omitted)", async () => {
  // T-04 changed the loader return shape: without a resolvable baseURL the
  // interceptor cannot gate-keep requests, so the loader falls back to
  // apiKey-only and the AI-SDK uses its default fetch. See fetch-interceptor
  // tests for the wired-fetch branches.
  const hook = createDardcorCodeAuthHook();
  assert.ok(hook.loader, "loader must be defined");
  const result = await hook.loader!(
    async () => ({ type: "api", key: "sk-test" }) as never,
    {} as never
  );
  assert.deepEqual(result, { apiKey: "sk-test" });
});

test("loader: valid api auth → {apiKey, baseURL, fetch} when baseURL option set (T-04)", async () => {
  const hook = createDardcorCodeAuthHook({ baseURL: "https://or.example.com/v1" });
  const result = await hook.loader!(
    async () => ({ type: "api", key: "sk-x" }) as never,
    {} as never
  );
  assert.equal((result as { apiKey: string }).apiKey, "sk-x");
  assert.equal((result as { baseURL: string }).baseURL, "https://or.example.com/v1");
  assert.equal(
    typeof (result as { fetch?: unknown }).fetch,
    "function",
    "T-04: loader must wire fetch interceptor when baseURL resolves"
  );
});

test("loader: features.fetchInterceptor=false AND geminiSanitization=false → no custom fetch (flags honored)", async () => {
  // Regression: both fetch-layer flags were documented + schema-validated but
  // silently ignored. Disabling both must fall back to the SDK default fetch.
  const hook = createDardcorCodeAuthHook({
    baseURL: "https://or.example.com/v1",
    features: { fetchInterceptor: false, geminiSanitization: false },
  });
  const result = await hook.loader!(
    async () => ({ type: "api", key: "sk-x" }) as never,
    {} as never
  );
  assert.deepEqual(result, { apiKey: "sk-x", baseURL: "https://or.example.com/v1" });
  assert.equal(
    (result as { fetch?: unknown }).fetch,
    undefined,
    "both flags off must omit the custom fetch"
  );
});

test("loader: features.fetchInterceptor=false but geminiSanitization=true → fetch still wired (sanitizer only)", async () => {
  const hook = createDardcorCodeAuthHook({
    baseURL: "https://or.example.com/v1",
    features: { fetchInterceptor: false, geminiSanitization: true },
  });
  const result = await hook.loader!(
    async () => ({ type: "api", key: "sk-x" }) as never,
    {} as never
  );
  assert.equal(
    typeof (result as { fetch?: unknown }).fetch,
    "function",
    "geminiSanitization alone must still provide a fetch wrapper"
  );
});

test("loader: null/undefined auth → {} (no creds yet, OC surfaces /connect)", async () => {
  const hook = createDardcorCodeAuthHook();
  const r1 = await hook.loader!(async () => null as never, {} as never);
  assert.deepEqual(r1, {});
  const r2 = await hook.loader!(async () => undefined as never, {} as never);
  assert.deepEqual(r2, {});
});

test("loader: oauth-flavored auth → {} (wrong method type, ignored)", async () => {
  const hook = createDardcorCodeAuthHook();
  const result = await hook.loader!(
    async () =>
      ({
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 0,
      }) as never,
    {} as never
  );
  assert.deepEqual(result, {});
});

test("loader: api auth with empty key → {} (empty creds rejected)", async () => {
  const hook = createDardcorCodeAuthHook();
  const result = await hook.loader!(async () => ({ type: "api", key: "" }) as never, {} as never);
  assert.deepEqual(result, {});
});
