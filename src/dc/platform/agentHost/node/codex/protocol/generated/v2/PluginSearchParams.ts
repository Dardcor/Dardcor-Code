
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { PluginSearchScope } from "./PluginSearchScope.js";

export type PluginSearchParams = { searchTerm: string, scope?: PluginSearchScope | null, cwds?: Array<AbsolutePathBuf> | null, cursor?: string | null, limit?: number | null, };
