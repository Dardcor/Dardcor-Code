
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type ConfigLayerSource = {
	"type": "packagedDefaults",
	file: AbsolutePathBuf,
} | { "type": "mdm", domain: string, key: string, } | {
	"type": "system",
	file: AbsolutePathBuf,
} | {
	"type": "enterpriseManaged",
	id: string,
	name: string,
} | {
	"type": "user",
	file: AbsolutePathBuf,
	profile: string | null,
} | { "type": "project", dotCodexFolder: AbsolutePathBuf, } | { "type": "sessionFlags" } | { "type": "legacyManagedConfigTomlFromFile", file: AbsolutePathBuf, } | { "type": "legacyManagedConfigTomlFromMdm" };
