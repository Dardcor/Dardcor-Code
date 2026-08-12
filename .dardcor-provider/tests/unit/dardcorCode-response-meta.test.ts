import test from "node:test";
import assert from "node:assert/strict";

import {
  attachDardcorCodeMetaHeaders,
  buildDardcorCodeResponseMetaHeaders,
  buildDardcorCodeSseMetadataComment,
  formatDardcorCodeCost,
  getDardcorCodeTokenCounts,
} from "../../src/domain/dardcorCodeResponseMeta.ts";
import { APP_CONFIG } from "../../src/shared/constants/appConfig.ts";
import { OMNIROUTE_RESPONSE_HEADERS } from "../../src/shared/constants/headers.ts";

test("getDardcorCodeTokenCounts normalizes common usage shapes", () => {
  assert.deepEqual(
    getDardcorCodeTokenCounts({
      prompt_tokens: 12,
      completion_tokens: 5,
    }),
    { input: 12, output: 5 }
  );
  assert.deepEqual(
    getDardcorCodeTokenCounts({
      input_tokens: "9",
      output_tokens: "4",
    }),
    { input: 9, output: 4 }
  );
});

test("buildDardcorCodeResponseMetaHeaders formats provider alias, tokens, latency, and cost", () => {
  const headers = buildDardcorCodeResponseMetaHeaders({
    provider: "claude",
    model: "claude-sonnet-4-6",
    cacheHit: true,
    latencyMs: 1234.6,
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
    },
    costUsd: 0.00123456789,
  });

  assert.equal(headers["X-DardcorCode-Provider"], "cc");
  assert.equal(headers["X-DardcorCode-Model"], "claude-sonnet-4-6");
  assert.equal(headers["X-DardcorCode-Cache-Hit"], "true");
  assert.equal(headers["X-DardcorCode-Latency-Ms"], "1235");
  assert.equal(headers["X-DardcorCode-Tokens-In"], "11");
  assert.equal(headers["X-DardcorCode-Tokens-Out"], "7");
  assert.equal(headers["X-DardcorCode-Response-Cost"], "0.0012345679");
});

test("buildDardcorCodeResponseMetaHeaders keeps ASCII model header values unchanged", () => {
  const headers = buildDardcorCodeResponseMetaHeaders({
    provider: "openai",
    model: "gpt-4o-mini",
  });

  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.model], "gpt-4o-mini");
});

test("buildDardcorCodeResponseMetaHeaders percent-encodes non-ASCII model header values", () => {
  const model = "free-mix/[假流式]gemini-3.5-flash";
  const headers = buildDardcorCodeResponseMetaHeaders({
    provider: "openai",
    model,
  });

  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.model], encodeURIComponent(model));
  assert.doesNotThrow(() => new Headers(headers));
});

test("buildDardcorCodeResponseMetaHeaders strips control characters from string header values", () => {
  const headers = buildDardcorCodeResponseMetaHeaders({
    provider: "openai",
    model: "free\r\nX-Injected: yes\u0000-model",
    requestId: "req-1\nreq-2\rreq-3\u0007",
  });

  assert.doesNotMatch(headers[OMNIROUTE_RESPONSE_HEADERS.model], /[\r\n\u0000-\u001f\u007f]/);
  assert.doesNotMatch(headers[OMNIROUTE_RESPONSE_HEADERS.requestId], /[\r\n\u0000-\u001f\u007f]/);
  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.model], "freeX-Injected: yes-model");
  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.requestId], "req-1req-2req-3");
  assert.doesNotThrow(() => new Headers(headers));
});

test("buildDardcorCodeResponseMetaHeaders always emits X-DardcorCode-Version", () => {
  const headers = buildDardcorCodeResponseMetaHeaders({ provider: "openai", model: "gpt" });
  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.version], APP_CONFIG.version);

  // Even with no provider/model at all, the version is still attached.
  const bare = buildDardcorCodeResponseMetaHeaders({});
  assert.equal(bare[OMNIROUTE_RESPONSE_HEADERS.version], APP_CONFIG.version);
});

test("buildDardcorCodeResponseMetaHeaders emits X-DardcorCode-Request-Id only when provided", () => {
  const withId = buildDardcorCodeResponseMetaHeaders({ model: "gpt", requestId: "req-123" });
  assert.equal(withId[OMNIROUTE_RESPONSE_HEADERS.requestId], "req-123");

  const noId = buildDardcorCodeResponseMetaHeaders({ model: "gpt" });
  assert.equal(noId[OMNIROUTE_RESPONSE_HEADERS.requestId], undefined);

  const nullId = buildDardcorCodeResponseMetaHeaders({ model: "gpt", requestId: null });
  assert.equal(nullId[OMNIROUTE_RESPONSE_HEADERS.requestId], undefined);

  const blankId = buildDardcorCodeResponseMetaHeaders({ model: "gpt", requestId: "   " });
  assert.equal(blankId[OMNIROUTE_RESPONSE_HEADERS.requestId], undefined);
});

test("attachDardcorCodeMetaHeaders mutates a Headers instance in place, preserving existing entries", () => {
  const headers = new Headers({ "Content-Type": "application/json" });
  attachDardcorCodeMetaHeaders(headers, {
    provider: "openai",
    model: "gpt",
    requestId: "req-abc",
  });

  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get(OMNIROUTE_RESPONSE_HEADERS.version), APP_CONFIG.version);
  assert.equal(headers.get(OMNIROUTE_RESPONSE_HEADERS.requestId), "req-abc");
  assert.equal(headers.get(OMNIROUTE_RESPONSE_HEADERS.model), "gpt");
});

test("attachDardcorCodeMetaHeaders mutates a plain record in place, preserving existing entries", () => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  attachDardcorCodeMetaHeaders(headers, {
    provider: "openai",
    model: "gpt",
  });

  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.version], APP_CONFIG.version);
  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.model], "gpt");
  // No requestId provided → header omitted.
  assert.equal(headers[OMNIROUTE_RESPONSE_HEADERS.requestId], undefined);
});

test("buildDardcorCodeSseMetadataComment emits comment lines compatible with SSE", () => {
  const comment = buildDardcorCodeSseMetadataComment({
    provider: "openai",
    model: "gpt-4o-mini",
    usage: {
      prompt_tokens: 4,
      completion_tokens: 2,
    },
    latencyMs: 50,
    costUsd: formatDardcorCodeCost(0),
  });

  assert.match(comment, /^: x-dardcorCode-cache-hit=false/m);
  assert.match(comment, /^: x-dardcorCode-provider=openai/m);
  assert.match(comment, /^: x-dardcorCode-model=gpt-4o-mini/m);
  assert.match(comment, /^: x-dardcorCode-tokens-in=4/m);
  assert.match(comment, /^: x-dardcorCode-tokens-out=2/m);
  assert.match(comment, /^: x-dardcorCode-response-cost=0\.0000000000/m);
});

test("buildDardcorCodeResponseMetaHeaders emits X-DardcorCode-Cost-Saved only when costSavedUsd is provided", () => {
  // Cache HIT: the incremental cost of serving the hit is 0, but the cache saved the
  // original (would-have-been) cost — surfaced via the Cost-Saved header for analytics.
  const hit = buildDardcorCodeResponseMetaHeaders({
    provider: "openai",
    model: "gpt-4o",
    cacheHit: true,
    costUsd: 0,
    costSavedUsd: 0.0125,
  });
  assert.equal(hit[OMNIROUTE_RESPONSE_HEADERS.responseCost], "0.0000000000");
  assert.equal(hit[OMNIROUTE_RESPONSE_HEADERS.costSaved], "0.0125000000");

  // A normal response (no costSavedUsd) omits the Cost-Saved header entirely.
  const miss = buildDardcorCodeResponseMetaHeaders({
    provider: "openai",
    model: "gpt-4o",
    costUsd: 0.0125,
  });
  assert.equal(miss[OMNIROUTE_RESPONSE_HEADERS.costSaved], undefined);

  // A free-model HIT still emits Cost-Saved (= 0) — it explicitly passed costSavedUsd.
  const freeHit = buildDardcorCodeResponseMetaHeaders({
    cacheHit: true,
    costUsd: 0,
    costSavedUsd: 0,
  });
  assert.equal(freeHit[OMNIROUTE_RESPONSE_HEADERS.costSaved], "0.0000000000");
});

test("attachDardcorCodeMetaHeaders forwards costSavedUsd onto a Headers bag", () => {
  const headers = new Headers({ "Content-Type": "application/json" });
  attachDardcorCodeMetaHeaders(headers, {
    provider: "openai",
    model: "gpt-4o",
    cacheHit: true,
    costUsd: 0,
    costSavedUsd: 0.0125,
  });
  assert.equal(headers.get(OMNIROUTE_RESPONSE_HEADERS.responseCost), "0.0000000000");
  assert.equal(headers.get(OMNIROUTE_RESPONSE_HEADERS.costSaved), "0.0125000000");
});
