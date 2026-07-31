export const DISALLOWED_CAPABILITIES: readonly string[] = [
	'child_process.exec',
	'child_process.spawn',
	'child_process.fork',
	'fs.appendFile',
	'process.exit',
	'eval',
	'require'
];

export interface IExtensionSandboxPolicy {
	readonly [extensionId: string]: string[];
}

export class ExtensionSandboxGuard {
	private readonly _policy = new Map<string, Set<string>>();
	private readonly _disallowed = new Set<string>(DISALLOWED_CAPABILITIES);

	public isAllowed(extensionId: string, capability: string): boolean {
		if (this._disallowed.has(capability)) {
			return false;
		}
		const allowed = this._policy.get(extensionId);
		if (allowed === undefined) {
			return true;
		}
		return allowed.has('*') || allowed.has(capability);
	}

	public setPolicy(policy: IExtensionSandboxPolicy): void {
		this._policy.clear();
		for (const [extensionId, capabilities] of Object.entries(policy)) {
			this._policy.set(extensionId, new Set(capabilities));
		}
	}

	public clearPolicy(extensionId?: string): void {
		if (extensionId === undefined) {
			this._policy.clear();
		} else {
			this._policy.delete(extensionId);
		}
	}

	public getPolicy(extensionId: string): string[] {
		return [...(this._policy.get(extensionId) ?? [])];
	}

	public get disallowedCapabilities(): string[] {
		return [...this._disallowed];
	}

	public disallow(capability: string): void {
		this._disallowed.add(capability);
	}

	public allow(capability: string): void {
		this._disallowed.delete(capability);
	}

	public isDisallowed(capability: string): boolean {
		return this._disallowed.has(capability);
	}
}
