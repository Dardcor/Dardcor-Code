
import type { MarketplaceLoadErrorInfo } from "./MarketplaceLoadErrorInfo.js";
import type { PluginMarketplaceEntry } from "./PluginMarketplaceEntry.js";

export type PluginInstalledResponse = { marketplaces: Array<PluginMarketplaceEntry>, marketplaceLoadErrors: Array<MarketplaceLoadErrorInfo>, };
