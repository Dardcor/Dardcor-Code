export const DEFAULT_EXTENSION_PERMISSIONS: readonly string[] = ['fs.read', 'fs.write', 'network', 'clipboard'];

export interface IPermissionRequest {
	readonly extensionId: string;
	readonly permission: string;
}

export class ExtensionPermissions {
	private readonly _granted = new Map<string, Set<string>>();
	private readonly _revoked = new Map<string, Set<string>>();

	public hasPermission(extensionId: string, permission: string): boolean {
		if (this._revoked.get(extensionId)?.has(permission)) {
			return false;
		}
		if (this._granted.get(extensionId)?.has('*')) {
			return true;
		}
		if (this._granted.get(extensionId)?.has(permission)) {
			return true;
		}
		return DEFAULT_EXTENSION_PERMISSIONS.includes(permission);
	}

	public grantPermission(extensionId: string, permission: string): void {
		let granted = this._granted.get(extensionId);
		if (!granted) {
			granted = new Set();
			this._granted.set(extensionId, granted);
		}
		granted.add(permission);
		this._revoked.get(extensionId)?.delete(permission);
	}

	public grantPermissions(extensionId: string, permissions: readonly string[]): void {
		for (const permission of permissions) {
			this.grantPermission(extensionId, permission);
		}
	}

	public revokePermission(extensionId: string, permission: string): void {
		this._granted.get(extensionId)?.delete(permission);
		let revoked = this._revoked.get(extensionId);
		if (!revoked) {
			revoked = new Set();
			this._revoked.set(extensionId, revoked);
		}
		revoked.add(permission);
	}

	public revokeAll(extensionId: string): void {
		this._granted.delete(extensionId);
		let revoked = this._revoked.get(extensionId);
		if (!revoked) {
			revoked = new Set();
			this._revoked.set(extensionId, revoked);
		}
		for (const permission of DEFAULT_EXTENSION_PERMISSIONS) {
			revoked.add(permission);
		}
	}

	public getGrantedPermissions(extensionId: string): string[] {
		const explicit = this._granted.get(extensionId) ?? new Set<string>();
		const result = new Set<string>();
		for (const permission of DEFAULT_EXTENSION_PERMISSIONS) {
			if (this.hasPermission(extensionId, permission)) {
				result.add(permission);
			}
		}
		for (const permission of explicit) {
			if (permission !== '*' && this.hasPermission(extensionId, permission)) {
				result.add(permission);
			}
		}
		return [...result];
	}

	public getRevokedPermissions(extensionId: string): string[] {
		return [...(this._revoked.get(extensionId) ?? [])];
	}

	public clear(extensionId?: string): void {
		if (extensionId === undefined) {
			this._granted.clear();
			this._revoked.clear();
		} else {
			this._granted.delete(extensionId);
			this._revoked.delete(extensionId);
		}
	}
}
