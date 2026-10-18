
import type { JsonValue } from "../serde_json/JsonValue.js";

export type ThreadInjectItemsParams = {
	threadId: string,
	items: Array<JsonValue>,
};
