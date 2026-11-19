
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { PluginSummary } from "./PluginSummary.js";

export type PluginSearchResult = { plugin: PluginSummary, marketplaceName: string, marketplacePath: AbsolutePathBuf | null, };
