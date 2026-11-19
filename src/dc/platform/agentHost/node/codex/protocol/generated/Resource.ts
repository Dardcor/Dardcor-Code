
import type { JsonValue } from "./serde_json/JsonValue.js";

export type Resource = { annotations?: JsonValue, description?: string, mimeType?: string, name: string, size?: number, title?: string, uri: string, icons?: Array<JsonValue>, _meta?: JsonValue, };
