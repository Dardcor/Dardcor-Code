
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { McpServerElicitationAction } from "./McpServerElicitationAction.js";

export type McpServerElicitationRequestResponse = {
	action: McpServerElicitationAction,
	content: JsonValue | null,
	_meta: JsonValue | null,
};
