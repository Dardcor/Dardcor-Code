
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { ConfigLayerSource } from "./ConfigLayerSource.js";

export type ConfigLayer = { name: ConfigLayerSource, version: string, config: JsonValue, disabledReason: string | null, };
