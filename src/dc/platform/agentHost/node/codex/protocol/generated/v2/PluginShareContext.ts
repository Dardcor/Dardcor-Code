
import type { PluginShareDiscoverability } from "./PluginShareDiscoverability.js";
import type { PluginSharePrincipal } from "./PluginSharePrincipal.js";

export type PluginShareContext = {
	remotePluginId: string,
	remoteVersion: string | null, discoverability: PluginShareDiscoverability | null, shareUrl: string | null, creatorAccountUserId: string | null, creatorName: string | null, sharePrincipals: Array<PluginSharePrincipal> | null, canPublishToWorkspace: boolean | null,
};
