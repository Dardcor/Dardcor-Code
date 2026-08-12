/**
 * T-05 combo-discovery contract tests.
 *
 * Covers:
 *   - `defaultDardcorCodeCombosFetcher(baseURL, apiKey, timeoutMs?)`
 *     — envelope tolerance (`{combos: [...]}` and bare array), non-2xx errors.
 *   - `mapComboToModelV2(combo, members, providerId, baseURL)`
 *     — LCD policy across capabilities, limits, modalities; defensive
 *       posture on empty members; nice-name preference.
 *   - `createDardcorCodeProviderHook(opts, deps)` extension
 *     — combos merged into the models map; collision resolution (combo
 *       wins, warn-once); soft-fail when the combos fetcher throws;
 *       combos cached + reused under the same TTL key as models.
 *
 * Mocking strategy mirrors `provider.test.ts`: both fetchers are
 * dependency-injected at hook construction, no `fetch` monkey-patch.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createDardcorCodeProviderHook,
  defaultDardcorCodeCombosFetcher,
  mapComboToModelV2,
  type DardcorCodeCombosFetcher,
  type DardcorCodeModelsFetcher,
  type dardcorCodeRawCombo,
  type dardcorCodeRawModelEntry,
} from "../src/index.js";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const MODEL_PRIMARY: dardcorCodeRawModelEntry = {
  id: "claude-primary",
  capabilities: {
    tool_calling: true,
    reasoning: true,
    vision: true,
    thinking: true,
    temperature: true,
  },
  context_length: 200_000,
  max_output_tokens: 64_000,
  max_input_tokens: 180_000,
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
};

const MODEL_SECONDARY: dardcorCodeRawModelEntry = {
  id: "claude-secondary",
  capabilities: {
    tool_calling: true,
    reasoning: false,
    vision: true,
    thinking: false,
    temperature: true,
  },
  context_length: 100_000,
  max_output_tokens: 32_000,
  max_input_tokens: 96_000,
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
};

const MODEL_NO_TOOLS: dardcorCodeRawModelEntry = {
  id: "gemini-3-flash",
  capabilities: { tool_calling: false, reasoning: false, vision: false, thinking: false },
  context_length: 1_000_000,
  max_output_tokens: 8_192,
  input_modalities: ["text"],
  output_modalities: ["text"],
};

const COMBO_CLAUDE_TIER: dardcorCodeRawCombo = {
  id: "combo-claude-tier",
  name: "Claude Tier",
  strategy: "priority",
  models: [
    { id: "s1", kind: "model", model: "claude-primary", weight: 100 },
    { id: "s2", kind: "model", model: "claude-secondary", weight: 80 },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function stubModelsFetcher(
  payload: dardcorCodeRawModelEntry[]
): DardcorCodeModelsFetcher & { callCount: () => number } {
  let n = 0;
  const f: DardcorCodeModelsFetcher = async () => {
    n++;
    return payload;
  };
  return Object.assign(f, { callCount: () => n });
}

function stubCombosFetcher(
  payload: dardcorCodeRawCombo[]
): DardcorCodeCombosFetcher & { callCount: () => number; callsBy: () => Array<[string, string]> } {
  let n = 0;
  const calls: Array<[string, string]> = [];
  const f: DardcorCodeCombosFetcher = async (baseURL, apiKey) => {
    n++;
    calls.push([baseURL, apiKey]);
    return payload;
  };
  return Object.assign(f, {
    callCount: () => n,
    callsBy: () => calls,
  });
}

function failingCombosFetcher(
  err = new Error("boom")
): DardcorCodeCombosFetcher & { callCount: () => number } {
  let n = 0;
  const f: DardcorCodeCombosFetcher = async () => {
    n++;
    throw err;
  };
  return Object.assign(f, { callCount: () => n });
}

const apiAuth = (key: string): unknown => ({ type: "api", key });

// Capture console.warn invocations for the duration of a callback, then
// restore the original. Needed because the collision + soft-fail paths
// emit warnings we want to assert on.
async function withWarnCapture<T>(
  fn: (warnings: Array<{ args: unknown[] }>) => Promise<T>
): Promise<{ result: T; warnings: Array<{ args: unknown[] }> }> {
  const original = console.warn;
  const warnings: Array<{ args: unknown[] }> = [];
  console.warn = (...args: unknown[]) => {
    warnings.push({ args });
  };
  try {
    const result = await fn(warnings);
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// defaultDardcorCodeCombosFetcher — envelope tolerance + error surfacing
// ────────────────────────────────────────────────────────────────────────────

test("defaultDardcorCodeCombosFetcher: parses {combos:[…]} envelope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    assert.equal(url, "https://or.example.com/api/combos");
    return new Response(
      JSON.stringify({
        combos: [
          { id: "c1", name: "Combo One", strategy: "priority", models: [] },
          { id: "c2", name: "Combo Two", strategy: "weighted", models: [] },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const combos = await defaultDardcorCodeCombosFetcher("https://or.example.com", "sk-test");
    assert.equal(combos.length, 2);
    assert.equal(combos[0].id, "c1");
    assert.equal(combos[1].id, "c2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("defaultDardcorCodeCombosFetcher: parses bare array envelope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify([{ id: "c1" }, { id: "c2" }, { not_an_id: 42 }]), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    const combos = await defaultDardcorCodeCombosFetcher("https://or.example.com/v1", "sk-test");
    // Strip /v1 before /api/combos, AND filter out entries with no string id.
    assert.equal(combos.length, 2);
    assert.equal(combos[0].id, "c1");
    assert.equal(combos[1].id, "c2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("defaultDardcorCodeCombosFetcher: strips trailing /v1 before /api/combos", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  globalThis.fetch = (async (input: unknown) => {
    observedUrl = typeof input === "string" ? input : (input as { url: string }).url;
    return new Response(JSON.stringify({ combos: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    await defaultDardcorCodeCombosFetcher("https://or.example.com/v1/", "sk-test");
    assert.equal(observedUrl, "https://or.example.com/api/combos");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("defaultDardcorCodeCombosFetcher: throws on non-2xx with status code in message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 403,
      statusText: "Forbidden",
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      async () => {
        await defaultDardcorCodeCombosFetcher("https://or.example.com", "sk-bad");
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /403/, "status code must appear in message");
        assert.match(msg, /\/api\/combos/, "url must appear in message");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("defaultDardcorCodeCombosFetcher: throws when apiKey missing", async () => {
  await assert.rejects(
    async () => defaultDardcorCodeCombosFetcher("https://or.example.com", ""),
    /apiKey required/
  );
});

test("defaultDardcorCodeCombosFetcher: throws when baseURL missing", async () => {
  await assert.rejects(
    async () => defaultDardcorCodeCombosFetcher("", "sk-test"),
    /baseURL required/
  );
});

// ────────────────────────────────────────────────────────────────────────────
// mapComboToModelV2 — LCD semantics
// ────────────────────────────────────────────────────────────────────────────

test("mapComboToModelV2: empty members → capabilities all false (defensive)", () => {
  const m = mapComboToModelV2(
    { id: "combo-empty", name: "Empty Combo" },
    [],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m.id, "combo-empty");
  assert.equal(m.name, "Empty Combo");
  assert.equal(m.capabilities.temperature, false);
  assert.equal(m.capabilities.reasoning, false);
  assert.equal(m.capabilities.attachment, false);
  assert.equal(m.capabilities.toolcall, false);
  assert.equal(m.capabilities.input.text, false);
  assert.equal(m.capabilities.output.text, false);
  assert.equal(m.limit.context, 0);
  assert.equal(m.limit.output, 0);
  assert.equal(m.limit.input, undefined);
  assert.deepEqual(m.cost, { input: 0, output: 0, cache: { read: 0, write: 0 } });
});

test("mapComboToModelV2: all members reasoning=true → combo reasoning=true", () => {
  const m = mapComboToModelV2(
    { id: "c", models: [] },
    [
      MODEL_PRIMARY,
      {
        ...MODEL_PRIMARY,
        id: "p2",
        capabilities: { ...MODEL_PRIMARY.capabilities, thinking: false, reasoning: true },
      },
    ],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m.capabilities.reasoning, true);
});

test("mapComboToModelV2: any member reasoning=false → combo reasoning=false", () => {
  const m = mapComboToModelV2(
    { id: "c", models: [] },
    [MODEL_PRIMARY, MODEL_NO_TOOLS], // gemini-3-flash has reasoning:false, thinking:false
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m.capabilities.reasoning, false);
});

test("mapComboToModelV2: limit.context is min of members'", () => {
  const m = mapComboToModelV2(
    { id: "c", models: [] },
    [MODEL_PRIMARY, MODEL_SECONDARY, MODEL_NO_TOOLS],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  // min(200_000, 100_000, 1_000_000) = 100_000
  assert.equal(m.limit.context, 100_000);
  // min(64_000, 32_000, 8_192) = 8_192
  assert.equal(m.limit.output, 8_192);
});

test("mapComboToModelV2: limit.input only emitted when EVERY member declares one", () => {
  const m1 = mapComboToModelV2(
    { id: "c", models: [] },
    [MODEL_PRIMARY, MODEL_SECONDARY],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  // Both declare max_input_tokens → limit.input = min(180000, 96000)
  assert.equal(m1.limit.input, 96_000);

  const m2 = mapComboToModelV2(
    { id: "c", models: [] },
    [MODEL_PRIMARY, MODEL_NO_TOOLS], // gemini-3-flash doesn't declare max_input_tokens
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m2.limit.input, undefined);
});

test("mapComboToModelV2: nice name preferred from combo.name", () => {
  const m1 = mapComboToModelV2(
    { id: "combo-x", name: "Pretty Name" },
    [MODEL_PRIMARY],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m1.name, "Pretty Name");

  // Falls back to id when name is absent or empty.
  const m2 = mapComboToModelV2(
    { id: "combo-y" },
    [MODEL_PRIMARY],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m2.name, "combo-y");

  const m3 = mapComboToModelV2(
    { id: "combo-z", name: "   " },
    [MODEL_PRIMARY],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m3.name, "combo-z");
});

test("mapComboToModelV2: attachment AND vision flag both honored across members", () => {
  // MODEL_PRIMARY: vision=true; MODEL_SECONDARY: vision=true → combo attachment=true
  const yes = mapComboToModelV2(
    { id: "c1", models: [] },
    [MODEL_PRIMARY, MODEL_SECONDARY],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(yes.capabilities.attachment, true);

  // Add a member with no vision/attachment → AND collapses to false
  const no = mapComboToModelV2(
    { id: "c2", models: [] },
    [MODEL_PRIMARY, MODEL_NO_TOOLS],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(no.capabilities.attachment, false);
});

test("mapComboToModelV2: modalities AND'd across members", () => {
  const m = mapComboToModelV2(
    { id: "c", models: [] },
    [MODEL_PRIMARY, MODEL_SECONDARY], // both have text+image
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m.capabilities.input.text, true);
  assert.equal(m.capabilities.input.image, true);
  assert.equal(m.capabilities.input.audio, false);

  // Add a text-only member → image collapses to false.
  const m2 = mapComboToModelV2(
    { id: "c", models: [] },
    [MODEL_PRIMARY, MODEL_NO_TOOLS],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m2.capabilities.input.text, true);
  assert.equal(m2.capabilities.input.image, false);
});

test("mapComboToModelV2: api block matches providerId + baseURL", () => {
  const m = mapComboToModelV2(
    { id: "c" },
    [MODEL_PRIMARY],
    "dardcorCode-preprod",
    "https://or-preprod.example.com/v1"
  );
  assert.equal(m.providerID, "dardcorCode-preprod");
  assert.equal(m.api.id, "openai-compatible");
  assert.equal(m.api.url, "https://or-preprod.example.com/v1");
  assert.equal(m.api.npm, "@ai-sdk/openai-compatible");
  assert.equal(m.status, "active");
});

test("mapComboToModelV2: explicit member temperature=false drops combo temperature=false", () => {
  const tempFalse: dardcorCodeRawModelEntry = {
    id: "no-temp",
    capabilities: { tool_calling: true, temperature: false },
    context_length: 100_000,
    max_output_tokens: 8_000,
    input_modalities: ["text"],
    output_modalities: ["text"],
  };
  const m = mapComboToModelV2(
    { id: "c" },
    [MODEL_PRIMARY, tempFalse],
    "dardcorCode",
    "https://or.example.com/v1"
  );
  assert.equal(m.capabilities.temperature, false);
});

// ────────────────────────────────────────────────────────────────────────────
// createDardcorCodeProviderHook — combos merge + collision + soft-fail + cache
// ────────────────────────────────────────────────────────────────────────────

test("models() returns combo entries merged into the map", async () => {
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY, MODEL_SECONDARY, MODEL_NO_TOOLS]);
  const combosFetcher = stubCombosFetcher([COMBO_CLAUDE_TIER]);
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    { fetcher: modelsFetcher, combosFetcher }
  );
  const out = await hook.models!({} as never, { auth: apiAuth("sk-z") as never });

  // 3 raw models + 1 combo = 4 entries
  assert.equal(Object.keys(out).length, 4);
  assert.ok(out["dardcorCode/claude-primary"]);
  assert.ok(out["dardcorCode/claude-secondary"]);
  assert.ok(out["dardcorCode/gemini-3-flash"]);
  assert.ok(out["dardcorCode/claude-tier"]);

  const combo = out["dardcorCode/claude-tier"];
  assert.equal(combo.name, "Claude Tier");
  assert.equal(combo.providerID, "dardcorCode");
  // LCD over claude-primary (200k, reasoning) + claude-secondary (100k, no reasoning)
  assert.equal(combo.limit.context, 100_000);
  assert.equal(combo.capabilities.reasoning, false);
  assert.equal(combo.capabilities.toolcall, true);
});

test("models(): combo with unknown member ids degrades to all-false LCD posture", async () => {
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY]); // catalog only has claude-primary
  const combosFetcher = stubCombosFetcher([
    {
      id: "phantom",
      name: "Phantom Combo",
      models: [
        { id: "s1", kind: "model", model: "does-not-exist-1", weight: 50 },
        { id: "s2", kind: "model", model: "does-not-exist-2", weight: 50 },
      ],
    },
  ]);
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    { fetcher: modelsFetcher, combosFetcher }
  );
  const out = await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  assert.ok(out["dardcorCode/phantom-combo"]);
  // With zero resolvable members, LCD = all-false (defensive posture).
  assert.equal(out["dardcorCode/phantom-combo"].capabilities.toolcall, false);
  assert.equal(out["dardcorCode/phantom-combo"].capabilities.reasoning, false);
  assert.equal(out["dardcorCode/phantom-combo"].limit.context, 0);
});

test("models(): hidden combos are excluded from the map", async () => {
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY]);
  const combosFetcher = stubCombosFetcher([
    {
      id: "visible",
      name: "Visible",
      models: [{ id: "s1", kind: "model", model: "claude-primary", weight: 100 }],
    },
    {
      id: "hidden",
      name: "Hidden",
      isHidden: true,
      models: [{ id: "s1", kind: "model", model: "claude-primary", weight: 100 }],
    },
  ]);
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    { fetcher: modelsFetcher, combosFetcher }
  );
  const out = await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  assert.ok(out["dardcorCode/visible"]);
  assert.ok(!out["dardcorCode/hidden"], "hidden combo must be omitted");
});

test("models(): combo name exactly matches raw model id → raw deleted, raw deleted, no warn", async () => {
  // Combo.name === raw model id triggers the dedup deletion. This mirrors
  // the real DardcorCode payload where /v1/models pre-mirrors combos as
  // no-slash raw entries whose ids match /api/combos friendly names.
  const colliderCombo: dardcorCodeRawCombo = {
    id: "uuid-collider",
    name: "claude-primary", // EXACT match to MODEL_PRIMARY.id
    models: [{ id: "s1", kind: "model", model: "claude-secondary", weight: 100 }],
  };
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY, MODEL_SECONDARY]);
  const combosFetcher = stubCombosFetcher([colliderCombo]);
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    { fetcher: modelsFetcher, combosFetcher }
  );

  const { result: out, warnings } = await withWarnCapture(async (_w) => {
    return hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  });

  // Raw model replaced by combo of the same key; combo now lives at the bare slug.
  assert.ok(out["dardcorCode/claude-primary"], "combo surfaces under prefixed key");
  assert.equal(out["dardcorCode/claude-primary"].name, "claude-primary");

  // No collision warning fires — dedup makes keys disjoint.
  const collisionWarns = warnings.filter((w) => {
    const msg = w.args[0];
    return typeof msg === "string" && msg.includes("collides");
  });
  assert.equal(collisionWarns.length, 0, "no collision warn after dedup");
});

test("models(): two combos with same slug → second gets disambiguator suffix", async () => {
  // Both combos slug to `claude` — second must get `claude-<id-prefix>`.
  const combos: dardcorCodeRawCombo[] = [
    {
      id: "uuid-a",
      name: "Claude",
      models: [{ id: "s", kind: "model", model: "claude-primary", weight: 1 }],
    },
    {
      id: "uuid-b",
      name: "Claude",
      models: [{ id: "s", kind: "model", model: "claude-secondary", weight: 1 }],
    },
  ];
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    {
      fetcher: stubModelsFetcher([MODEL_PRIMARY, MODEL_SECONDARY]),
      combosFetcher: stubCombosFetcher(combos),
    }
  );

  const out = await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  // First combo gets the bare slug; second gets disambiguated.
  assert.ok(out["dardcorCode/claude"], "first combo at prefixed slug");
  assert.ok(out["dardcorCode/claude-uuid"], "second combo disambiguated by id prefix");
});

test("models(): combos fetch fails → falls back to models-only, warn emitted, no throw", async () => {
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY, MODEL_SECONDARY]);
  const combosFetcher = failingCombosFetcher(new Error("ECONNRESET"));
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    { fetcher: modelsFetcher, combosFetcher }
  );

  const { result: out, warnings } = await withWarnCapture(async () => {
    return hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  });

  // Catalog includes the models but NOT any combo entries.
  assert.equal(Object.keys(out).length, 2);
  assert.ok(out["dardcorCode/claude-primary"]);
  assert.ok(out["dardcorCode/claude-secondary"]);

  // Soft-fail warning surfaced.
  const softFail = warnings.find((w) => {
    const msg = w.args[0];
    return typeof msg === "string" && msg.includes("combos fetch failed");
  });
  assert.ok(softFail, "soft-fail warning must be emitted on combos fetch error");
  assert.equal(combosFetcher.callCount(), 1);
});

test("models(): combos cached + reused within TTL (one combo fetch per TTL window)", async () => {
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY, MODEL_SECONDARY]);
  const combosFetcher = stubCombosFetcher([COMBO_CLAUDE_TIER]);
  let nowMs = 1_000_000;
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1", modelCacheTtl: 60_000 },
    { fetcher: modelsFetcher, combosFetcher, now: () => nowMs }
  );

  await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  nowMs += 30_000; // half the TTL
  const second = await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  assert.equal(combosFetcher.callCount(), 1, "combos fetched only once within TTL");
  assert.equal(modelsFetcher.callCount(), 1, "models fetched only once within TTL");
  assert.ok(second["dardcorCode/claude-tier"]);
});

test("models(): combos refetched after TTL expiry (same key as models)", async () => {
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY]);
  const combosFetcher = stubCombosFetcher([COMBO_CLAUDE_TIER]);
  let nowMs = 1_000_000;
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1", modelCacheTtl: 60_000 },
    { fetcher: modelsFetcher, combosFetcher, now: () => nowMs }
  );

  await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  nowMs += 60_001;
  await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  assert.equal(combosFetcher.callCount(), 2, "combos must refetch past TTL");
  assert.equal(modelsFetcher.callCount(), 2, "models must refetch past TTL");
});

test("models(): combos fetcher receives the resolved baseURL + apiKey", async () => {
  const modelsFetcher = stubModelsFetcher([MODEL_PRIMARY]);
  const combosFetcher = stubCombosFetcher([COMBO_CLAUDE_TIER]);
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    { fetcher: modelsFetcher, combosFetcher }
  );
  await hook.models!({} as never, { auth: apiAuth("sk-spy") as never });
  assert.deepEqual(combosFetcher.callsBy()[0], ["https://or.example.com/v1", "sk-spy"]);
});

test("models(): nested combo-ref context is the min of nested + raw members", async () => {
  // Top-level combo MASTER-LIGHT has 1 raw model (claude-primary, 200k)
  // and 2 combo-refs: OldLLM (8k member) and KIRO (32k member). The OLD
  // plugin would advertise 200k (only the raw model); the fix should
  // make it advertise 8k (the bottleneck across the member graph).
  const modelsFetcher = stubModelsFetcher([
    MODEL_PRIMARY,
    {
      id: "oldllm-member-1",
      context_length: 8_000,
      max_output_tokens: 4_000,
      capabilities: {
        tool_calling: false,
        reasoning: false,
        vision: false,
        thinking: false,
        temperature: true,
      },
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
    {
      id: "kiro-member-1",
      context_length: 32_000,
      max_output_tokens: 8_000,
      capabilities: {
        tool_calling: true,
        reasoning: false,
        vision: false,
        thinking: false,
        temperature: true,
      },
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
  ]);
  const combosFetcher = stubCombosFetcher([
    {
      id: "oldllm",
      name: "OldLLM",
      models: [{ id: "s1", kind: "model", model: "oldllm-member-1", weight: 100 }],
    },
    {
      id: "kiro",
      name: "KIRO",
      models: [{ id: "s1", kind: "model", model: "kiro-member-1", weight: 100 }],
    },
    {
      id: "master-light",
      name: "MASTER-LIGHT",
      models: [
        { id: "r1", kind: "model", model: "claude-primary", weight: 50 },
        { id: "r2", kind: "combo-ref", comboName: "OldLLM", weight: 25 },
        { id: "r3", kind: "combo-ref", comboName: "KIRO", weight: 25 },
      ],
    },
  ]);
  const hook = createDardcorCodeProviderHook(
    { baseURL: "https://or.example.com/v1" },
    { fetcher: modelsFetcher, combosFetcher }
  );
  const out = await hook.models!({} as never, { auth: apiAuth("sk-z") as never });
  const masterLight = out["dardcorCode/master-light"];
  assert.ok(masterLight, "MASTER-LIGHT entry must exist");
  assert.equal(
    masterLight.limit.context,
    8_000,
    `expected 8_000 (OldLLM bottleneck), got ${masterLight.limit.context}`
  );
});
