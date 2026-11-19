
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { MergeStrategy } from "./MergeStrategy.js";

export type ConfigEdit = { keyPath: string, value: JsonValue, mergeStrategy: MergeStrategy, };
