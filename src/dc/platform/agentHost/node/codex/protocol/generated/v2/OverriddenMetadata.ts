
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { ConfigLayerMetadata } from "./ConfigLayerMetadata.js";

export type OverriddenMetadata = { message: string, overridingLayer: ConfigLayerMetadata, effectiveValue: JsonValue, };
