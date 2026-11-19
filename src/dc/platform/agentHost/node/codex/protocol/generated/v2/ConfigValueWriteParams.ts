
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { MergeStrategy } from "./MergeStrategy.js";

export type ConfigValueWriteParams = {
	keyPath: string, value: JsonValue, mergeStrategy: MergeStrategy,
	filePath?: string | null, expectedVersion?: string | null,
};
