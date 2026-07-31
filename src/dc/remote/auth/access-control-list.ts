import { Emitter, Event } from '../../core/events/emitter.js';

export interface IAclEntry {
	readonly user: string;
	readonly permissions: string[];
}

export interface IAccessControlListOptions {
	readonly entries?: ReadonlyArray<IAclEntry>;
	readonly publicRoutes?: ReadonlyArray<string>;
}

export interface IAclChangeEvent {
	readonly action: 'grant' | 'revoke' | 'set' | 'clear';
	readonly user?: string;
	readonly permission?: string;
}

export const WILDCARD_PERMISSION = '*';

export function permissionAllows(assigned: string, requested: string): boolean {
	if (assigned === WILDCARD_PERMISSION || assigned === requested) {
		return true;
	}
	if (assigned.endsWith(':*') && requested.startsWith(assigned.slice(0, -1))) {
		return true;
	}
	return false;
}

export function parsePermissionList(value: string | string[] | undefined): string[] {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.filter((p): p is string => typeof p === 'string');
	}
	return value.split(',').map(p => p.trim()).filter(Boolean);
}

export class AccessControlList {
	private readonly _entries = new Map<string, string[]>();
	private _publicRoutes: string[];

	private readonly _onDidChange = new Emitter<IAclChangeEvent>();
	readonly onDidChange: Event<IAclChangeEvent> = this._onDidChange.event;

	constructor(options: IAccessControlListOptions = {}) {
		this._publicRoutes = [...(options.publicRoutes ?? [])];
		for (const entry of options.entries ?? []) {
			this._entries.set(entry.user, [...entry.permissions]);
		}
	}

	get users(): string[] {
		return [...this._entries.keys()];
	}

	get publicRoutes(): string[] {
		return [...this._publicRoutes];
	}

	get size(): number {
		return this._entries.size;
	}

	hasPermission(user: string, permission: string): boolean {
		const permissions = this._entries.get(user);
		if (!permissions) {
			return false;
		}
		return permissions.some(p => permissionAllows(p, permission));
	}

	hasAnyPermission(user: string, permissions: string[]): boolean {
		return permissions.some(p => this.hasPermission(user, p));
	}

	hasAllPermissions(user: string, permissions: string[]): boolean {
		return permissions.every(p => this.hasPermission(user, p));
	}

	isPublic(route: string): boolean {
		const path = route.split('?')[0];
		return this._publicRoutes.some(pattern => matchRoute(pattern, path));
	}

	grant(user: string, permission: string): boolean {
		const permissions = this._entries.get(user);
		if (permissions) {
			if (permissions.includes(permission)) {
				return false;
			}
			permissions.push(permission);
		} else {
			this._entries.set(user, [permission]);
		}
		this._onDidChange.fire({ action: 'grant', user, permission });
		return true;
	}

	revoke(user: string, permission: string): boolean {
		const permissions = this._entries.get(user);
		if (!permissions) {
			return false;
		}
		const index = permissions.indexOf(permission);
		if (index === -1) {
			return false;
		}
		permissions.splice(index, 1);
		if (permissions.length === 0) {
			this._entries.delete(user);
		}
		this._onDidChange.fire({ action: 'revoke', user, permission });
		return true;
	}

	removeUser(user: string): boolean {
		if (!this._entries.delete(user)) {
			return false;
		}
		this._onDidChange.fire({ action: 'revoke', user });
		return true;
	}

	getUserPermissions(user: string): string[] {
		return [...(this._entries.get(user) ?? [])];
	}

	setUserPermissions(user: string, permissions: string[]): void {
		this._entries.set(user, [...permissions]);
		this._onDidChange.fire({ action: 'set', user });
	}

	addPublicRoute(route: string): void {
		if (!this._publicRoutes.includes(route)) {
			this._publicRoutes.push(route);
		}
	}

	removePublicRoute(route: string): void {
		this._publicRoutes = this._publicRoutes.filter(r => r !== route);
	}

	clear(): void {
		this._entries.clear();
		this._publicRoutes = [];
		this._onDidChange.fire({ action: 'clear' });
	}

	toEntries(): IAclEntry[] {
		return [...this._entries.entries()].map(([user, permissions]) => ({ user, permissions: [...permissions] }));
	}

	serialize(): string {
		return JSON.stringify({
			entries: this.toEntries(),
			publicRoutes: this._publicRoutes
		}, null, 2);
	}

	static deserialize(source: string): AccessControlList {
		let raw: Record<string, unknown>;
		try {
			raw = JSON.parse(source) as Record<string, unknown>;
		} catch (error) {
			throw new Error(`Invalid ACL data: ${error instanceof Error ? error.message : String(error)}`);
		}
		const entries: IAclEntry[] = [];
		if (Array.isArray(raw.entries)) {
			for (const item of raw.entries) {
				if (item && typeof item === 'object' && typeof (item as IAclEntry).user === 'string') {
					entries.push({
						user: (item as IAclEntry).user,
						permissions: parsePermissionList((item as IAclEntry).permissions)
					});
				}
			}
		}
		const publicRoutes: string[] = [];
		if (Array.isArray(raw.publicRoutes)) {
			for (const route of raw.publicRoutes) {
				if (typeof route === 'string') {
					publicRoutes.push(route);
				}
			}
		}
		return new AccessControlList({ entries, publicRoutes });
	}

	toJson(): Record<string, unknown> {
		return {
			entries: this.toEntries(),
			publicRoutes: this._publicRoutes
		};
	}
}

export function matchRoute(pattern: string, path: string): boolean {
	if (pattern === '*') {
		return true;
	}
	if (pattern === path) {
		return true;
	}
	if (pattern.endsWith('/*')) {
		return path.startsWith(pattern.slice(0, -1));
	}
	if (pattern.endsWith('/**')) {
		return path.startsWith(pattern.slice(0, -2));
	}
	return false;
}

export function createDefaultAcl(): AccessControlList {
	return new AccessControlList({
		entries: [{ user: 'admin', permissions: [WILDCARD_PERMISSION] }],
		publicRoutes: ['/', '/health', '/favicon.ico']
	});
}
