
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { McpElicitationSchema } from "./McpElicitationSchema.js";

export type McpServerElicitationRequestParams = {
	threadId: string,
	turnId: string | null, serverName: string,
} & ({ "mode": "form", _meta: JsonValue | null, message: string, requestedSchema: McpElicitationSchema, } | { "mode": "openai/form", _meta: JsonValue | null, message: string, requestedSchema: JsonValue, } | { "mode": "url", _meta: JsonValue | null, message: string, url: string, elicitationId: string, });
