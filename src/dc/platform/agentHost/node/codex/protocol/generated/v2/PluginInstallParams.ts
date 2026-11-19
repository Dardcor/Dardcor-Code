
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type PluginInstallParams = {
	marketplacePath?: AbsolutePathBuf | null, remoteMarketplaceName?: string | null,
	installAttemptId?: string | null, pluginName: string,
};
