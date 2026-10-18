
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type PluginShareCheckoutResponse = { remotePluginId: string, pluginId: string, pluginName: string, pluginPath: AbsolutePathBuf, marketplaceName: string, marketplacePath: AbsolutePathBuf, remoteVersion: string | null, };
