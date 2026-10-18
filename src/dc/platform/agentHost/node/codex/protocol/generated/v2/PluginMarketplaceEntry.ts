
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { MarketplaceInterface } from "./MarketplaceInterface.js";
import type { PluginSummary } from "./PluginSummary.js";

export type PluginMarketplaceEntry = {
	name: string,
	path: AbsolutePathBuf | null, interface: MarketplaceInterface | null, plugins: Array<PluginSummary>,
};
