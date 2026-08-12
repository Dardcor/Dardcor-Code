/**
 * Regression test for #6859.
 *
 * `resolveDardcorCodePluginOptions()` auto-prefixes `providerId` with
 * `"opencode-"` (commit 75b52e286) so OpenCode 1.17.8+'s native-adapter gate
 * accepts it as an OC-registered provider id. That prefixed value must stay
 * OC-internal (AuthHook.provider / provider registration keys) — it must
 * NEVER leak into the identifiers DardcorCode's own server parses to resolve
 * credentials (`mapRawModelToModelV2`'s `id`/`providerID`,
 * `mapComboToModelV2`'s `providerID`, and the dynamic-hook catalog keys).
 *
 * DardcorCode's server-side `parseModel()` (open-sse/services/model.ts) splits
 * a dispatched model string on `/` to recover the provider name and look up
 * credentials. If the plugin embeds the OC-gate-prefixed id in that string,
 * the server looks up credentials for a provider named "opencode-dardcorCode"
 * (which never exists in `src/shared/constants/providers.ts`) instead of
 * "dardcorCode" — producing the exact "No credentials for opencode-dardcorCode" /
 * "No active credentials for provider: opencode-dardcorCode" errors reported
 * in #6859.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStaticProviderEntry,
  createDardcorCodeProviderHook,
  mapRawModelToModelV2,
  resolveDardcorCodePluginOptions,
  type dardcorCodeRawCombo,
} from "../src/index.js";

/**
 * Minimal stand-in for DardcorCode's own `parseModel()` (open-sse/services/
 * model.ts), which splits a dispatched `<providerID>/<modelID>` string on the
 * FIRST "/" to recover the provider name used for credential lookup. Kept
 * local (rather than cross-importing the real module) so this package's
 * self-contained test suite (`cd @dardcorCode/opencode-plugin && npm test`)
 * doesn't depend on the root repo's `@/*` path-alias resolution.
 */
function splitProviderFromDispatchedModel(modelStr: string): string {
  const idx = modelStr.indexOf("/");
  return idx === -1 ? modelStr : modelStr.slice(0, idx);
}

const apiAuth = (key: string) => ({ type: "api" as const, key });

test("#6859: server-facing model id/providerID must resolve to the unprefixed provider name", () => {
  const resolved = resolveDardcorCodePluginOptions();

  // The OC-gate-compatible id stays prefixed — it is legitimate for
  // AuthHook.provider / provider registration.
  assert.equal(resolved.providerId, "opencode-dardcorCode");

  // A second, unprefixed id must be exposed for anything that reaches
  // DardcorCode's own server (model id prefix, ModelV2.providerID, combo keys).
  assert.equal(
    resolved.dardcorCodeProviderId,
    "dardcorCode",
    "resolveDardcorCodePluginOptions() must expose an unprefixed dardcorCodeProviderId"
  );

  // A bare raw /v1/models entry (no existing "/" in its id — the common
  // case for DardcorCode's catalog) mapped with the server-facing id.
  const model = mapRawModelToModelV2(
    { id: "claude-opus-4-7" },
    { providerId: resolved.dardcorCodeProviderId, baseURL: "http://localhost:20128" }
  );

  assert.equal(model.providerID, "dardcorCode");
  assert.equal(model.id, "dardcorCode/claude-opus-4-7");

  // OpenCode dispatches back to DardcorCode using `providerID/modelKey`
  // (matches the issue's own repro: `-m opencode-dardcorCode/oc/big-pickle`).
  const dispatchedModelString = `${model.providerID}/claude-opus-4-7`;
  const parsedProvider = splitProviderFromDispatchedModel(dispatchedModelString);

  assert.equal(
    parsedProvider,
    "dardcorCode",
    `server-side provider split resolved '${parsedProvider}', expected 'dardcorCode' — ` +
      `credentials lookup would fail for an OC-gate-prefixed provider id`
  );
});

test("#6859: createDardcorCodeProviderHook end-to-end — catalog keys/providerID never carry the OC-gate prefix", async () => {
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    {
      fetcher: async () => [{ id: "claude-opus-4-7" }],
      combosFetcher: async () => [],
    }
  );
  const out = await hook.models!({} as never, { auth: apiAuth("sk-test") as never });
  const model = out["dardcorCode/claude-opus-4-7"];
  assert.ok(model, "catalog keyed under the unprefixed provider name");
  assert.equal(model.providerID, "dardcorCode");
  assert.ok(
    !model.providerID.startsWith("opencode-"),
    "the OC-gate prefix must never leak into ModelV2.providerID"
  );
});

// #7976: buildStaticProviderEntry (the STATIC provider() config-hook path,
// exercised when the plugin writes `opencode.json` up front rather than
// registering the dynamic `provider.models()` hook) never received the
// #6859 fix. OC dispatches a static-catalog `models` map key verbatim as
// the `model` field of the outbound request — only the top-level
// `provider["<id>"]` segment is stripped for routing — so a bare-slug combo
// key built with the OC-gated `providerId` reaches DardcorCode's server
// doubled and fails credential lookup for the nonexistent provider
// `opencode-dardcorCode`. Confirmed against the issue's own curl repro
// (`model: "opencode-dardcorCode/hermes-smart-stack"` → "No active
// credentials for provider: opencode-dardcorCode").
test("#7976: buildStaticProviderEntry keys bare-slug combo ids with the unprefixed dardcorCodeProviderId (no double OC-gate prefix)", () => {
  const resolved = resolveDardcorCodePluginOptions({ providerId: "dardcorCode" });
  assert.equal(resolved.providerId, "opencode-dardcorCode");
  assert.equal(resolved.dardcorCodeProviderId, "dardcorCode");

  const combo = {
    id: "combo-abc123",
    name: "Hermes Smart Stack",
    isHidden: false,
    models: [],
  } as unknown as dardcorCodeRawCombo;

  const block = buildStaticProviderEntry(
    [],
    [combo],
    resolved,
    "https://or.example/v1",
    "sk-test"
  );

  assert.deepEqual(Object.keys(block.models), ["dardcorCode/hermes-smart-stack"]);
  assert.equal(
    block.models["opencode-dardcorCode/hermes-smart-stack"],
    undefined,
    "combo key must not carry the OC-gate-prefixed providerId — it doubles up once " +
      "OC dispatches it verbatim as the `model` field"
  );
});
