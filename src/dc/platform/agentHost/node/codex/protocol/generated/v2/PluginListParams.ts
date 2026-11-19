
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { PluginListMarketplaceKind } from "./PluginListMarketplaceKind.js";

export type PluginListParams = {
	cwds?: Array<AbsolutePathBuf> | null,
	marketplaceKinds?: Array<PluginListMarketplaceKind> | null,
	forceRefetch?: boolean,
};
