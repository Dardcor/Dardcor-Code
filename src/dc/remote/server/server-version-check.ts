export interface IVersionComparison {
	readonly compatible: boolean;
	readonly reason: string;
	readonly clientVersion: string;
	readonly serverVersion: string;
}

export interface IVersionParts {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly preRelease?: string;
}

export const PROTOCOL_VERSION = '1.0.0';
export const MIN_SUPPORTED_VERSION = '1.0.0';
export const MAX_COMPATIBLE_MAJOR = 1;

export function parseVersion(version: string): IVersionParts | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
	if (!match) {
		return null;
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		preRelease: match[4]
	};
}

export function isPreRelease(version: string): boolean {
	return /-(alpha|beta|rc|dev|preview|insider)/i.test(version);
}

export function compareVersions(clientVersion: string, serverVersion: string): number {
	const client = parseVersion(clientVersion);
	const server = parseVersion(serverVersion);
	if (!client || !server) {
		return 0;
	}
	if (client.major !== server.major) {
		return client.major < server.major ? -1 : 1;
	}
	if (client.minor !== server.minor) {
		return client.minor < server.minor ? -1 : 1;
	}
	if (client.patch !== server.patch) {
		return client.patch < server.patch ? -1 : 1;
	}
	if (client.preRelease === server.preRelease) {
		return 0;
	}
	if (!client.preRelease && server.preRelease) {
		return 1;
	}
	if (client.preRelease && !server.preRelease) {
		return -1;
	}
	return client.preRelease < server.preRelease ? -1 : 1;
}

export class ServerVersionCheck {
	static readonly MIN_SUPPORTED = MIN_SUPPORTED_VERSION;

	compareVersions(client: string, server: string): IVersionComparison {
		const clientParts = parseVersion(client);
		const serverParts = parseVersion(server);
		if (!clientParts || !serverParts) {
			return {
				compatible: false,
				reason: 'one or both versions are malformed',
				clientVersion: client,
				serverVersion: server
			};
		}
		if (serverParts.major < parseVersion(MIN_SUPPORTED_VERSION)!.major) {
			return {
				compatible: false,
				reason: `server version ${server} is older than the minimum supported version ${MIN_SUPPORTED_VERSION}`,
				clientVersion: client,
				serverVersion: server
			};
		}
		if (clientParts.major !== serverParts.major) {
			return {
				compatible: false,
				reason: `major version mismatch: client ${clientParts.major}, server ${serverParts.major}`,
				clientVersion: client,
				serverVersion: server
			};
		}
		if (clientParts.major > MAX_COMPATIBLE_MAJOR) {
			return {
				compatible: false,
				reason: `client major version ${clientParts.major} is newer than supported ${MAX_COMPATIBLE_MAJOR}`,
				clientVersion: client,
				serverVersion: server
			};
		}
		if (isPreRelease(client) !== isPreRelease(server) && clientParts.major === 0) {
			return {
				compatible: false,
				reason: 'pre-release and stable versions of major 0 are not interchangeable',
				clientVersion: client,
				serverVersion: server
			};
		}
		return {
			compatible: true,
			reason: `client ${client} and server ${server} are protocol compatible`,
			clientVersion: client,
			serverVersion: server
		};
	}

	isCompatible(client: string, server: string): boolean {
		return this.compareVersions(client, server).compatible;
	}

	getProtocolVersion(): string {
		return PROTOCOL_VERSION;
	}

	getMinimumSupportedVersion(): string {
		return MIN_SUPPORTED_VERSION;
	}

	checkUpgrade(client: string, server: string): 'client-outdated' | 'server-outdated' | 'current' | 'unknown' {
		const comparison = compareVersions(client, server);
		if (comparison < 0) {
			return 'client-outdated';
		}
		if (comparison > 0) {
			return 'server-outdated';
		}
		return 'current';
	}
}

export function versionToString(parts: IVersionParts): string {
	const base = `${parts.major}.${parts.minor}.${parts.patch}`;
	return parts.preRelease ? `${base}-${parts.preRelease}` : base;
}
