
import type { JsonValue } from "./serde_json/JsonValue.js";

export type ResourceContent = {
	uri: string, mimeType?: string, text: string, _meta?: JsonValue,
} | {
	uri: string, mimeType?: string, blob: string, _meta?: JsonValue,
};
