/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { IBrowserViewCertificateError } from '../common/browserView.js';
import type { BrowserSession } from './browserSession.js';

const STORAGE_KEY = 'browserView.sessionTrustData';

const TRUST_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

interface PersistedTrustData {
	[sessionId: string]: {
		trustedCerts?: { host: string; fingerprint: string; expiresAt: number }[];
	};
}

export interface IBrowserSessionTrust {
	trustCertificate(host: string, fingerprint: string): Promise<void>;
	untrustCertificate(host: string, fingerprint: string): Promise<void>;
	getCertificateError(url: string): IBrowserViewCertificateError | undefined;
	installCertErrorHandler(webContents: Electron.WebContents): void;
}

export class BrowserSessionTrust implements IBrowserSessionTrust {

	private readonly _trustedCertificates = new Map<string, Map<string, number>>();

	private readonly _certErrors = new Map<string, { certificate: Electron.Certificate; error: string }>();

	private _storage: IApplicationStorageMainService | undefined;

	constructor(
		private readonly _session: BrowserSession,
	) {
		this._installCertVerifyProc();
	}

	private _installCertVerifyProc(): void {
		this._session.electronSession.setCertificateVerifyProc((request, callback) => {
			const { hostname, errorCode, certificate, verificationResult } = request;
			const proxy = this._session.remote.proxy;

			if (proxy && hostname === proxy.host && certificate.fingerprint === proxy.certFingerprint) {
				return callback(0);
			}

			if (errorCode !== 0) {
				this._certErrors.set(hostname, { certificate, error: verificationResult });
			} else {
				this._certErrors.delete(hostname);
			}

			return callback(-3);
		});
	}

	installCertErrorHandler(webContents: Electron.WebContents): void {
		webContents.on('certificate-error', (event, url, _error, certificate, callback) => {
			event.preventDefault();

			const host = URL.parse(url)?.hostname;
			if (!host) {
				return callback(false);
			}

			if (this.isCertificateTrusted(host, certificate.fingerprint)) {
				return callback(true);
			}

			return callback(false);
		});
	}

	getCertificateError(url: string): IBrowserViewCertificateError | undefined {
		const parsed = URL.parse(url);
		if (!parsed || parsed.protocol !== 'https:') {
			return undefined;
		}

		const host = parsed.hostname;
		if (!host) {
			return undefined;
		}

		const known = this._certErrors.get(host);
		if (!known) {
			return undefined;
		}

		const cert = known.certificate;
		return {
			host,
			fingerprint: cert.fingerprint,
			error: known.error,
			url,
			hasTrustedException: this.isCertificateTrusted(host, cert.fingerprint),
			issuerName: cert.issuerName,
			subjectName: cert.subjectName,
			validStart: cert.validStart,
			validExpiry: cert.validExpiry,
		};
	}

	async trustCertificate(host: string, fingerprint: string): Promise<void> {
		let entries = this._trustedCertificates.get(host);
		if (!entries) {
			entries = new Map();
			this._trustedCertificates.set(host, entries);
		}
		entries.set(fingerprint, Date.now() + TRUST_DURATION_MS);
		this.writeStorage();
	}

	async untrustCertificate(host: string, fingerprint: string): Promise<void> {
		const entries = this._trustedCertificates.get(host);
		if (entries && entries.delete(fingerprint)) {
			if (entries.size === 0) {
				this._trustedCertificates.delete(host);
			}
		} else {
			throw new Error(`Certificate not found: host=${host} fingerprint=${fingerprint}`);
		}
		this.writeStorage();
		await this._session.electronSession.closeAllConnections();
	}

	isCertificateTrusted(host: string, fingerprint: string): boolean {
		const expiresAt = this._trustedCertificates.get(host)?.get(fingerprint);
		if (expiresAt === undefined) {
			return false;
		}
		if (Date.now() > expiresAt) {
			return false;
		}
		return true;
	}

	connectStorage(storage: IApplicationStorageMainService): void {
		if (this._storage) {
			return;
		}
		this._storage = storage;
		this.readStorage();
	}

	async clear(): Promise<void> {
		this._trustedCertificates.clear();
		this._certErrors.clear();
		this.writeStorage();
		await this._session.electronSession.closeAllConnections();
	}


	private readStorage(): void {
		const storage = this._storage;
		if (!storage) {
			return;
		}

		const raw = storage.get(STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return;
		}

		const now = Date.now();
		let pruned = false;
		try {
			const all: PersistedTrustData = JSON.parse(raw);
			const certs = all[this._session.id]?.trustedCerts;
			if (certs) {
				for (const { host, fingerprint, expiresAt } of certs) {
					if (expiresAt > now) {
						let entries = this._trustedCertificates.get(host);
						if (!entries) {
							entries = new Map();
							this._trustedCertificates.set(host, entries);
						}
						entries.set(fingerprint, expiresAt);
					} else {
						pruned = true;
					}
				}
			}
		} catch {
		}

		if (pruned) {
			this.writeStorage();
		}
	}

	private writeStorage(): void {
		const storage = this._storage;
		if (!storage) {
			return;
		}

		let all: PersistedTrustData = {};
		try {
			const raw = storage.get(STORAGE_KEY, StorageScope.APPLICATION);
			if (raw) {
				all = JSON.parse(raw);
			}
		} catch {
		}

		if (!all[this._session.id]) {
			all[this._session.id] = {};
		}

		if (this._trustedCertificates.size === 0) {
			delete all[this._session.id].trustedCerts;
		} else {
			const certs: { host: string; fingerprint: string; expiresAt: number }[] = [];
			for (const [host, entries] of this._trustedCertificates) {
				for (const [fingerprint, expiresAt] of entries) {
					certs.push({ host, fingerprint, expiresAt });
				}
			}
			all[this._session.id].trustedCerts = certs;
		}

		if (Object.keys(all[this._session.id]).length === 0) {
			delete all[this._session.id];
		}

		if (Object.keys(all).length === 0) {
			storage.remove(STORAGE_KEY, StorageScope.APPLICATION);
		} else {
			storage.store(STORAGE_KEY, JSON.stringify(all), StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
	}

}
