export interface IUserMappingConfig {
	readonly remoteUser?: string;
	readonly containerUser?: string;
	readonly uid?: number;
	readonly gid?: number;
	readonly useCurrentUid?: boolean;
}

export interface IContainerUserMapping {
	readonly remoteUser: string;
	readonly containerUser: string;
	readonly uid: number;
	readonly gid: number;
	readonly hostUid: number | null;
	readonly hostGid: number | null;
	readonly mapped: boolean;
}

export interface IPasswdEntry {
	readonly name: string;
	readonly uid: number;
	readonly gid: number;
	readonly home: string;
	readonly shell: string;
}

export const DEFAULT_REMOTE_USER = 'root';
export const DEFAULT_CONTAINER_USER = 'root';
export const DEFAULT_UID = 1000;

export function parsePasswd(content: string): IPasswdEntry[] {
	const entries: IPasswdEntry[] = [];
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const fields = line.split(':');
		if (fields.length < 7) {
			continue;
		}
		const uid = Number(fields[2]);
		const gid = Number(fields[3]);
		if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
			continue;
		}
		entries.push({
			name: fields[0],
			uid,
			gid,
			home: fields[5],
			shell: fields[6]
		});
	}
	return entries;
}

export function findUserByName(content: string, name: string): IPasswdEntry | undefined {
	return parsePasswd(content).find(entry => entry.name === name);
}

export function findUserByUid(content: string, uid: number): IPasswdEntry | undefined {
	return parsePasswd(content).find(entry => entry.uid === uid);
}

export function getCurrentUid(): number | null {
	if (typeof process === 'undefined' || typeof process.getuid !== 'function') {
		return null;
	}
	try {
		return process.getuid();
	} catch {
		return null;
	}
}

export function getCurrentGid(): number | null {
	if (typeof process === 'undefined' || typeof process.getgid !== 'function') {
		return null;
	}
	try {
		return process.getgid();
	} catch {
		return null;
	}
}

export class ContainerUserMapping {
	constructor(private readonly _config: IUserMappingConfig = {}) {}

	getMapping(hostUid?: number | null, hostGid?: number | null, config?: IUserMappingConfig): IContainerUserMapping {
		const resolved = config ?? this._config;
		const uid = resolved.useCurrentUid
			? (hostUid ?? getCurrentUid() ?? DEFAULT_UID)
			: (resolved.uid ?? DEFAULT_UID);
		const gid = resolved.gid ?? hostGid ?? (resolved.useCurrentUid ? getCurrentGid() : undefined) ?? uid;
		const remoteUser = resolved.remoteUser ?? DEFAULT_REMOTE_USER;
		const containerUser = resolved.containerUser ?? (resolved.remoteUser ? resolved.remoteUser : DEFAULT_CONTAINER_USER);
		const hostUidValue = resolved.useCurrentUid ? (hostUid ?? getCurrentUid()) : null;
		const hostGidValue = resolved.useCurrentUid ? (hostGid ?? getCurrentGid()) : null;
		return {
			remoteUser,
			containerUser,
			uid,
			gid,
			hostUid: hostUidValue,
			hostGid: hostGidValue,
			mapped: resolved.useCurrentUid && hostUidValue !== null
		};
	}

	buildUserArgs(mapping: IContainerUserMapping): string[] {
		const args: string[] = [];
		if (mapping.hostUid !== null) {
			args.push('--user', `${mapping.hostUid}:${mapping.gid}`);
		} else if (mapping.uid !== DEFAULT_UID || mapping.remoteUser !== 'root') {
			args.push('--user', `${mapping.uid}:${mapping.gid}`);
		}
		return args;
	}

	buildDockerfileUser(mapping: IContainerUserMapping): string {
		if (mapping.mapped) {
			return `ARG REMOTE_USER=${mapping.remoteUser}\nUSER \${REMOTE_USER}`;
		}
		return `USER ${mapping.containerUser}`;
	}

	getUserEnv(mapping: IContainerUserMapping): Record<string, string> {
		const env: Record<string, string> = {
			USER: mapping.containerUser,
			LOGNAME: mapping.containerUser,
			HOME: mapping.containerUser === 'root' ? '/root' : `/home/${mapping.containerUser}`
		};
		return env;
	}

	resolveUserName(passwdContent: string, mapping: IContainerUserMapping): string {
		const entry = findUserByUid(passwdContent, mapping.uid);
		return entry?.name ?? mapping.containerUser;
	}
}
