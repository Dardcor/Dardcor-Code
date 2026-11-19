
import type { JsonValue } from "./serde_json/JsonValue.js";

export type McpServerInfo = { name: string, title: string | null, version: string, description: string | null, icons: Array<JsonValue> | null, websiteUrl: string | null, };
