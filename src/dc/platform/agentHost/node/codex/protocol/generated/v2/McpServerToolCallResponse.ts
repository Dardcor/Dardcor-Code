
import type { JsonValue } from "../serde_json/JsonValue.js";

export type McpServerToolCallResponse = { content: Array<JsonValue>, structuredContent?: JsonValue, isError?: boolean, _meta?: JsonValue, };
