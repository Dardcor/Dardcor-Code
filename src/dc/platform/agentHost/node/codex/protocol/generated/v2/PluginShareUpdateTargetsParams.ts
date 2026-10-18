
import type { PluginShareTarget } from "./PluginShareTarget.js";
import type { PluginShareUpdateDiscoverability } from "./PluginShareUpdateDiscoverability.js";

export type PluginShareUpdateTargetsParams = { remotePluginId: string, discoverability: PluginShareUpdateDiscoverability, shareTargets: Array<PluginShareTarget>, };
