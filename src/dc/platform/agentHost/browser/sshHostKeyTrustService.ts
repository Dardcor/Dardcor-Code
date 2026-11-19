/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../storage/common/storage.js';
import {
	computeHostKeyStoreKey,
	ISSHHostKeyTrustService,
	type ISSHTrustedHost,
	type ISSHTrustedHostKey,
} from '../common/sshHostKeyTrust.js';

export const SSH_HOST_KEY_TRUST_STORAGE_KEY = 'sshRemoteAgentHost.trustedHostKeys';

function parseTrustedHostKey(value: unknown): ISSHTrustedHostKey | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const { keyType, fingerprint, addedAt, alias } = value as Record<string, unknown>;
	if (typeof keyType !== 'string' || !keyType
		|| typeof fingerprint !== 'string' || !fingerprint
		|| typeof addedAt !== 'number' || !Number.isFinite(addedAt)) {
		return undefined;
	}
	return {
		keyType,
		fingerprint,
		addedAt,
		...(typeof alias === 'string' && alias ? { alias } : undefined),
	};
}

export function parseTrustedHostKeys(raw: string | undefined): Map<string, ISSHTrustedHostKey[]> {
	const hosts = new Map<string, ISSHTrustedHostKey[]>();
	if (!raw) {
		return hosts;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return hosts;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return hosts;
	}

	for (const [storeKey, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!storeKey || !Array.isArray(value)) {
			continue;
		}
		const keys: ISSHTrustedHostKey[] = [];
		for (const entry of value) {
			const key = parseTrustedHostKey(entry);
			if (key) {
				keys.push(key);
			}
		}
		if (keys.length) {
			hosts.set(storeKey, keys);
		}
	}
	return hosts;
}

function parseStoreKey(storeKey: string): { host: string; port: number } | undefined {
	const separator = storeKey.lastIndexOf(':');
	if (separator <= 0) {
		return undefined;
	}
	const host = storeKey.substring(0, separator);
	const port = Number(storeKey.substring(separator + 1));
	if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
		return undefined;
	}
	return { host, port };
}

export class SSHHostKeyTrustService extends Disposable implements ISSHHostKeyTrustService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeTrustedHosts = this._register(new Emitter<string>());
	readonly onDidChangeTrustedHosts: Event<string> = this._onDidChangeTrustedHosts.event;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
	}

	getTrustedKeys(host: string, port: number): readonly ISSHTrustedHostKey[] {
		return this._read().get(computeHostKeyStoreKey(host, port)) ?? [];
	}

	trustHostKey(host: string, port: number, key: ISSHTrustedHostKey): void {
		const storeKey = computeHostKeyStoreKey(host, port);
		const hosts = this._read();
		const existing = hosts.get(storeKey) ?? [];
		const keys = existing.filter(k => k.keyType !== key.keyType);
		keys.push(key);
		hosts.set(storeKey, keys);
		this._write(hosts);
		this._onDidChangeTrustedHosts.fire(storeKey);
	}

	forgetHost(host: string, port: number): void {
		const storeKey = computeHostKeyStoreKey(host, port);
		const hosts = this._read();
		if (!hosts.delete(storeKey)) {
			return;
		}
		this._write(hosts);
		this._onDidChangeTrustedHosts.fire(storeKey);
	}

	listTrustedHosts(): readonly ISSHTrustedHost[] {
		const result: ISSHTrustedHost[] = [];
		for (const [storeKey, keys] of this._read()) {
			const parsed = parseStoreKey(storeKey);
			if (parsed) {
				result.push({ host: parsed.host, port: parsed.port, keys });
			}
		}
		return result;
	}

	private _read(): Map<string, ISSHTrustedHostKey[]> {
		return parseTrustedHostKeys(this._storageService.get(SSH_HOST_KEY_TRUST_STORAGE_KEY, StorageScope.APPLICATION));
	}

	private _write(hosts: Map<string, ISSHTrustedHostKey[]>): void {
		if (hosts.size === 0) {
			this._storageService.remove(SSH_HOST_KEY_TRUST_STORAGE_KEY, StorageScope.APPLICATION);
			return;
		}
		this._storageService.store(
			SSH_HOST_KEY_TRUST_STORAGE_KEY,
			JSON.stringify(Object.fromEntries(hosts)),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}
}
