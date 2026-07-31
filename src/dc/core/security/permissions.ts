/**
 * Dardcor Code - Feature Capability Authorization Guard (Task 89)
 * Mirrors: vs/platform/extensions/common/extensions.ts permissions
 */

export const enum FeaturePermission {
	FileSystemRead = 'fs.read',
	FileSystemWrite = 'fs.write',
	NetworkAccess = 'network.access',
	ClipboardRead = 'clipboard.read',
	ClipboardWrite = 'clipboard.write',
	ProcessExec = 'process.exec',
	TerminalAccess = 'terminal.access',
	WebviewCreate = 'webview.create',
	SecretsAccess = 'secrets.access',
	AuthAccess = 'auth.access',
}

export interface IPermissionRequest {
	permission: FeaturePermission;
	requestor: string;
	reason?: string;
}

export class PermissionGuard {
	private readonly _grants = new Map<string, Set<FeaturePermission>>();
	private readonly _globalGrants = new Set<FeaturePermission>();

	grantGlobal(permission: FeaturePermission): void {
		this._globalGrants.add(permission);
	}

	revokeGlobal(permission: FeaturePermission): void {
		this._globalGrants.delete(permission);
	}

	grant(requestor: string, permission: FeaturePermission): void {
		let set = this._grants.get(requestor);
		if (!set) {
			set = new Set();
			this._grants.set(requestor, set);
		}
		set.add(permission);
	}

	revoke(requestor: string, permission: FeaturePermission): void {
		this._grants.get(requestor)?.delete(permission);
	}

	revokeAll(requestor: string): void {
		this._grants.delete(requestor);
	}

	check(requestor: string, permission: FeaturePermission): boolean {
		if (this._globalGrants.has(permission)) return true;
		return this._grants.get(requestor)?.has(permission) ?? false;
	}

	checkOrThrow(request: IPermissionRequest): void {
		if (!this.check(request.requestor, request.permission)) {
			throw new Error(
				`Permission denied: '${request.requestor}' requires '${request.permission}'` +
				(request.reason ? ` (${request.reason})` : '')
			);
		}
	}

	getGrantedPermissions(requestor: string): FeaturePermission[] {
		const result = [...this._globalGrants];
		const specific = this._grants.get(requestor);
		if (specific) {
			result.push(...specific);
		}
		return [...new Set(result)];
	}
}
