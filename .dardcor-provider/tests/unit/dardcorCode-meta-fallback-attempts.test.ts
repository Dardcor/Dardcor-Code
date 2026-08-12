import test from "node:test";
import assert from "node:assert/strict";
import { OMNIROUTE_RESPONSE_HEADERS } from "../../src/shared/constants/headers.ts";
import { buildDardcorCodeResponseMetaHeaders } from "../../src/domain/dardcorCodeResponseMeta.ts";

test("headers constant exposes the fallback-attempts key", () => {
  assert.equal(
    OMNIROUTE_RESPONSE_HEADERS.fallbackAttempts,
    "X-DardcorCode-Fallback-Attempts"
  );
});

test("buildDardcorCodeResponseMetaHeaders emits the fallback-attempts count when > 0", () => {
  const h = buildDardcorCodeResponseMetaHeaders({ model: "gpt", provider: "openai", fallbackAttempts: 2 });
  assert.equal(h["X-DardcorCode-Fallback-Attempts"], "2");
});

test("buildDardcorCodeResponseMetaHeaders omits the header when 0 / absent", () => {
  const none = buildDardcorCodeResponseMetaHeaders({ model: "gpt" });
  assert.equal(none["X-DardcorCode-Fallback-Attempts"], undefined);
  const zero = buildDardcorCodeResponseMetaHeaders({ model: "gpt", fallbackAttempts: 0 });
  assert.equal(zero["X-DardcorCode-Fallback-Attempts"], undefined);
});
