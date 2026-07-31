/**
 * Dardcor Code - Credentials Service (Task 142)
 * Mirrors: vs/platform/credentials/common/credentials.ts (safe OS password store wrapper)
 */

import { createDecorator } from '../instantiation/annotations';

export const ICredentialsService = createDecorator<ICredentialsService>('credentialsService');

export interface ICredentialsService {
	readonly _serviceBrand: undefined;
	getPassword(service: string, account: string): Promise<string | null>;
	setPassword(service: string, account: string, password: string): Promise<void>;
	deletePassword(service: string, account: string): Promise<boolean>;
}

declare const require: any;

export class MemoryCredentialsService implements ICredentialsService {
	declare readonly _serviceBrand: undefined;

	private readonly _store = new Map<string, string>();

	private _key(service: string, account: string): string {
		return `${service}:${account}`;
	}

	async getPassword(service: string, account: string): Promise<string | null> {
		return this._store.get(this._key(service, account)) ?? null;
	}

	async setPassword(service: string, account: string, password: string): Promise<void> {
		this._store.set(this._key(service, account), password);
	}

	async deletePassword(service: string, account: string): Promise<boolean> {
		return this._store.delete(this._key(service, account));
	}
}

export class KeytarCredentialsService extends MemoryCredentialsService {
	private readonly _keytar: any;

	constructor() {
		super();
		let keytar: any = undefined;
		try {
			const nodeRequire = typeof require === 'function' ? require : undefined;
			keytar = nodeRequire ? nodeRequire('keytar') : undefined;
		} catch {
			keytar = undefined;
		}
		this._keytar = keytar;
	}

	async getPassword(service: string, account: string): Promise<string | null> {
		if (this._keytar) {
			try {
				const stored = await this._keytar.getPassword(service, account);
				if (stored !== undefined && stored !== null) {
					return String(stored);
				}
			} catch {
				// OS keychain unavailable, fall back to in-memory store.
			}
		}
		return super.getPassword(service, account);
	}

	async setPassword(service: string, account: string, password: string): Promise<void> {
		if (this._keytar) {
			try {
				await this._keytar.setPassword(service, account, password);
				return;
			} catch {
				// OS keychain unavailable, fall back to in-memory store.
			}
		}
		await super.setPassword(service, account, password);
	}

	async deletePassword(service: string, account: string): Promise<boolean> {
		if (this._keytar) {
			try {
				return await this._keytar.deletePassword(service, account);
			} catch {
				// OS keychain unavailable, fall back to in-memory store.
			}
		}
		return super.deletePassword(service, account);
	}
}
