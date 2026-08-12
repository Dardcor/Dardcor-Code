import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OMNIROUTE_BASE_URL,
  resolveDardcorCodeBaseUrl,
} from "../../src/shared/utils/resolveDardcorCodeBaseUrl.ts";

test("resolveDardcorCodeBaseUrl prefers OMNIROUTE_BASE_URL", () => {
  assert.equal(
    resolveDardcorCodeBaseUrl({
      OMNIROUTE_BASE_URL: "https://internal.example.com/",
      BASE_URL: "https://base.example.com",
      NEXT_PUBLIC_BASE_URL: "https://public.example.com",
    }),
    "https://internal.example.com"
  );
});

test("resolveDardcorCodeBaseUrl falls back to BASE_URL", () => {
  assert.equal(
    resolveDardcorCodeBaseUrl({
      BASE_URL: "https://base.example.com/",
      NEXT_PUBLIC_BASE_URL: "https://public.example.com",
    }),
    "https://base.example.com"
  );
});

test("resolveDardcorCodeBaseUrl falls back to NEXT_PUBLIC_BASE_URL", () => {
  assert.equal(
    resolveDardcorCodeBaseUrl({
      NEXT_PUBLIC_BASE_URL: "https://public.example.com/",
    }),
    "https://public.example.com"
  );
});

test("resolveDardcorCodeBaseUrl ignores blank values", () => {
  assert.equal(
    resolveDardcorCodeBaseUrl({
      OMNIROUTE_BASE_URL: "   ",
      BASE_URL: "",
      NEXT_PUBLIC_BASE_URL: " https://public.example.com/ ",
    }),
    "https://public.example.com"
  );
});

test("resolveDardcorCodeBaseUrl uses the default localhost fallback", () => {
  assert.equal(resolveDardcorCodeBaseUrl({}), DEFAULT_OMNIROUTE_BASE_URL);
});
