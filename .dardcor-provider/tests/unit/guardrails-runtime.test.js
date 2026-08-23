import { describe, expect, it, vi } from "vitest";
import { evaluateGuardrails, enforceLlmApiKeyGuardrail } from "@/lib/guardrails/runtime.js";

describe("guardrails runtime", () => {
  it("returns deterministic block outcomes", () => {
    const result = evaluateGuardrails({
      phase: "input",
      payload: "blocked text",
      rules: [{ id: "deny", action: "block", match: () => true }],
    });
    expect(result).toMatchObject({ outcome: "block", blockedBy: "deny", payload: "blocked text" });
  });

  it("warns without changing the payload", () => {
    const result = evaluateGuardrails({
      phase: "output",
      payload: "keep me",
      rules: [{ id: "notice", action: "warn", match: () => true }],
    });
    expect(result).toMatchObject({ outcome: "warn", payload: "keep me" });
  });

  it("redacts through an explicitly configured transform", () => {
    const result = evaluateGuardrails({
      phase: "input",
      payload: "token=secret",
      rules: [{ id: "token", action: "redact", match: () => true, transform: (value) => value.replace("secret", "[REDACTED]") }],
    });
    expect(result).toMatchObject({ outcome: "redact", payload: "token=[REDACTED]" });
  });

  it("does not inspect oversized payloads and fails closed only when configured", () => {
    const match = vi.fn(() => true);
    const open = evaluateGuardrails({ payload: "12345", maxBytes: 4, rules: [{ id: "open", action: "block", match }] });
    const closed = evaluateGuardrails({ payload: "12345", maxBytes: 4, rules: [{ id: "closed", action: "block", failClosed: true, match }] });
    expect(open.outcome).toBe("warn");
    expect(closed).toMatchObject({ outcome: "block", blockedBy: "closed" });
    expect(match).not.toHaveBeenCalled();
  });

  it("emits bounded audit metadata without payloads, errors, or secrets", () => {
    const secret = "sk-live-private";
    const result = evaluateGuardrails({
      payload: secret,
      rules: [{ id: "unsafe id containing private material", action: "warn", match: () => { throw new Error(secret); } }],
    });
    expect(JSON.stringify(result.events)).not.toContain(secret);
    expect(result.events[0]).toEqual({ phase: "input", ruleId: "unsafe-id-containing-private-material", outcome: "warn", reason: "evaluation_error" });
  });

  it("enforces the configured LLM API-key rule at the request boundary", () => {
    expect(enforceLlmApiKeyGuardrail({ required: false, present: false, valid: false }).outcome).toBe("allow");
    expect(enforceLlmApiKeyGuardrail({ required: true, present: false, valid: false })).toMatchObject({ outcome: "block", blockedBy: "llm-api-key-missing" });
    expect(enforceLlmApiKeyGuardrail({ required: true, present: true, valid: false })).toMatchObject({ outcome: "block", blockedBy: "llm-api-key-invalid" });
    expect(enforceLlmApiKeyGuardrail({ required: true, present: true, valid: true }).outcome).toBe("allow");
  });
});
