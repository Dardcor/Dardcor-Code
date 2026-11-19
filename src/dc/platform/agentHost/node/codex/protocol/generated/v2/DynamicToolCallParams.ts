
import type { JsonValue } from "../serde_json/JsonValue.js";

export type DynamicToolCallParams = { threadId: string, turnId: string, callId: string, namespace: string | null, tool: string, arguments: JsonValue, };
