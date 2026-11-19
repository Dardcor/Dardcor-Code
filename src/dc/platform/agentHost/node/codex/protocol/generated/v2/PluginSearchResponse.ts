
import type { PluginSearchResult } from "./PluginSearchResult.js";

export type PluginSearchResponse = { data: Array<PluginSearchResult>, nextCursor: string | null, };
