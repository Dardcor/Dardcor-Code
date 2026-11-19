
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type PluginInstalledParams = {
	cwds?: Array<AbsolutePathBuf> | null,
	installSuggestionPluginNames?: Array<string> | null,
};
