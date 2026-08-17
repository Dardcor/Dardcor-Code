import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createDardcorCodeAuthHook,
  createDardcorCodeConfigHook,
  createDardcorCodeProviderHook,
  parseDardcorCodePluginOptions,
  type DardcorCodeCompressionMetaFetcher,
  type DardcorCodeEnrichmentFetcher,
  type DardcorCodeProvidersFetcher,
  type dardcorCodeRawModelEntry,
} from "../src/index.js";

const BASE_URL = "https://or.example.com/v1";
const API_KEY = "sk-inference-only";
const MANAGEMENT_READ_TOKEN = "sk-management-read-only";

const RAW_MODELS: dardcorCodeRawModelEntry[] = [
  {
    id: "openai/gpt-test",
    context_length: 16_000,
    max_output_tokens: 4_000,
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
];

function apiAuth(key: string) {
  return { type: "api" as const, key };
}

test("options: managementReadToken is accepted and preserved", () => {
  const parsed = parseDardcorCodePluginOptions({ managementReadToken: MANAGEMENT_READ_TOKEN });
  assert.equal(parsed.managementReadToken, MANAGEMENT_READ_TOKEN);
});

test("provider hook: management GET fetchers use managementReadToken while /v1 uses apiKey", async () => {
  const calls: Array<[string, string]> = [];
  const enrichmentFetcher: DardcorCodeEnrichmentFetcher = async (_baseURL, token) => {
    calls.push(["pricing", token]);
    return new Map();
  };
  const compressionMetaFetcher: DardcorCodeCompressionMetaFetcher = async (_baseURL, token) => {
    calls.push(["context", token]);
    return [];
  };
  const providersFetcher: DardcorCodeProvidersFetcher = async (_baseURL, token) => {
    calls.push(["providers", token]);
    return [];
  };

  const hook = createDardcorCodeProviderHook(
    {
      baseURL: BASE_URL,
      managementReadToken: MANAGEMENT_READ_TOKEN,
      features: { compressionMetadata: true, usableOnly: true },
    },
    {
      fetcher: async (_baseURL, token) => {
        calls.push(["models", token]);
        return RAW_MODELS;
      },
      combosFetcher: async (_baseURL, token) => {
        calls.push(["combos", token]);
        return [];
      },
      autoCombosFetcher: async (_baseURL, token) => {
        calls.push(["auto-combos", token]);
        return [];
      },
      enrichmentFetcher,
      compressionMetaFetcher,
      providersFetcher,
    }
  );

  await hook.models!({} as never, { auth: apiAuth(API_KEY) as never });

  assert.deepEqual(calls, [
    ["models", API_KEY],
    ["combos", MANAGEMENT_READ_TOKEN],
    ["auto-combos", MANAGEMENT_READ_TOKEN],
    ["pricing", MANAGEMENT_READ_TOKEN],
    ["context", MANAGEMENT_READ_TOKEN],
    ["providers", MANAGEMENT_READ_TOKEN],
  ]);
});

test("provider hook: absent managementReadToken preserves apiKey fallback", async () => {
  const calls: Array<[string, string]> = [];
  const hook = createDardcorCodeProviderHook(
    { baseURL: BASE_URL, features: { enrichment: false, autoCombos: false } },
    {
      fetcher: async (_baseURL, token) => {
        calls.push(["models", token]);
        return RAW_MODELS;
      },
      combosFetcher: async (_baseURL, token) => {
        calls.push(["combos", token]);
        return [];
      },
    }
  );

  await hook.models!({} as never, { auth: apiAuth(API_KEY) as never });

  assert.deepEqual(calls, [
    ["models", API_KEY],
    ["combos", API_KEY],
  ]);
});

test("config hook: managementReadToken stays out of provider inference and MCP config", async () => {
  const calls: Array<[string, string]> = [];
  const hook = createDardcorCodeConfigHook(
    {
      baseURL: BASE_URL,
      managementReadToken: MANAGEMENT_READ_TOKEN,
      features: { enrichment: false, autoCombos: false, diskCache: false, mcpAutoEmit: true },
    },
    {
      readAuthJson: async () => ({
        "opencode-dardcorCode": { type: "api" as const, key: API_KEY },
      }),
      fetcher: async (_baseURL, token) => {
        calls.push(["models", token]);
        return RAW_MODELS;
      },
      combosFetcher: async (_baseURL, token) => {
        calls.push(["combos", token]);
        return [];
      },
      logger: { warn: () => {} },
    }
  );
  const input: { provider?: Record<string, any>; mcp?: Record<string, any> } = {};

  await hook(input as never);

  assert.deepEqual(calls, [
    ["models", API_KEY],
    ["combos", MANAGEMENT_READ_TOKEN],
  ]);
  assert.equal(input.provider?.["opencode-dardcorCode"]?.options?.apiKey, API_KEY);
  assert.equal(
    input.mcp?.["opencode-dardcorCode"]?.headers?.Authorization,
    `Bearer ${API_KEY}`,
    "mcpAutoEmit remains independent of managementReadToken"
  );
});

test("auth fetch: only intended same-origin inference paths receive apiKey", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response("ok");
  }) as typeof fetch;

  try {
    const hook = createDardcorCodeAuthHook({
      baseURL: `${BASE_URL}/`,
      managementReadToken: MANAGEMENT_READ_TOKEN,
    });
    const loaded = await hook.loader!(async () => apiAuth(API_KEY) as never, {} as never);
    const interceptedFetch = (loaded as { fetch: typeof fetch }).fetch;

    const streamingBody = '{"stream":true}';
    await interceptedFetch(`${BASE_URL}/chat/completions?trace=1`, {
      method: "POST",
      body: streamingBody,
      headers: { Accept: "text/event-stream" },
    });
    await interceptedFetch(`${BASE_URL}/models/?refresh=1`);
    await interceptedFetch("https://or.example.com/api/combos");
    await interceptedFetch("https://or.example.com/api/mcp/stream");
    await interceptedFetch("https://or.example.com/v1/embeddings");
    await interceptedFetch("https://third-party.example/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });

    const headers = calls.map(({ init }) => new Headers(init?.headers));
    assert.equal(headers[0]?.get("Authorization"), `Bearer ${API_KEY}`);
    assert.equal(headers[1]?.get("Authorization"), `Bearer ${API_KEY}`);
    for (const index of [2, 3, 4, 5]) {
      assert.equal(headers[index]?.get("Authorization"), null);
    }
    assert.equal(calls[0]?.input, `${BASE_URL}/chat/completions?trace=1`);
    assert.equal(calls[0]?.init?.body, streamingBody);
    assert.equal(headers[0]?.get("Accept"), "text/event-stream");
    assert.equal(
      calls.some(({ init }) =>
        [...new Headers(init?.headers).values()].some((value) =>
          value.includes(MANAGEMENT_READ_TOKEN)
        )
      ),
      false,
      "managementReadToken must never enter inference fetch headers"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("disk cache: snapshot written under management token A is rejected under token B", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dardcorCode-token-snapshot-"));
  const previousDataDir = process.env.OPENCODE_DATA_DIR;
  process.env.OPENCODE_DATA_DIR = tmp;

  try {
    const commonDeps = {
      readAuthJson: async () => ({
        "opencode-dardcorCode": {
          type: "api" as const,
          key: API_KEY,
          baseURL: BASE_URL,
        },
      }),
      combosFetcher: async () => [],
      logger: { warn: () => {} },
    };
    const features = {
      enrichment: false,
      autoCombos: false,
      diskCache: true,
    } as const;

    const tokenAHook = createDardcorCodeConfigHook(
      { managementReadToken: "token-A", features },
      {
        ...commonDeps,
        fetcher: async () => RAW_MODELS,
      }
    );
    await tokenAHook({} as never);

    const tokenBHook = createDardcorCodeConfigHook(
      { managementReadToken: "token-B", features },
      {
        ...commonDeps,
        fetcher: async () => {
          throw new Error("offline");
        },
      }
    );
    const input: { provider?: Record<string, { models: Record<string, unknown> }> } = {};
    await tokenBHook(input as never);

    assert.deepEqual(
      input.provider?.["opencode-dardcorCode"]?.models,
      {},
      "catalog from token A must not hydrate after switching to token B"
    );
  } finally {
    if (previousDataDir === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = previousDataDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
