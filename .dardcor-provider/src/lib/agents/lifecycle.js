import { randomUUID } from "crypto";

const STORE_KEY = "__dardcor-codeAgentLifecycle";
const MAX_RECORDS = 100;

function store() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = [];
  return globalThis[STORE_KEY];
}

export function recordAgentLifecycle(record) {
  const entry = {
    id: record.id || randomUUID(),
    agentId: record.agentId,
    action: record.action,
    status: record.status,
    createdAt: record.createdAt || Date.now(),
    error: record.error || null,
  };
  const records = store();
  records.push(entry);
  while (records.length > MAX_RECORDS) records.shift();
  return entry;
}

export function getAgentLifecycle() {
  return [...store()].reverse();
}
