import test from "node:test";
import assert from "node:assert/strict";
import { renameProcessTitle } from "../../src/instrumentation-node";

test("renameProcessTitle renames a bare 'next-server' title to 'dardcorCode'", () => {
  assert.equal(renameProcessTitle("next-server"), "dardcorCode");
});

test("renameProcessTitle preserves a version suffix after 'next-server'", () => {
  assert.equal(renameProcessTitle("next-server (v16.2.9)"), "dardcorCode (v16.2.9)");
});

test("renameProcessTitle passes through titles that do not start with 'next-server' unchanged", () => {
  assert.equal(renameProcessTitle("node"), "node");
  assert.equal(renameProcessTitle("some-other-process"), "some-other-process");
  assert.equal(renameProcessTitle("my-next-server-thing"), "my-next-server-thing");
});

test("renameProcessTitle is idempotent when called again on an already-renamed title", () => {
  const once = renameProcessTitle("next-server (v16.2.9)");
  const twice = renameProcessTitle(once);
  assert.equal(once, "dardcorCode (v16.2.9)");
  assert.equal(twice, "dardcorCode (v16.2.9)");
});

test("renameProcessTitle is empty/undefined safe", () => {
  assert.equal(renameProcessTitle(""), "");
  // @ts-expect-error - exercising runtime safety for a possibly-undefined process.title
  assert.equal(renameProcessTitle(undefined), undefined);
});
