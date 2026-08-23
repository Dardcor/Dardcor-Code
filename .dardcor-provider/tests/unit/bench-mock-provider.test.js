/**
 * tests/unit/bench-mock-provider.test.js — Phase 9 focused unit test for the
 * deterministic mock provider (bench/mockProvider.js) and the static bench
 * contracts it serves (fixtures + config matrix).
 *
 * Written but intentionally NOT run in this phase; the runner executes it.
 * No network is touched anywhere: the mock provider is exercised directly
 * through its own `fetch`, and the fixtures/matrix are only parsed and
 * shape-checked.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { encode } from "gpt-tokenizer/encoding/o200k_base";

import { MockProvider, MOCK_PROVIDER_FIXED_CREATED } from "../../bench/mockProvider.js";

const CHAT_URL = "http://mock.test/v1/chat/completions";

// ~2000+ tokens of stable prefix material, so the mock's cache breakpoints
// (64/256/1024) all apply.
const LONG_SYSTEM =
  "deterministic fixture text with stable prefix content " +
  "deterministic fixture text with stable prefix content ".repeat(120).trim();

function makeBody(overrides = {}) {
  return {
    model: "mock/gpt-5-mini",
    temperature: 0,
    messages: [
      { role: "system", content: LONG_SYSTEM },
      { role: "user", content: "Explain the refactor plan in one sentence." },
    ],
    ...overrides,
  };
}

async function post(provider, body) {
  return provider.fetch(CHAT_URL, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("bench/mockProvider.js", () => {
  it("serves a non-stream OpenAI chat.completion JSON response", async () => {
    const provider = new MockProvider();
    const res = await post(provider, makeBody());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const json = await res.json();
    expect(json.object).toBe("chat.completion");
    expect(json.model).toBe("mock/gpt-5-mini");
    expect(json.choices[0].message.role).toBe("assistant");
    expect(typeof json.choices[0].message.content).toBe("string");
    expect(json.choices[0].finish_reason).toBe("stop");
    expect(json.created).toBe(MOCK_PROVIDER_FIXED_CREATED);
  });

  it("reports deterministic usage incl. cache read/creation tokens", async () => {
    const provider = new MockProvider();
    const json = await (await post(provider, makeBody())).json();
    const usage = json.usage;

    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBeGreaterThan(0);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
    expect(usage.cache_read_input_tokens).toBe(0); // cold instance
    expect(usage.cache_creation_input_tokens).toBe(usage.prompt_tokens); // whole prefix written
    expect(usage.prompt_tokens_details.cached_tokens).toBe(0);

    // Real BPE counts, not estimates.
    expect(usage.prompt_tokens).toBe(encode(JSON.stringify(makeBody().messages)).length);
  });

  it("returns identical content for identical requests (determinism)", async () => {
    const provider = new MockProvider();
    const a = await (await post(provider, makeBody())).json();
    const b = await (await post(provider, makeBody())).json();

    expect(a.choices[0].message.content).toBe(b.choices[0].message.content);
    expect(a.id).toBe(b.id);
    expect(a.usage.prompt_tokens).toBe(b.usage.prompt_tokens);
  });

  it("bills a previously-seen prefix as cache read on the second request", async () => {
    const provider = new MockProvider();
    const first = await (await post(provider, makeBody())).json();
    const second = await (await post(provider, makeBody())).json();

    expect(first.usage.cache_read_input_tokens).toBe(0);
    expect(second.usage.cache_read_input_tokens).toBeGreaterThan(0);
    // The identical repeat reads the longest stored breakpoint prefix and only
    // rewrites nothing new beyond it.
    expect(second.usage.cache_creation_input_tokens).toBe(
      second.usage.prompt_tokens - second.usage.cache_read_input_tokens
    );
    expect(second.usage.prompt_tokens_details.cached_tokens).toBe(
      second.usage.cache_read_input_tokens
    );
  });

  it("never bills prefixes shorter than the configured breakpoint minimum", async () => {
    const provider = new MockProvider({ minCacheBreakpointTokens: 1_000_000 });
    await post(provider, makeBody());
    const second = await (await post(provider, makeBody())).json();

    expect(second.usage.cache_read_input_tokens).toBe(0);
  });

  it("streams SSE when body.stream is true, reconstructing the non-stream content", async () => {
    const provider = new MockProvider();
    const plain = await (await post(provider, makeBody())).json();
    const streamRes = await post(provider, makeBody({ stream: true, stream_options: { include_usage: true } }));

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const text = await streamRes.text();
    expect(text).toContain('data: {"id"');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);

    // Transport flags are excluded from the fingerprint, so streamed deltas
    // reconstruct byte-identical content to the non-stream response.
    const content = [...text.matchAll(/"delta":\{"content":"([^"]*)"/g)]
      .map((m) => m[1])
      .join("");
    expect(content).toBe(plain.choices[0].message.content);

    // Usage rides the terminal chunk only when explicitly requested.
    const withUsage = [...text.matchAll(/data: (\{.*\})/g)].map((m) => JSON.parse(m[1]));
    const finalChunk = withUsage[withUsage.length - 1];
    expect(finalChunk.choices[0].finish_reason).toBe("stop");
    expect(finalChunk.usage.prompt_tokens).toBeGreaterThan(0);

    const noUsageRes = await post(provider, makeBody({ stream: true }));
    const noUsageText = await noUsageRes.text();
    expect(noUsageText).not.toContain('"usage"');
  });

  it("isolates instances: identical requests on separate providers are both cold", async () => {
    const a = new MockProvider();
    const b = new MockProvider();

    const ra = await (await post(a, makeBody())).json();
    const rb = await (await post(b, makeBody())).json();

    expect(ra.usage.cache_read_input_tokens).toBe(0);
    expect(rb.usage.cache_read_input_tokens).toBe(0);
    expect(a.requestCount).toBe(1);
    expect(b.requestCount).toBe(1);
  });

  it("exposes per-instance totals and a request history", async () => {
    const provider = new MockProvider();
    await post(provider, makeBody());
    await post(provider, makeBody());

    const last = provider.history[provider.history.length - 1];
    expect(provider.requestCount).toBe(2);
    expect(provider.history).toHaveLength(2);
    expect(provider.totalPromptTokens).toBe(
      provider.history.reduce((s, h) => s + h.usage.prompt_tokens, 0)
    );
    expect(provider.totalCompletionTokens).toBeGreaterThan(0);
    expect(provider.totalCacheReadTokens).toBeGreaterThan(0);
    expect(provider.totalCacheCreationTokens).toBeGreaterThan(0);
    expect(last.stream).toBe(false);
    expect(last.model).toBe("mock/gpt-5-mini");
  });

  it("createFetch returns a usable fetch-style function", async () => {
    const provider = new MockProvider();
    const fetchFn = provider.createFetch();
    const res = await fetchFn(CHAT_URL, {
      method: "POST",
      body: JSON.stringify(makeBody()),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).object).toBe("chat.completion");
  });

  it("rejects non-chat-completions requests and malformed bodies", async () => {
    const provider = new MockProvider();

    const getRes = await provider.fetch(CHAT_URL, { method: "GET" });
    expect(getRes.status).toBe(404);

    const wrongPath = await provider.fetch("http://mock.test/v1/models", { method: "GET" });
    expect(wrongPath.status).toBe(404);

    const badJson = await provider.fetch(CHAT_URL, { method: "POST", body: "{not json" });
    expect(badJson.status).toBe(400);

    const noMessages = await provider.fetch(CHAT_URL, {
      method: "POST",
      body: JSON.stringify({ model: "mock/gpt-5-mini" }),
    });
    expect(noMessages.status).toBe(400);
  });
});

describe("bench static contracts (fixtures + matrix)", () => {
  const FIXTURE_IDS = ["tool-heavy-refactor", "large-file-read", "multi-turn-session", "cache-integrity"];

  it("fixtures parse as valid JSON with a replayable turn contract", () => {
    for (const id of FIXTURE_IDS) {
      const fixture = JSON.parse(
        readFileSync(new URL(`../../bench/fixtures/${id}.json`, import.meta.url), "utf8")
      );
      expect(fixture.schema).toBe("miaw-bench-fixture/1");
      expect(fixture.id).toBe(id);
      expect(Array.isArray(fixture.turns)).toBe(true);
      expect(fixture.turns.length).toBeGreaterThan(1);
      for (const turn of fixture.turns) {
        expect(turn.request.messages.length).toBeGreaterThan(0);
        for (const message of turn.request.messages) {
          expect(["system", "user", "assistant", "tool"]).toContain(message.role);
        }
      }
      // Recorded sessions resend the full history, so each turn's message
      // list must be at least as long as the previous turn's.
      for (let i = 1; i < fixture.turns.length; i++) {
        expect(fixture.turns[i].request.messages.length).toBeGreaterThanOrEqual(
          fixture.turns[i - 1].request.messages.length
        );
      }
    }
  });

  it("matrix configs reference only settings knobs and strategies that exist", () => {
    const matrix = JSON.parse(
      readFileSync(new URL("../../bench/matrix.json", import.meta.url), "utf8")
    );
    expect(matrix.schema).toBe("miaw-bench-matrix/1");

    const strategies = Object.keys(matrix.dimensions.routingStrategies);
    const configIds = new Set(matrix.configs.map((c) => c.id));

    for (const config of matrix.configs) {
      expect(strategies).toContain(config.settings.comboStrategy);
      // Every knob in a config must be a real settingsRepo setting name.
      for (const key of Object.keys(config.settings)) {
        expect(
          ["cacheL1Enabled", "cacheL2Enabled", "cacheL3Enabled", "semanticCacheThreshold",
            "cacheL3MinChars", "rtkEnabled", "cavemanEnabled", "cavemanLevel",
            "ponytailEnabled", "ponytailLevel", "comboStrategy"],
          `${config.id} has unknown setting ${key}`
        ).toContain(key);
      }
    }

    // Every run references a defined config and a defined fixture, and the
    // L0-L3 individually/all-off/all-on coverage is present by construction.
    for (const run of matrix.runs) {
      expect(configIds).toContain(run.config);
      expect(FIXTURE_IDS).toContain(run.fixture);
    }
    for (const required of ["all-off", "all-on", "l0-only", "l1-only", "l2-only", "l3-only"]) {
      expect(configIds).toContain(required);
    }
  });
});
