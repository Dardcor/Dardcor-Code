const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_RULES = 32;
const VALID_ACTIONS = new Set(["block", "warn", "redact"]);

function safeRuleId(id) {
  const value = String(id || "guardrail").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return (value || "guardrail").slice(0, 64);
}

function payloadBytes(payload) {
  try {
    return Buffer.byteLength(typeof payload === "string" ? payload : JSON.stringify(payload));
  } catch {
    return Infinity;
  }
}

function auditEvent(phase, rule, outcome, reason) {
  return { phase, ruleId: safeRuleId(rule.id), outcome, reason };
}

function emit(events, event, onEvent) {
  events.push(event);
  try { onEvent?.(event); } catch { /* audit sinks never affect requests */ }
}

export function evaluateGuardrails({ phase = "input", payload, rules = [], maxBytes = DEFAULT_MAX_BYTES, onEvent } = {}) {
  const activeRules = Array.isArray(rules) ? rules.slice(0, MAX_RULES).filter((rule) => rule?.enabled !== false && VALID_ACTIONS.has(rule?.action)) : [];
  const events = [];
  let value = payload;
  let warned = false;
  let redacted = false;

  if (payloadBytes(value) > maxBytes) {
    for (const rule of activeRules) {
      const outcome = rule.failClosed === true ? "block" : "warn";
      emit(events, auditEvent(phase, rule, outcome, "payload_too_large"), onEvent);
      if (outcome === "block") return { outcome, blockedBy: safeRuleId(rule.id), payload: value, events };
      warned = true;
    }
    return { outcome: warned ? "warn" : "allow", payload: value, events };
  }

  for (const rule of activeRules) {
    let matched;
    try {
      matched = typeof rule.match === "function" ? rule.match(value) === true : rule.match === true;
    } catch {
      const outcome = rule.failClosed === true ? "block" : "warn";
      emit(events, auditEvent(phase, rule, outcome, "evaluation_error"), onEvent);
      if (outcome === "block") return { outcome, blockedBy: safeRuleId(rule.id), payload: value, events };
      warned = true;
      continue;
    }
    if (!matched) continue;

    if (rule.action === "block") {
      emit(events, auditEvent(phase, rule, "block", "matched"), onEvent);
      return { outcome: "block", blockedBy: safeRuleId(rule.id), payload: value, events };
    }
    if (rule.action === "warn") {
      emit(events, auditEvent(phase, rule, "warn", "matched"), onEvent);
      warned = true;
      continue;
    }

    try {
      if (typeof rule.transform !== "function") throw new Error("missing transform");
      const next = rule.transform(value);
      if (payloadBytes(next) > maxBytes) throw new Error("oversized transform");
      value = next;
      redacted = true;
      emit(events, auditEvent(phase, rule, "redact", "matched"), onEvent);
    } catch {
      const outcome = rule.failClosed === true ? "block" : "warn";
      emit(events, auditEvent(phase, rule, outcome, "redaction_error"), onEvent);
      if (outcome === "block") return { outcome, blockedBy: safeRuleId(rule.id), payload: value, events };
      warned = true;
    }
  }

  return { outcome: redacted ? "redact" : warned ? "warn" : "allow", payload: value, events };
}

export function enforceLlmApiKeyGuardrail({ required, present, valid }, onEvent) {
  if (required !== true) return { outcome: "allow", payload: null, events: [] };
  return evaluateGuardrails({
    phase: "request",
    payload: { present: present === true, valid: valid === true },
    onEvent,
    rules: [
      { id: "llm-api-key-missing", action: "block", match: (state) => !state.present },
      { id: "llm-api-key-invalid", action: "block", match: (state) => state.present && !state.valid },
    ],
  });
}
