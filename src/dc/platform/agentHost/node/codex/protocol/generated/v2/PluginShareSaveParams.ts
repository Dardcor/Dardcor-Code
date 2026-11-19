
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { PluginShareDiscoverability } from "./PluginShareDiscoverability.js";
import type { PluginShareTarget } from "./PluginShareTarget.js";

export type PluginShareSaveParams = { pluginPath: AbsolutePathBuf, remotePluginId?: string | null, discoverability?: PluginShareDiscoverability | null, shareTargets?: Array<PluginShareTarget> | null, };
