import { describe, it, expect } from "vitest";
import {
  applyFingerprintTools,
  concealFingerprintToolNames,
  appendMissingFingerprintTools,
  fingerprintToolKey,
  takeRenamedToolNames,
  restoreToolNames,
} from "../../open-sse/utils/opencodeFingerprint.js";

describe("opencodeFingerprint — request side", () => {
  it("conceals case variants of quartet tools and returns the mapping", () => {
    const input = [
      { type: "function", function: { name: "Bash", description: "custom" } },
      { type: "function", function: { name: "other_tool", description: "keep" } },
    ];
    const { tools, map } = concealFingerprintToolNames(input);

    expect(map.get("bash")).toBe("Bash");
    expect(tools[0].function.name).toBe("bash");
    expect(tools[1].function.name).toBe("other_tool");
  });

  it("appends missing quartet tools in flat mode", () => {
    const tools = [{ type: "function", name: "bash" }];
    const appended = appendMissingFingerprintTools(tools, true);
    const names = appended.map((t) => t.name);

    expect(names).toEqual(["bash", "glob", "grep", "read"]);
    expect(appended[1].type).toBe("function");
    expect(appended[1].parameters).toEqual({ type: "object", properties: {} });
  });

  it("appends missing quartet tools in chat shape", () => {
    const tools = [{ type: "function", function: { name: "glob" } }];
    const appended = appendMissingFingerprintTools(tools, false);
    const names = appended.map((t) => t.function.name);

    expect(names).toEqual(["glob", "bash", "grep", "read"]);
  });

  it("applies full cloaking pass and attaches renamed map via WeakMap", () => {
    const body = {
      tools: [
        { type: "function", function: { name: "READ" } },
        { type: "function", function: { name: "my_tool" } },
      ],
      tool_choice: { type: "function", function: { name: "READ" } },
    };
    const map = applyFingerprintTools(body, false);

    expect(map.get("read")).toBe("READ");
    expect(body.tool_choice.function.name).toBe("read");
    expect(body.tools.map((t) => t.function.name)).toEqual(["read", "my_tool", "bash", "glob", "grep"]);
    expect(takeRenamedToolNames(body)).toBe(map);
  });

  it("handles empty or malformed tools gracefully", () => {
    for (const tools of [null, undefined, "invalid", [null, 42], [{}, { name: "" }]]) {
      expect(() => concealFingerprintToolNames(tools)).not.toThrow();
      expect(() => appendMissingFingerprintTools(tools, true)).not.toThrow();
    }
  });
});

describe("opencodeFingerprint — response side", () => {
  const map = new Map([["bash", "Bash"], ["grep", "Grep"], ["read", "Read"]]);

  it("restores names in Claude content_block_start chunks", () => {
    const chunk = {
      type: "content_block_start",
      content_block: { type: "tool_use", name: "bash", id: "t1" },
    };
    const out = restoreToolNames(chunk, map);

    expect(out.content_block.name).toBe("Bash");
    expect(chunk.content_block.name).toBe("bash");
  });

  it("restores names in Chat Completions message and delta shapes", () => {
    const body = {
      choices: [
        { message: { tool_calls: [{ function: { name: "grep", arguments: "{}" } }] } },
        { delta: { tool_calls: [{ function: { name: "read", arguments: "{}" } }] } },
      ],
    };
    const out = restoreToolNames(body, map);

    expect(out.choices[0].message.tool_calls[0].function.name).toBe("Grep");
    expect(out.choices[1].delta.tool_calls[0].function.name).toBe("Read");
  });

  it("restores names in Responses output items", () => {
    const body = { output: [{ type: "function_call", name: "bash", call_id: "c1" }] };
    expect(restoreToolNames(body, map).output[0].name).toBe("Bash");
  });

  it("leaves unknown tool names untouched", () => {
    const body = { output: [{ type: "function_call", name: "Edit" }] };
    expect(restoreToolNames(body, map).output[0].name).toBe("Edit");
  });
});

describe("fingerprintToolKey", () => {
  it("maps quartet case and whitespace variants", () => {
    expect(fingerprintToolKey("Bash")).toBe("bash");
    expect(fingerprintToolKey(" bash ")).toBe("bash");
    expect(fingerprintToolKey("GLOB")).toBe("glob");
    expect(fingerprintToolKey("Read")).toBe("read");
    expect(fingerprintToolKey("Edit")).toBe("");
    expect(fingerprintToolKey(null)).toBe("");
  });
});
