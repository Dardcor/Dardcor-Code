import { defaultClaudeToolType } from "../translator/concerns/toolCall.js";

const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
const assert = {
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${b}, got ${a}`); },
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
};

run("Tool without type property defaults to custom", () => {
  const tools = [{ name: "foo", description: "bar", input_schema: {} }];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "custom", "type defaulted");
  assert.equal(out[0].name, "foo", "other fields preserved");
});

run("Tool with type:null defaults to custom", () => {
  const tools = [{ name: "foo", type: null, input_schema: {} }];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "custom", "null type overwritten to custom");
});

run("Tool with type:undefined defaults to custom", () => {
  const tools = [{ name: "foo", type: undefined, input_schema: {} }];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "custom", "undefined type overwritten to custom");
});

run("Tool with type:empty-string defaults to custom", () => {
  const tools = [{ name: "foo", type: "", input_schema: {} }];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "custom", "empty-string type overwritten to custom");
});

run("Built-in tool (computer_use) passed through", () => {
  const tools = [{ type: "computer_use", name: "computer", display_width: 1024 }];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "computer_use", "built-in type preserved");
  assert.equal(out[0], tools[0], "same reference — not cloned");
});

run("Tool already with type:custom passed through", () => {
  const tools = [{ type: "custom", name: "foo", input_schema: {} }];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "custom", "existing custom type preserved");
  assert.equal(out[0], tools[0], "same reference — not cloned");
});

run("Mixed: built-in kept, function tool defaulted", () => {
  const tools = [
    { type: "computer_use", name: "computer", display_width: 1024 },
    { name: "search", description: "search the web", input_schema: {} },
    { type: "web_search_20250305", name: "web_search" },
  ];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "computer_use", "built-in preserved");
  assert.equal(out[1].type, "custom", "function tool defaulted");
  assert.equal(out[2].type, "web_search_20250305", "web_search preserved");
});

run("Non-array input returned unchanged", () => {
  assert.equal(defaultClaudeToolType(null), null, "null returned as-is");
  assert.equal(defaultClaudeToolType(undefined), undefined, "undefined returned as-is");
  assert.equal(defaultClaudeToolType("not array"), "not array", "string returned as-is");
});

run("Empty array returns empty array", () => {
  const out = defaultClaudeToolType([]);
  assert.equal(Array.isArray(out), true, "returns array");
  assert.equal(out.length, 0, "empty array");
});

run("Original tools not mutated by reference", () => {
  const original = { name: "foo", input_schema: {} };
  const tools = [original];
  defaultClaudeToolType(tools);
  assert.equal(original.type, undefined, "original tool not mutated");
  assert.ok(!("type" in original), "type property not added to original");
});

run("Array with null entry defaults to custom", () => {
  const tools = [null];
  const out = defaultClaudeToolType(tools);
  assert.equal(out[0].type, "custom", "null tool gets type custom");
  assert.equal(Object.keys(out[0]).length, 1, "no other keys from spread of null");
});

const passed = results.filter(r => r.ok).length;
const total = results.length;
for (const r of results) {
  console.log(`${r.ok ? "ok" : "FAIL"} - ${r.name}${r.ok ? "" : ` :: ${r.err}`}`);
}
console.log(`\n${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
