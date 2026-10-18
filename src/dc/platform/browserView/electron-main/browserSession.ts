/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { session } from 'electron';
import { normalize } from '../../../base/common/path.js';
import { isLinux } from '../../../base/common/platform.js';
import { joinPath } from '../../../base/common/resources.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { URI } from '../../../base/common/uri.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { BrowserViewStorageScope, IBrowserSessionOptions } from '../common/browserView.js';
import { BrowserSessionTrust, IBrowserSessionTrust } from './browserSessionTrust.js';
import { BrowserSessionHistory, IBrowserSessionHistory } from './browserSessionHistory.js';
import { BrowserSessionPermissions, IBrowserSessionPermissions } from './browserSessionPermissions.js';
import { BrowserSessionRemote, IBrowserSessionRemote } from './browserSessionRemote.js';
import { FileAccess, Schemas } from '../../../base/common/network.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { localize } from '../../../nls.js';
import { IAgentNetworkFilterService } from '../../networkFilter/common/networkFilterService.js';

export class BrowserSession {


	private static readonly _bySession = new WeakMap<Electron.Session, BrowserSession>();

	private static readonly _byId = new Map<string, WeakRef<BrowserSession>>();

	private static readonly _finalizer = new FinalizationRegistry<string>((id) => {
		BrowserSession._byId.delete(id);
	});

	static readonly knownSessions = new WeakSet<Electron.Session>();

	static isBrowserViewWebContents(contents: Electron.WebContents): boolean {
		return BrowserSession.knownSessions.has(contents.session);
	}

	static get(id: string): BrowserSession | undefined {
		const ref = BrowserSession._byId.get(id);
		if (!ref) {
			return undefined;
		}
		const bs = ref.deref();
		if (!bs) {
			BrowserSession._byId.delete(id);
		}
		return bs;
	}

	static getBrowserContextIds(): string[] {
		const ids: string[] = [];
		for (const [id, ref] of BrowserSession._byId) {
			if (ref.deref()) {
				ids.push(id);
			} else {
				BrowserSession._byId.delete(id);
			}
		}
		return ids;
	}

	static getOrCreateGlobal(instantiationService: IInstantiationService): BrowserSession {
		const electronSession = session.fromPartition('persist:vscode-browser');
		return BrowserSession._bySession.get(electronSession)
			?? instantiationService.createInstance(BrowserSession, 'global', electronSession, BrowserViewStorageScope.Global);
	}

	static getOrCreateWorkspace(instantiationService: IInstantiationService, workspaceId: string, workspaceStorageHome: URI): BrowserSession {
		const storage = joinPath(workspaceStorageHome, workspaceId, 'browserStorage');
		const electronSession = session.fromPath(storage.fsPath);
		return BrowserSession._bySession.get(electronSession)
			?? instantiationService.createInstance(BrowserSession, `workspace:${workspaceId}`, electronSession, BrowserViewStorageScope.Workspace);
	}

	static getOrCreateEphemeral(instantiationService: IInstantiationService, viewId: string, type?: string): BrowserSession {
		if (type === 'workspace' || type === 'ephemeral') {
			throw new Error(`Cannot create session with reserved type '${type}'`);
		}

		const sessionId = `${type ?? 'ephemeral'}:${viewId}`;
		const electronSession = session.fromPartition(`vscode-browser-${type}${viewId}`);
		return BrowserSession._bySession.get(electronSession)
			?? instantiationService.createInstance(BrowserSession, sessionId, electronSession, BrowserViewStorageScope.Ephemeral);
	}

	static getOrCreateAgent(instantiationService: IInstantiationService, viewId: string, affinity?: string): BrowserSession {
		const sessionId = `agent:${affinity || viewId}`;
		const electronSession = session.fromPartition(`vscode-browser-agent-${encodeURIComponent(affinity || viewId)}`);
		return BrowserSession._bySession.get(electronSession)
			?? instantiationService.createInstance(BrowserSession, sessionId, electronSession, BrowserViewStorageScope.Agent);
	}

	static async updateNetworkFiltering(): Promise<void> {
		const affectedSessions: BrowserSession[] = [];
		for (const [id, reference] of BrowserSession._byId) {
			const browserSession = reference.deref();
			if (!browserSession) {
				BrowserSession._byId.delete(id);
			} else if (browserSession.storageScope === BrowserViewStorageScope.Agent) {
				affectedSessions.push(browserSession);
			}
		}
		await Promise.all(affectedSessions.map(browserSession => browserSession.electronSession.closeAllConnections()));
	}

	static isAgentRequestAllowed(url: string, networkFilterService: IAgentNetworkFilterService): boolean {
		let uri: URI;
		try {
			uri = URI.parse(url);
		} catch {
			return false;
		}
		return !networkFilterService.isEnabled() || networkFilterService.isUriAllowed(uri);
	}

	static getOrCreate(
		instantiationService: IInstantiationService,
		viewId: string,
		sessionOptions: IBrowserSessionOptions,
		workspaceStorageHome: URI,
		workspaceId?: string,
		_hostWindowId?: number,
	): BrowserSession {
		switch (sessionOptions.scope) {
			case BrowserViewStorageScope.Global:
				return BrowserSession.getOrCreateGlobal(instantiationService);
			case BrowserViewStorageScope.Workspace:
				if (workspaceId) {
					return BrowserSession.getOrCreateWorkspace(instantiationService, workspaceId, workspaceStorageHome);
				}
				return BrowserSession.getOrCreateEphemeral(instantiationService, viewId);
			case BrowserViewStorageScope.Agent:
				return BrowserSession.getOrCreateAgent(instantiationService, viewId, sessionOptions.affinity);
			case BrowserViewStorageScope.Ephemeral:
			default:
				return BrowserSession.getOrCreateEphemeral(instantiationService, viewId);
		}
	}

	private static readonly _trustedFileRoots = TernarySearchTree.forPaths<true>(!isLinux);
	private static _trustAllFiles = false;

	static setTrustedFileRoots(roots: readonly string[], trustAllFiles: boolean): void {
		BrowserSession._trustAllFiles = trustAllFiles;
		BrowserSession._trustedFileRoots.clear();
		for (const root of roots) {
			if (root) {
				BrowserSession._trustedFileRoots.set(normalize(root), true);
			}
		}
	}



	private readonly _trust: BrowserSessionTrust;
	private readonly _history: BrowserSessionHistory;
	private readonly _remote: BrowserSessionRemote;
	private readonly _permissions: BrowserSessionPermissions;

	constructor(
		readonly id: string,
		readonly electronSession: Electron.Session,
		readonly storageScope: BrowserViewStorageScope,
		@IAgentNetworkFilterService private readonly agentNetworkFilterService: IAgentNetworkFilterService,
	) {
		this._trust = new BrowserSessionTrust(this);
		this._history = new BrowserSessionHistory(this);
		this._remote = new BrowserSessionRemote(this);
		this._permissions = new BrowserSessionPermissions(this);
		this.configure();
		BrowserSession.knownSessions.add(electronSession);
		BrowserSession._bySession.set(electronSession, this);
		BrowserSession._byId.set(id, new WeakRef(this));
		BrowserSession._finalizer.register(electronSession, id);
	}

	get trust(): IBrowserSessionTrust {
		return this._trust;
	}

	get history(): IBrowserSessionHistory {
		return this._history;
	}

	get remote(): IBrowserSessionRemote {
		return this._remote;
	}

	get permissions(): IBrowserSessionPermissions {
		return this._permissions;
	}

	connectStorage(storage: IApplicationStorageMainService): void {
		this._trust.connectStorage(storage);
		this._history.connectStorage(storage);
		this._permissions.connectStorage(storage);
	}

	private configure(): void {
		this._permissions.configure(this.electronSession);
		if (this.storageScope === BrowserViewStorageScope.Agent) {
			this.electronSession.webRequest.onBeforeRequest({
				urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']
			}, (details, callback) => {
				callback({ cancel: !BrowserSession.isAgentRequestAllowed(details.url, this.agentNetworkFilterService) });
			});
		}
		this.electronSession.registerPreloadScript({
			type: 'frame',
			filePath: FileAccess.asFileUri('vs/platform/browserView/electron-browser/preload-browserView.js').fsPath
		});
		this.electronSession.protocol.handle(Schemas.file, request => {
			const filePath = normalize(URI.parse(request.url).fsPath);
			if (!BrowserSession._trustAllFiles && !BrowserSession._trustedFileRoots.findSubstr(filePath)) {
				return new Response(localize('browserSession.untrustedFile', 'Forbidden. File does not reside within a trusted folder.'), { status: 403 });
			}
			return this.electronSession.fetch(request, { bypassCustomProtocolHandlers: true });
		});
	}

	async clearData(): Promise<void> {
		await this._trust.clear();
		this._history.delete();
		this._permissions.clear();
		await this.electronSession.clearData();
	}

}
