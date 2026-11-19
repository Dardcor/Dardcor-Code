
import type { AdditionalFileSystemPermissions } from "./AdditionalFileSystemPermissions.js";
import type { AdditionalNetworkPermissions } from "./AdditionalNetworkPermissions.js";

export type AdditionalPermissionProfile = {
	network: AdditionalNetworkPermissions | null, fileSystem: AdditionalFileSystemPermissions | null,
};
