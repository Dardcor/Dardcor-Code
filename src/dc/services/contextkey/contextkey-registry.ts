/**
 * Dardcor Code - ContextKey Registry (Task 161)
 * Mirrors: vs/platform/contextkey/common/contextkey.ts identifier table
 */

export interface IContextKeyInfo {
	readonly key: string;
	readonly description?: string;
	readonly type?: string;
}

export class ContextKeyRegistry {
	private readonly _keys = new Map<string, IContextKeyInfo>();

	registerContextKey(key: string, description?: string, type?: string): void {
		this._keys.set(key, { key, description, type });
	}

	getContextKeyInfo(key: string): IContextKeyInfo | undefined {
		return this._keys.get(key);
	}

	getAllContextKeys(): IContextKeyInfo[] {
		return Array.from(this._keys.values());
	}
}

const instance = new ContextKeyRegistry();

export function getContextKeyRegistry(): ContextKeyRegistry {
	return instance;
}
