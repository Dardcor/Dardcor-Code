/**
 * Dardcor Code - Secrets Service (Task 143)
 * Mirrors: vs/platform/secrets/common/secrets.ts (encrypted extension secrets vault)
 */

import { createDecorator } from '../instantiation/annotations';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { CryptoBridge } from '../../core/security/crypto';
import { deriveMasterKey } from './master-key';
import { ICredentialsService } from '../credentials/credentials-service';

export const ISecretsService = createDecorator<ISecretsService>('secretsService');

export interface ISecretsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangePassword: Event<{ key: string }>;
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

const SALT = 'dardcor-code-secrets-salt-v1';
const PREFIX_ENCRYPTED = 'enc:';
const PREFIX_PLAINTEXT = 'plain:';

function hexToBase64(hex: string): string {
	const bytes = new Uint8Array(Math.ceil(hex.length / 2));
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
	}
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export class SecretsService extends Disposable implements ISecretsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePassword = this._register(new Emitter<{ key: string }>());
	readonly onDidChangePassword: Event<{ key: string }> = this._onDidChangePassword.event;

	private _keyPromise: Promise<CryptoKey | undefined> | undefined;

	constructor(
		private readonly _credentialsService: ICredentialsService,
		private readonly _serviceName = 'dardcor-code-secrets',
		private readonly _passphrase?: string
	) {
		super();
	}

	async get(key: string): Promise<string | undefined> {
		const stored = await this._credentialsService.getPassword(this._serviceName, key);
		if (!stored) {
			return undefined;
		}
		if (stored.startsWith(PREFIX_PLAINTEXT)) {
			return stored.substring(PREFIX_PLAINTEXT.length);
		}
		if (!stored.startsWith(PREFIX_ENCRYPTED)) {
			return undefined;
		}
		const secretKey = await this._getKey();
		if (!secretKey) {
			return undefined;
		}
		try {
			const [iv, ciphertext] = stored.substring(PREFIX_ENCRYPTED.length).split(':');
			return await CryptoBridge.decrypt(ciphertext, iv, secretKey);
		} catch {
			return undefined;
		}
	}

	async set(key: string, value: string): Promise<void> {
		const secretKey = await this._getKey();
		if (secretKey) {
			try {
				const { iv, ciphertext } = await CryptoBridge.encrypt(value, secretKey);
				await this._credentialsService.setPassword(this._serviceName, key, `${PREFIX_ENCRYPTED}${iv}:${ciphertext}`);
				this._onDidChangePassword.fire({ key });
				return;
			} catch {
				// Fall through to plaintext when crypto primitives are unavailable.
			}
		}
		await this._credentialsService.setPassword(this._serviceName, key, `${PREFIX_PLAINTEXT}${value}`);
		this._onDidChangePassword.fire({ key });
	}

	async delete(key: string): Promise<void> {
		await this._credentialsService.deletePassword(this._serviceName, key);
		this._onDidChangePassword.fire({ key });
	}

	private _getKey(): Promise<CryptoKey | undefined> {
		if (!this._keyPromise) {
			this._keyPromise = this._deriveKey();
		}
		return this._keyPromise;
	}

	private async _deriveKey(): Promise<CryptoKey | undefined> {
		try {
			const passphrase = this._passphrase ?? this._serviceName;
			const derived = await deriveMasterKey(passphrase, SALT);
			return await CryptoBridge.importKey(hexToBase64(derived));
		} catch {
			return undefined;
		}
	}
}
