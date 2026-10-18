/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable, observableValue, transaction } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IAgentConnection } from '../../../../platform/agentHost/common/agentService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ITerminalLogService } from '../../../../platform/terminal/common/terminal.js';
import { AgentHostPty } from './agentHostPty.js';
import { AgentHostOutputChannel } from './agentHostOutputChannel.js';
import { AhpTerminalCommandSource } from './ahpTerminalCommandSource.js';
import { ITerminalChatService, ITerminalInstance, ITerminalLocationOptions, ITerminalService } from './terminal.js';
import { ITerminalProfileProvider, ITerminalProfileService } from '../common/terminal.js';

export interface IAgentHostTerminalCreateOptions {
	readonly name?: string;
	readonly cwd?: URI;
	readonly location?: ITerminalLocationOptions;
}

export interface IAgentHostEntry {
	readonly name: string;
	readonly address: string;
	readonly getConnection: () => IAgentConnection | undefined;
}

export interface IAgentHostTerminalProfileInfo {
	readonly extensionIdentifier: string;
	readonly profileId: string;
	readonly title: string;
	readonly address: string;
}

const AGENT_HOST_PROFILE_EXT_ID = 'vscode.agent-host-terminal';

export const IAgentHostTerminalService = createDecorator<IAgentHostTerminalService>('agentHostTerminalService');

export interface IAgentHostTerminalService {
	readonly _serviceBrand: undefined;

	readonly profiles: IObservable<readonly IAgentHostTerminalProfileInfo[]>;

	getProfileForConnection(address: string): IAgentHostTerminalProfileInfo | undefined;

	registerEntry(entry: IAgentHostEntry): IDisposable;

	createTerminal(connection: IAgentConnection, options?: IAgentHostTerminalCreateOptions): Promise<ITerminalInstance>;

	createTerminalForEntry(address: string, options?: IAgentHostTerminalCreateOptions): Promise<ITerminalInstance | undefined>;

	reconnectTerminals(newConnection: IAgentConnection, oldClientId: string): Promise<{ recovered: number; total: number }>;

	reviveTerminal(connection: IAgentConnection, terminalUri: URI, terminalToolSessionId: string): Promise<ITerminalInstance>;

	attachOutputTerminal(connection: IAgentConnection, terminalUri: URI, terminalToolSessionId: string): IDisposable;

	setDefaultCwd(cwd: URI | undefined): void;
}

export class AgentHostTerminalService extends Disposable implements IAgentHostTerminalService {
	declare readonly _serviceBrand: undefined;

	private readonly _entries: IAgentHostEntry[] = [];
	private readonly _usedHosts = new Set<string>();
	private readonly _profileRegistrations = this._register(new DisposableMap<string>());
	private readonly _profiles = observableValue<readonly IAgentHostTerminalProfileInfo[]>('agentHostTerminalProfiles', []);
	readonly profiles: IObservable<readonly IAgentHostTerminalProfileInfo[]> = this._profiles;

	private _defaultCwd: URI | undefined;

	private readonly _revivedInstances = new Map<string, ITerminalInstance>();
	private readonly _activePtys = new Map<string, { pty: AgentHostPty; clientId: string }>();
	private readonly _pendingRevives = new Map<string, Promise<ITerminalInstance>>();

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ITerminalChatService private readonly _terminalChatService: ITerminalChatService,
		@ITerminalProfileService private readonly _terminalProfileService: ITerminalProfileService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@ITerminalLogService private readonly _logService: ITerminalLogService,
	) {
		super();
	}


	registerEntry(entry: IAgentHostEntry): IDisposable {
		this._entries.push(entry);
		this._reconcile();
		return toDisposable(() => {
			const idx = this._entries.indexOf(entry);
			if (idx >= 0) {
				this._entries.splice(idx, 1);
				this._reconcile();
			}
		});
	}

	getProfileForConnection(address: string): IAgentHostTerminalProfileInfo | undefined {
		const entry = this._entries.find(e => e.address === address);
		if (!entry) {
			return undefined;
		}
		if (!this._profileRegistrations.has(address)) {
			this._usedHosts.add(address);
			this._reconcile();
		}
		return this._profiles.get().find(p => p.address === address);
	}

	setDefaultCwd(cwd: URI | undefined): void {
		this._defaultCwd = cwd;
	}

	private _reconcile(): void {
		const entries = this._entries;
		const desiredProfiles = new Map<string, IAgentHostEntry>();

		if (entries.length === 0) {
		} else if (entries.length === 1) {
			desiredProfiles.set(entries[0].address, entries[0]);
		} else {
			let displaying = 0;
			for (const address of this._usedHosts) {
				const entry = entries.find(e => e.address === address);
				if (entry) {
					displaying++;
					desiredProfiles.set(entry.address, entry);
				}
			}
			if (displaying === entries.length - 1) {
				const missing = entries.find(e => !this._usedHosts.has(e.address));
				if (missing) {
					desiredProfiles.set(missing.address, missing);
				}
			} else if (displaying < entries.length) {
				desiredProfiles.set('__quickpick__', {
					name: localize('agentHostTerminal.pick', "Agent Host\u2026"),
					address: '__quickpick__',
					getConnection: () => undefined,
				});
			}
		}

		for (const [key, entry] of desiredProfiles) {
			if (!this._profileRegistrations.has(key)) {
				this._registerProfile(key, entry, entries);
			}
		}
		for (const key of this._profileRegistrations.keys()) {
			if (!desiredProfiles.has(key)) {
				this._profileRegistrations.deleteAndDispose(key);
			}
		}

		const infos: IAgentHostTerminalProfileInfo[] = [];
		for (const [key] of desiredProfiles) {
			infos.push({
				extensionIdentifier: AGENT_HOST_PROFILE_EXT_ID,
				profileId: key,
				title: key === '__quickpick__'
					? localize('agentHostTerminal.pick', "Agent Host\u2026")
					: localize('agentHostTerminal.profileName', "Agent Host ({0})", desiredProfiles.get(key)!.name),
				address: key,
			});
		}
		transaction(tx => { this._profiles.set(infos, tx); });
	}

	private _registerProfile(key: string, entry: IAgentHostEntry, allEntries: IAgentHostEntry[]): void {
		const provider: ITerminalProfileProvider = {
			createContributedTerminalProfile: async (options) => {
				let connection: IAgentConnection | undefined;
				let displayName = entry.name;

				if (key === '__quickpick__') {
					const picks: (IQuickPickItem & { address: string; hostName: string })[] = allEntries.map(e => ({
						label: localize('agentHostTerminal.profileName', "Agent Host ({0})", e.name),
						address: e.address,
						hostName: e.name,
					}));
					const pick = await this._quickInputService.pick(picks, {
						placeHolder: localize('agentHostTerminal.pickHost', "Select an agent host to open a terminal on"),
					});
					if (!pick) {
						return;
					}
					this._usedHosts.add(pick.address);
					this._reconcile();
					displayName = pick.hostName;
					connection = allEntries.find(e => e.address === pick.address)?.getConnection();
				} else {
					connection = entry.getConnection();
				}

				if (!connection) {
					return;
				}

				await this.createTerminal(connection, {
					name: localize('agentHostTerminal.profileName', "Agent Host ({0})", displayName),
					cwd: options.cwd ? (typeof options.cwd === 'string' ? URI.file(options.cwd) : options.cwd) : this._defaultCwd,
					location: options.location,
				});
			},
		};

		const title = key === '__quickpick__'
			? localize('agentHostTerminal.pick', "Agent Host\u2026")
			: localize('agentHostTerminal.profileName', "Agent Host ({0})", entry.name);

		const store = new DisposableStore();
		store.add(this._terminalProfileService.registerTerminalProfileProvider(
			AGENT_HOST_PROFILE_EXT_ID,
			key,
			provider,
		));
		store.add(this._terminalProfileService.registerInternalContributedProfile({
			extensionIdentifier: AGENT_HOST_PROFILE_EXT_ID,
			id: key,
			title,
			icon: 'remote',
		}));
		this._profileRegistrations.set(key, store);
	}


	async createTerminalForEntry(address: string, options?: IAgentHostTerminalCreateOptions): Promise<ITerminalInstance | undefined> {
		const entry = this._entries.find(e => e.address === address);
		if (!entry) {
			return undefined;
		}
		const connection = entry.getConnection();
		if (!connection) {
			return undefined;
		}
		return this.createTerminal(connection, options);
	}

	async createTerminal(connection: IAgentConnection, options?: IAgentHostTerminalCreateOptions): Promise<ITerminalInstance> {
		const terminalUri = URI.from({ scheme: 'agenthost-terminal', path: `/${generateUuid()}` });
		const name = options?.name ?? localize('agentHostTerminal.default', "Agent Host Terminal");
		const key = terminalUri.toString();

		const instance = await this._terminalService.createTerminal({
			config: {
				customPtyImplementation: (id, cols, rows) => {
					const pty = new AgentHostPty(id, connection, terminalUri, {
						name,
						cwd: options?.cwd,
					}, this._logService);
					if (cols > 0 && rows > 0) {
						pty.resize(cols, rows);
					}
					this._activePtys.set(key, { pty, clientId: connection.clientId });
					return pty;
				},
				name,
				icon: { id: 'remote' },
				isFeatureTerminal: false,
			},
			location: options?.location,
		});

		this._register(instance.onDisposed(() => {
			this._activePtys.delete(key);
		}));

		return instance;
	}

	async reviveTerminal(connection: IAgentConnection, terminalUri: URI, terminalToolSessionId: string): Promise<ITerminalInstance> {
		const key = terminalUri.toString();
		const pending = this._pendingRevives.get(key);
		if (pending) {
			return pending;
		}
		const revive = this._doReviveTerminal(connection, terminalUri, terminalToolSessionId, key).finally(() => {
			if (this._pendingRevives.get(key) === revive) {
				this._pendingRevives.delete(key);
			}
		});
		this._pendingRevives.set(key, revive);
		return revive;
	}

	attachOutputTerminal(connection: IAgentConnection, terminalUri: URI, terminalToolSessionId: string): IDisposable {
		const store = new DisposableStore();
		const source = store.add(new AgentHostOutputChannel(connection, terminalUri));
		store.add(this._terminalChatService.registerOutputSource(terminalToolSessionId, source));
		return store;
	}

	private async _doReviveTerminal(connection: IAgentConnection, terminalUri: URI, terminalToolSessionId: string, key: string): Promise<ITerminalInstance> {
		const existing = this._revivedInstances.get(key);
		if (existing) {
			return existing;
		}
		const store = new DisposableStore();
		const commandSource = store.add(new AhpTerminalCommandSource());

		const instancePromise = Promise.resolve().then(() => this._terminalService.createTerminal({
			config: {
				customPtyImplementation: (id, cols, rows) => {
					const pty = new AgentHostPty(id, connection, terminalUri, {
						name: '<terminal>',
						attachOnly: true,
					}, this._logService);
					if (cols > 0 && rows > 0) {
						pty.resize(cols, rows);
					}

					if (!store.isDisposed) {
						commandSource.connect(instance, pty);
					}

					this._activePtys.set(key, { pty, clientId: connection.clientId });
					return pty;
				},
				name: localize('agentHostTerminal.tool', "Agent Host Terminal"),
				isFeatureTerminal: true,
				hideFromUser: true,
			},
		}));
		store.add(this._terminalChatService.registerAhpCommandSource(terminalToolSessionId, commandSource, instancePromise));
		let instance: ITerminalInstance;
		try {
			instance = await instancePromise;
		} catch (error) {
			store.dispose();
			throw error;
		}
		this._terminalChatService.registerTerminalInstanceWithToolSession(terminalToolSessionId, instance);

		this._revivedInstances.set(key, instance);
		instance.store.add(store);
		this._register(instance.onDisposed(() => {
			this._revivedInstances.delete(key);
			this._activePtys.delete(key);
		}));

		return instance;
	}

	async reconnectTerminals(newConnection: IAgentConnection, oldClientId: string): Promise<{ recovered: number; total: number }> {
		const entries = [...this._activePtys.entries()].filter(
			([, entry]) => entry.clientId === oldClientId
		);
		const total = entries.length;
		let recovered = 0;
		const promises: Promise<void>[] = [];
		for (const [key, entry] of entries) {
			promises.push(
				entry.pty.reconnect(newConnection).then(success => {
					if (success) {
						recovered++;
						entry.clientId = newConnection.clientId;
					} else {
						console.warn(`[AgentHostTerminalService] Failed to reconnect terminal: ${key}`);
					}
				})
			);
		}
		await Promise.all(promises);
		return { recovered, total };
	}
}
