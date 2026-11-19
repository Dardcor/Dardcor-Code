
import type { JsonValue } from "../serde_json/JsonValue.js";

export type AnalyticsConfig = { enabled: boolean | null, } & ({ [key in string]?: number | string | boolean | Array<JsonValue> | { [key in string]?: JsonValue } | null });
