import { NextResponse } from "next/server";

const MAX_CONTENT = 100_000;
const MAX_METADATA = 65_536;

export class MemoryInputError extends Error {}

function text(value, name, { required = false, max = 200 } = {}) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new MemoryInputError(`${name} must be a string`);
  const result = value.trim();
  if (required && !result) throw new MemoryInputError(`${name} is required`);
  if (result.length > max) throw new MemoryInputError(`${name} is too long`);
  return result;
}

export function scopeFrom(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new MemoryInputError("body must be an object");
  return {
    userId: text(source.userId, "userId", { required: true }),
    sessionId: text(source.sessionId, "sessionId"),
  };
}

export function contentFrom(value) {
  return text(value, "content", { required: true, max: MAX_CONTENT });
}

export function metadataFrom(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemoryInputError("metadata must be an object");
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw new MemoryInputError("metadata must be JSON serializable"); }
  if (encoded.length > MAX_METADATA) throw new MemoryInputError("metadata is too large");
  return value;
}

export function integerFrom(value, name, fallback, max) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new MemoryInputError(`${name} must be an integer from 0 to ${max}`);
  return number;
}

export function queryFrom(value) {
  return text(value, "q", { required: true, max: 1000 });
}

export function errorResponse(error, fallback) {
  if (error instanceof MemoryInputError || error instanceof SyntaxError) {
    return NextResponse.json({ error: error.message || "Invalid JSON body" }, { status: 400 });
  }
  console.error(`[memory] ${fallback}:`, error);
  return NextResponse.json(
    { error: fallback, detail: error.message, ...(error.code ? { code: error.code } : {}) },
    { status: error.status === 503 ? 503 : 500 }
  );
}
