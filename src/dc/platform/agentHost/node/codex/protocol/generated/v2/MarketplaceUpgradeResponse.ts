
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { MarketplaceUpgradeErrorInfo } from "./MarketplaceUpgradeErrorInfo.js";

export type MarketplaceUpgradeResponse = { selectedMarketplaces: Array<string>, upgradedRoots: Array<AbsolutePathBuf>, errors: Array<MarketplaceUpgradeErrorInfo>, };
