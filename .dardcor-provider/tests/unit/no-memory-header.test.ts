import test from "node:test";
import assert from "node:assert/strict";

// PRD-2026-06-19: per-request opt-out of memory/skills injection via the
// `x-dardcorCode-no-memory` header (mirrors `x-dardcorCode-no-cache`).
const { isNoMemoryRequested, getHeaderValueCaseInsensitive } = await import(
  "../../open-sse/handlers/chatCore/headers.ts"
);

test("isNoMemoryRequested is true for truthy header values (plain object)", () => {
  for (const v of ["true", "1", "yes", "TRUE", "Yes", " true "]) {
    assert.equal(
      isNoMemoryRequested({ "x-dardcorCode-no-memory": v }),
      true,
      `expected true for ${JSON.stringify(v)}`
    );
  }
});

test("isNoMemoryRequested is case-insensitive on the header NAME", () => {
  assert.equal(isNoMemoryRequested({ "X-DardcorCode-No-Memory": "true" }), true);
});

test("isNoMemoryRequested works with a Headers instance", () => {
  const h = new Headers();
  h.set("x-dardcorCode-no-memory", "1");
  assert.equal(isNoMemoryRequested(h), true);
});

test("isNoMemoryRequested is false when the header is absent / empty / falsy", () => {
  assert.equal(isNoMemoryRequested(null), false);
  assert.equal(isNoMemoryRequested(undefined), false);
  assert.equal(isNoMemoryRequested({}), false);
  assert.equal(isNoMemoryRequested({ "x-dardcorCode-no-memory": "" }), false);
  assert.equal(isNoMemoryRequested({ "x-dardcorCode-no-memory": "false" }), false);
  assert.equal(isNoMemoryRequested({ "x-dardcorCode-no-memory": "0" }), false);
  assert.equal(isNoMemoryRequested({ "x-dardcorCode-no-memory": "no" }), false);
});

test("getHeaderValueCaseInsensitive still resolves the header (sanity)", () => {
  assert.equal(
    getHeaderValueCaseInsensitive({ "x-dardcorCode-no-memory": "true" }, "x-dardcorCode-no-memory"),
    "true"
  );
});
