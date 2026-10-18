/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isStandalone } from '../../../base/browser/browser.js';
import { addDisposableListener } from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { VSBuffer, decodeBase64, encodeBase64 } from '../../../base/common/buffer.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { parse } from '../../../base/common/marshalling.js';
import { Schemas } from '../../../base/common/network.js';
import { posix } from '../../../base/common/path.js';
import { isEqual } from '../../../base/common/resources.js';
import { ltrim } from '../../../base/common/strings.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import product from '../../../platform/product/common/product.js';
import { ISecretStorageProvider } from '../../../platform/secrets/common/secrets.js';
import { isFolderToOpen, isWorkspaceToOpen } from '../../../platform/window/common/window.js';
import type { IWorkbenchConstructionOptions, IWorkspace, IWorkspaceProvider } from '../../../workbench/browser/web.api.js';
import { AuthenticationSessionInfo } from '../../../workbench/services/authentication/browser/authenticationService.js';
import type { IURLCallbackProvider } from '../../../workbench/services/url/browser/urlService.js';
import { create } from '../../../workbench/workbench.web.main.internal.js';

interface ISecretStorageCrypto {
	seal(data: string): Promise<string>;
	unseal(data: string): Promise<string>;
}

class TransparentCrypto implements ISecretStorageCrypto {

	async seal(data: string): Promise<string> {
		return data;
	}

	async unseal(data: string): Promise<string> {
		return data;
	}
}

const enum AESConstants {
	ALGORITHM = 'AES-GCM',
	KEY_LENGTH = 256,
	IV_LENGTH = 12,
}

class NetworkError extends Error {

	constructor(inner: Error) {
		super(inner.message);
		this.name = inner.name;
		this.stack = inner.stack;
	}
}

class ServerKeyedAESCrypto implements ISecretStorageCrypto {

	private serverKey: Uint8Array | undefined;

	static supported() {
		return !!crypto.subtle;
	}

	constructor(private readonly authEndpoint: string) { }

	async seal(data: string): Promise<string> {
		const iv = mainWindow.crypto.getRandomValues(new Uint8Array(AESConstants.IV_LENGTH));
		const clientKeyObj = await mainWindow.crypto.subtle.generateKey(
			{ name: AESConstants.ALGORITHM as const, length: AESConstants.KEY_LENGTH as const },
			true,
			['encrypt', 'decrypt']
		);

		const clientKey = new Uint8Array(await mainWindow.crypto.subtle.exportKey('raw', clientKeyObj));
		const key = await this.getKey(clientKey);
		const dataUint8Array = new TextEncoder().encode(data);
		const cipherText: ArrayBuffer = await mainWindow.crypto.subtle.encrypt(
			{ name: AESConstants.ALGORITHM as const, iv },
			key,
			dataUint8Array
		);

		const result = new Uint8Array([...clientKey, ...iv, ...new Uint8Array(cipherText)]);
		return encodeBase64(VSBuffer.wrap(result));
	}

	async unseal(data: string): Promise<string> {
		const dataUint8Array = decodeBase64(data);

		if (dataUint8Array.byteLength < 60) {
			throw Error('Invalid length for the value for credentials.crypto');
		}

		const keyLength = AESConstants.KEY_LENGTH / 8;
		const clientKey = dataUint8Array.slice(0, keyLength);
		const iv = dataUint8Array.slice(keyLength, keyLength + AESConstants.IV_LENGTH);
		const cipherText = dataUint8Array.slice(keyLength + AESConstants.IV_LENGTH);

		const key = await this.getKey(clientKey.buffer);
		const decrypted = await mainWindow.crypto.subtle.decrypt(
			{ name: AESConstants.ALGORITHM as const, iv: iv.buffer as Uint8Array<ArrayBuffer> },
			key,
			cipherText.buffer as Uint8Array<ArrayBuffer>
		);

		return new TextDecoder().decode(new Uint8Array(decrypted));
	}

	private async getKey(clientKey: Uint8Array): Promise<CryptoKey> {
		if (!clientKey || clientKey.byteLength !== AESConstants.KEY_LENGTH / 8) {
			throw Error('Invalid length for clientKey');
		}

		const serverKey = await this.getServerKeyPart();
		const keyData = new Uint8Array(AESConstants.KEY_LENGTH / 8);

		for (let i = 0; i < keyData.byteLength; i++) {
			keyData[i] = clientKey[i] ^ serverKey[i];
		}

		return mainWindow.crypto.subtle.importKey(
			'raw',
			keyData,
			{
				name: AESConstants.ALGORITHM as const,
				length: AESConstants.KEY_LENGTH as const,
			},
			true,
			['encrypt', 'decrypt']
		);
	}

	private async getServerKeyPart(): Promise<Uint8Array> {
		if (this.serverKey) {
			return this.serverKey;
		}

		let attempt = 0;
		let lastError: Error | undefined;

		while (attempt <= 3) {
			try {
				const res = await fetch(this.authEndpoint, { credentials: 'include', method: 'POST' });
				if (!res.ok) {
					throw new Error(res.statusText);
				}

				const serverKey = new Uint8Array(await res.arrayBuffer());
				if (serverKey.byteLength !== AESConstants.KEY_LENGTH / 8) {
					throw Error(`The key retrieved by the server is not ${AESConstants.KEY_LENGTH} bit long.`);
				}

				this.serverKey = serverKey;

				return this.serverKey;
			} catch (e) {
				lastError = e instanceof Error ? e : new Error(String(e));
				attempt++;

				await new Promise(resolve => setTimeout(resolve, attempt * attempt * 100));
			}
		}

		if (lastError) {
			throw new NetworkError(lastError);
		}

		throw new Error('Unknown error');
	}
}

export class LocalStorageSecretStorageProvider implements ISecretStorageProvider {

	private readonly storageKey = 'secrets.provider';

	private secretsPromise: Promise<Record<string, string>>;

	type: 'in-memory' | 'persisted' | 'unknown' = 'persisted';

	constructor(
		private readonly crypto: ISecretStorageCrypto,
	) {
		this.secretsPromise = this.load();
	}

	private async load(): Promise<Record<string, string>> {
		const record = this.loadAuthSessionFromElement();

		const encrypted = localStorage.getItem(this.storageKey);
		if (encrypted) {
			try {
				const decrypted = JSON.parse(await this.crypto.unseal(encrypted));

				return { ...record, ...decrypted };
			} catch (err) {
				console.error('Failed to decrypt secrets from localStorage', err);
				if (!(err instanceof NetworkError)) {
					localStorage.removeItem(this.storageKey);
				}
			}
		}

		return record;
	}

	private loadAuthSessionFromElement(): Record<string, string> {
		let authSessionInfo: (AuthenticationSessionInfo & { scopes: string[][] }) | undefined;
		// eslint-disable-next-line no-restricted-syntax
		const authSessionElement = mainWindow.document.getElementById('vscode-workbench-auth-session');
		const authSessionElementAttribute = authSessionElement ? authSessionElement.getAttribute('data-settings') : undefined;
		if (authSessionElementAttribute) {
			try {
				authSessionInfo = JSON.parse(authSessionElementAttribute);
			} catch (error) { }
		}

		if (!authSessionInfo) {
			return {};
		}

		const record: Record<string, string> = {};

		record[`${product.urlProtocol}.loginAccount`] = JSON.stringify(authSessionInfo);

		if (authSessionInfo.providerId !== 'github') {
			console.error(`Unexpected auth provider: ${authSessionInfo.providerId}. Expected 'github'.`);
			return record;
		}

		const authAccount = JSON.stringify({ extensionId: 'vscode.github-authentication', key: 'github.auth' });
		record[authAccount] = JSON.stringify(authSessionInfo.scopes.map(scopes => ({
			id: authSessionInfo.id,
			scopes,
			accessToken: authSessionInfo.accessToken
		})));

		return record;
	}

	async get(key: string): Promise<string | undefined> {
		const secrets = await this.secretsPromise;

		return secrets[key];
	}

	async set(key: string, value: string): Promise<void> {
		const secrets = await this.secretsPromise;
		secrets[key] = value;
		this.secretsPromise = Promise.resolve(secrets);
		this.save();
	}

	async delete(key: string): Promise<void> {
		const secrets = await this.secretsPromise;
		delete secrets[key];
		this.secretsPromise = Promise.resolve(secrets);
		this.save();
	}

	async keys(): Promise<string[]> {
		const secrets = await this.secretsPromise;
		return Object.keys(secrets) || [];
	}

	private async save(): Promise<void> {
		try {
			const encrypted = await this.crypto.seal(JSON.stringify(await this.secretsPromise));
			localStorage.setItem(this.storageKey, encrypted);
		} catch (err) {
			console.error(err);
		}
	}
}

class LocalStorageURLCallbackProvider extends Disposable implements IURLCallbackProvider {

	private static REQUEST_ID = 0;

	private static QUERY_KEYS: ('scheme' | 'authority' | 'path' | 'query' | 'fragment')[] = [
		'scheme',
		'authority',
		'path',
		'query',
		'fragment'
	];

	private readonly _onCallback = this._register(new Emitter<URI>());
	readonly onCallback = this._onCallback.event;

	private pendingCallbacks = new Set<number>();
	private lastTimeChecked = Date.now();
	private checkCallbacksTimeout: Timeout | undefined = undefined;
	private onDidChangeLocalStorageDisposable: IDisposable | undefined;

	constructor(private readonly _callbackRoute: string) {
		super();
	}

	create(options: Partial<UriComponents> = {}): URI {
		const id = ++LocalStorageURLCallbackProvider.REQUEST_ID;
		const queryParams: string[] = [`vscode-reqid=${id}`];

		for (const key of LocalStorageURLCallbackProvider.QUERY_KEYS) {
			const value = options[key];

			if (value) {
				queryParams.push(`vscode-${key}=${encodeURIComponent(value)}`);
			}
		}

		if (!(options.authority === 'vscode.github-authentication' && options.path === '/dummy')) {
			const key = `vscode-web.url-callbacks[${id}]`;
			localStorage.removeItem(key);

			this.pendingCallbacks.add(id);
			this.startListening();
		}

		return URI.parse(mainWindow.location.href).with({ path: this._callbackRoute, query: queryParams.join('&') });
	}

	private startListening(): void {
		if (this.onDidChangeLocalStorageDisposable) {
			return;
		}

		this.onDidChangeLocalStorageDisposable = addDisposableListener(mainWindow, 'storage', () => this.onDidChangeLocalStorage());
	}

	private stopListening(): void {
		this.onDidChangeLocalStorageDisposable?.dispose();
		this.onDidChangeLocalStorageDisposable = undefined;
	}

	private async onDidChangeLocalStorage(): Promise<void> {
		const ellapsed = Date.now() - this.lastTimeChecked;

		if (ellapsed > 1000) {
			this.checkCallbacks();
		} else if (this.checkCallbacksTimeout === undefined) {
			this.checkCallbacksTimeout = setTimeout(() => {
				this.checkCallbacksTimeout = undefined;
				this.checkCallbacks();
			}, 1000 - ellapsed);
		}
	}

	private checkCallbacks(): void {
		let pendingCallbacks: Set<number> | undefined;

		for (const id of this.pendingCallbacks) {
			const key = `vscode-web.url-callbacks[${id}]`;
			const result = localStorage.getItem(key);

			if (result !== null) {
				try {
					this._onCallback.fire(URI.revive(JSON.parse(result)));
				} catch (error) {
					console.error(error);
				}

				pendingCallbacks = pendingCallbacks ?? new Set(this.pendingCallbacks);
				pendingCallbacks.delete(id);
				localStorage.removeItem(key);
			}
		}

		if (pendingCallbacks) {
			this.pendingCallbacks = pendingCallbacks;

			if (this.pendingCallbacks.size === 0) {
				this.stopListening();
			}
		}

		this.lastTimeChecked = Date.now();
	}

	override dispose(): void {
		clearTimeout(this.checkCallbacksTimeout);
		this.stopListening();
		super.dispose();
	}
}

class WorkspaceProvider implements IWorkspaceProvider {

	private static QUERY_PARAM_EMPTY_WINDOW = 'ew';
	private static QUERY_PARAM_FOLDER = 'folder';
	private static QUERY_PARAM_WORKSPACE = 'workspace';

	private static QUERY_PARAM_PAYLOAD = 'payload';

	static create(config: IWorkbenchConstructionOptions & { folderUri?: UriComponents; workspaceUri?: UriComponents }) {
		let foundWorkspace = false;
		let workspace: IWorkspace;
		let payload = Object.create(null);

		const query = new URL(document.location.href).searchParams;
		query.forEach((value, key) => {
			switch (key) {

				case WorkspaceProvider.QUERY_PARAM_FOLDER:
					if (config.remoteAuthority && value.startsWith(posix.sep)) {
						workspace = { folderUri: URI.from({ scheme: Schemas.vscodeRemote, path: value, authority: config.remoteAuthority }) };
					} else {
						workspace = { folderUri: URI.parse(value) };
					}
					foundWorkspace = true;
					break;

				case WorkspaceProvider.QUERY_PARAM_WORKSPACE:
					if (config.remoteAuthority && value.startsWith(posix.sep)) {
						workspace = { workspaceUri: URI.from({ scheme: Schemas.vscodeRemote, path: value, authority: config.remoteAuthority }) };
					} else {
						workspace = { workspaceUri: URI.parse(value) };
					}
					foundWorkspace = true;
					break;

				case WorkspaceProvider.QUERY_PARAM_EMPTY_WINDOW:
					workspace = undefined;
					foundWorkspace = true;
					break;

				case WorkspaceProvider.QUERY_PARAM_PAYLOAD:
					try {
						payload = parse(value);
					} catch (error) {
						console.error(error);
					}
					break;
			}
		});

		if (!foundWorkspace) {
			if (config.folderUri) {
				workspace = { folderUri: URI.revive(config.folderUri) };
			} else if (config.workspaceUri) {
				workspace = { workspaceUri: URI.revive(config.workspaceUri) };
			}
		}

		return new WorkspaceProvider(workspace, payload, config);
	}

	readonly trusted = true;

	private constructor(
		readonly workspace: IWorkspace,
		readonly payload: object,
		private readonly config: IWorkbenchConstructionOptions
	) {
	}

	async open(workspace: IWorkspace, options?: { reuse?: boolean; payload?: object }): Promise<boolean> {
		if (options?.reuse && !options.payload && this.isSame(this.workspace, workspace)) {
			return true;
		}

		const targetHref = this.createTargetUrl(workspace, options);
		if (targetHref) {
			if (options?.reuse) {
				mainWindow.location.href = targetHref;
				return true;
			} else {
				let result;
				if (isStandalone()) {
					result = mainWindow.open(targetHref, '_blank', 'toolbar=no');
				} else {
					result = mainWindow.open(targetHref);
				}

				return !!result;
			}
		}

		return false;
	}

	private createTargetUrl(workspace: IWorkspace, options?: { reuse?: boolean; payload?: object }): string | undefined {

		let targetHref: string | undefined = undefined;
		if (!workspace) {
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_EMPTY_WINDOW}=true`;
		}

		else if (isFolderToOpen(workspace)) {
			const queryParamFolder = this.encodeWorkspacePath(workspace.folderUri);
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_FOLDER}=${queryParamFolder}`;
		}

		else if (isWorkspaceToOpen(workspace)) {
			const queryParamWorkspace = this.encodeWorkspacePath(workspace.workspaceUri);
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_WORKSPACE}=${queryParamWorkspace}`;
		}

		if (options?.payload) {
			targetHref += `&${WorkspaceProvider.QUERY_PARAM_PAYLOAD}=${encodeURIComponent(JSON.stringify(options.payload))}`;
		}

		return targetHref;
	}

	private encodeWorkspacePath(uri: URI): string {
		if (this.config.remoteAuthority && uri.scheme === Schemas.vscodeRemote) {


			return encodeURIComponent(`${posix.sep}${ltrim(uri.path, posix.sep)}`).replaceAll('%2F', '/');
		}

		return encodeURIComponent(uri.toString(true));
	}

	private isSame(workspaceA: IWorkspace, workspaceB: IWorkspace): boolean {
		if (!workspaceA || !workspaceB) {
			return workspaceA === workspaceB;
		}

		if (isFolderToOpen(workspaceA) && isFolderToOpen(workspaceB)) {
			return isEqual(workspaceA.folderUri, workspaceB.folderUri);
		}

		if (isWorkspaceToOpen(workspaceA) && isWorkspaceToOpen(workspaceB)) {
			return isEqual(workspaceA.workspaceUri, workspaceB.workspaceUri);
		}

		return false;
	}

	hasRemote(): boolean {
		if (this.workspace) {
			if (isFolderToOpen(this.workspace)) {
				return this.workspace.folderUri.scheme === Schemas.vscodeRemote;
			}

			if (isWorkspaceToOpen(this.workspace)) {
				return this.workspace.workspaceUri.scheme === Schemas.vscodeRemote;
			}
		}

		return true;
	}
}

function readCookie(name: string): string | undefined {
	const cookies = document.cookie.split('; ');
	for (const cookie of cookies) {
		if (cookie.startsWith(name + '=')) {
			return cookie.substring(name.length + 1);
		}
	}

	return undefined;
}

(function () {

	// eslint-disable-next-line no-restricted-syntax
	const configElement = mainWindow.document.getElementById('vscode-workbench-web-configuration');
	const configElementAttribute = configElement ? configElement.getAttribute('data-settings') : undefined;
	if (!configElement || !configElementAttribute) {
		throw new Error('Missing web configuration element');
	}
	const config: IWorkbenchConstructionOptions & { folderUri?: UriComponents; workspaceUri?: UriComponents; callbackRoute: string } = JSON.parse(configElementAttribute);
	const secretStorageKeyPath = readCookie('vscode-secret-key-path');
	const secretStorageCrypto = secretStorageKeyPath && ServerKeyedAESCrypto.supported()
		? new ServerKeyedAESCrypto(secretStorageKeyPath) : new TransparentCrypto();

	create(mainWindow.document.body, {
		...config,
		windowIndicator: config.windowIndicator ?? { label: '$(remote)', tooltip: `${product.nameShort} Web` },
		settingsSyncOptions: config.settingsSyncOptions ? { enabled: config.settingsSyncOptions.enabled, } : undefined,
		workspaceProvider: WorkspaceProvider.create(config),
		urlCallbackProvider: new LocalStorageURLCallbackProvider(config.callbackRoute),
		secretStorageProvider: config.remoteAuthority && !secretStorageKeyPath
			? undefined
			: new LocalStorageSecretStorageProvider(secretStorageCrypto),
	});
})();
