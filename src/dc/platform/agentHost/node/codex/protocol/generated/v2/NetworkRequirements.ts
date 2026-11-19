
import type { NetworkDomainPermission } from "./NetworkDomainPermission.js";
import type { NetworkUnixSocketPermission } from "./NetworkUnixSocketPermission.js";

export type NetworkRequirements = {
	enabled: boolean | null, httpPort: number | null, socksPort: number | null, allowUpstreamProxy: boolean | null, dangerouslyAllowNonLoopbackProxy: boolean | null, dangerouslyAllowAllUnixSockets: boolean | null,
	domains: { [key in string]?: NetworkDomainPermission } | null,
	managedAllowedDomainsOnly: boolean | null,
	allowedDomains: Array<string> | null,
	deniedDomains: Array<string> | null,
	unixSockets: { [key in string]?: NetworkUnixSocketPermission } | null,
	allowUnixSockets: Array<string> | null, allowLocalBinding: boolean | null,
};
