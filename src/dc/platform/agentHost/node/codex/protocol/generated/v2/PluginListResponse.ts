
import type { MarketplaceLoadErrorInfo } from "./MarketplaceLoadErrorInfo.js";
import type { PluginMarketplaceEntry } from "./PluginMarketplaceEntry.js";

export type PluginListResponse = { marketplaces: Array<PluginMarketplaceEntry>, marketplaceLoadErrors: Array<MarketplaceLoadErrorInfo>, featuredPluginIds: Array<string>, };
