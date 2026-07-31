/**
 * Dardcor Code - dc.debug API Bridge (Task 610)
 * Mirrors: vs/workbench/api/common/extHostDebugService.ts
 */

import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol';
import { WorkspaceFolder } from './ext-host-workspace';

export interface DebugConfiguration {
	type: string;
	name: string;
	request: string;
	[key: string]: any;
}

export interface IDebugConfigurationProvider {
	provideDebugConfigurations?(folder: WorkspaceFolder | undefined, token?: any): DebugConfiguration[] | Promise<DebugConfiguration[]>;
	resolveDebugConfiguration?(folder: WorkspaceFolder | undefined, debugConfiguration: DebugConfiguration, token?: any): DebugConfiguration | undefined | Promise<DebugConfiguration | undefined>;
	resolveDebugConfigurationWithSubstitutedVariables?(folder: WorkspaceFolder | undefined, debugConfiguration: DebugConfiguration, token?: any): DebugConfiguration | undefined | Promise<DebugConfiguration | undefined>;
}

export interface DebugSession {
	readonly id: string;
	readonly type: string;
	readonly name: string;
	readonly workspaceFolder: WorkspaceFolder | undefined;
	readonly configuration: DebugConfiguration;
	customRequest(command: string, args?: any): Promise<any>;
	getDebugProtocolBreakpoint(breakpoint: unknown): Promise<unknown | undefined>;
}

export interface DebugAdapterExecutable {
	command: string;
	args?: string[];
	options?: { cwd?: string; env?: Record<string, string> };
}

export interface DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(session: DebugSession, executable?: DebugAdapterExecutable): DebugAdapterExecutable | undefined | Promise<DebugAdapterExecutable | undefined>;
}

export interface IDebugApi {
	registerDebugConfigurationProvider(type: string, provider: IDebugConfigurationProvider): IDisposable;
	registerDebugAdapterDescriptorFactory(type: string, factory: DebugAdapterDescriptorFactory): IDisposable;
	startDebugging(folder: WorkspaceFolder | undefined, nameOrConfiguration: string | DebugConfiguration, parentSessionOrOptions?: DebugSession | { parentSession?: DebugSession; consoleMode?: string; noDebug?: boolean }): Promise<boolean>;
	readonly activeDebugSession: DebugSession | undefined;
	readonly activeDebugConsole: { append(value: string): void; appendLine(value: string): void };
	readonly breakpoints: readonly unknown[];
	readonly onDidStartDebugSession: Event<DebugSession>;
	readonly onDidTerminateDebugSession: Event<DebugSession>;
	readonly onDidChangeActiveDebugSession: Event<DebugSession | undefined>;
	readonly onDidReceiveDebugSessionCustomEvent: Event<{ event: string; session: DebugSession; body?: any }>;
	readonly onDidChangeBreakpoints: Event<{ added: readonly unknown[]; removed: readonly unknown[]; changed: readonly unknown[] }>;
}

/**
 * Debug service bridge. Configuration providers and adapter descriptor
 * factories execute here; `startDebugging` launches the session on the
 * main side.
 */
export class ExtHostDebugService extends Disposable {
	private _nextProviderId = 1;
	private readonly _configurationProviders = new Map<number, { type: string; provider: IDebugConfigurationProvider }>();
	private readonly _adapterFactories = new Map<number, { type: string; factory: DebugAdapterDescriptorFactory }>();
	private _activeSession: DebugSession | undefined;

	private readonly _onDidStartDebugSession = this._register(new Emitter<DebugSession>());
	readonly onDidStartDebugSession: Event<DebugSession> = this._onDidStartDebugSession.event;

	private readonly _onDidTerminateDebugSession = this._register(new Emitter<DebugSession>());
	readonly onDidTerminateDebugSession: Event<DebugSession> = this._onDidTerminateDebugSession.event;

	private readonly _onDidChangeActiveDebugSession = this._register(new Emitter<DebugSession | undefined>());
	readonly onDidChangeActiveDebugSession: Event<DebugSession | undefined> = this._onDidChangeActiveDebugSession.event;

	private readonly _onDidReceiveDebugSessionCustomEvent = this._register(new Emitter<{ event: string; session: DebugSession; body?: any }>());
	readonly onDidReceiveDebugSessionCustomEvent: Event<{ event: string; session: DebugSession; body?: any }> = this._onDidReceiveDebugSessionCustomEvent.event;

	private readonly _onDidChangeBreakpoints = this._register(new Emitter<{ added: readonly unknown[]; removed: readonly unknown[]; changed: readonly unknown[] }>());
	readonly onDidChangeBreakpoints: Event<{ added: readonly unknown[]; removed: readonly unknown[]; changed: readonly unknown[] }> = this._onDidChangeBreakpoints.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
		this._register(this._rpc.onEvent('debug', 'started')((payload: { session: any }) => {
			this._onDidStartDebugSession.fire(payload.session as DebugSession);
		}));
		this._register(this._rpc.onEvent('debug', 'terminated')((payload: { session: any }) => {
			this._onDidTerminateDebugSession.fire(payload.session as DebugSession);
			if (this._activeSession?.id === payload.session?.id) {
				this._setActiveSession(undefined);
			}
		}));
		this._register(this._rpc.onEvent('debug', 'active')((payload: { session: any }) => {
			this._setActiveSession(payload.session as DebugSession | undefined);
		}));
		this._register(this._rpc.onEvent('debug', 'customEvent')((payload: { event: string; session: any; body?: any }) => {
			this._onDidReceiveDebugSessionCustomEvent.fire({ event: payload.event, session: payload.session as DebugSession, body: payload.body });
		}));
	}

	public registerDebugConfigurationProvider(type: string, provider: IDebugConfigurationProvider): IDisposable {
		const id = this._nextProviderId++;
		this._configurationProviders.set(id, { type, provider });
		this._rpc.notify('main', 'debug.registerConfigurationProvider', { id, type });
		return toDisposable(() => this._configurationProviders.delete(id));
	}

	public registerDebugAdapterDescriptorFactory(type: string, factory: DebugAdapterDescriptorFactory): IDisposable {
		const id = this._nextProviderId++;
		this._adapterFactories.set(id, { type, factory });
		this._rpc.notify('main', 'debug.registerAdapterFactory', { id, type });
		return toDisposable(() => this._adapterFactories.delete(id));
	}

	public startDebugging(folder: WorkspaceFolder | undefined, nameOrConfiguration: string | DebugConfiguration, options?: any): Promise<boolean> {
		return this._rpc.call<boolean>('main', 'debug.startDebugging', {
			folderUri: folder?.uri.toString(),
			name: typeof nameOrConfiguration === 'string' ? nameOrConfiguration : undefined,
			configuration: typeof nameOrConfiguration === 'object' ? nameOrConfiguration : undefined,
			options
		});
	}

	public get activeDebugSession(): DebugSession | undefined {
		return this._activeSession;
	}

	public get api(): IDebugApi {
		const self = this;
		return {
			registerDebugConfigurationProvider: (type: string, provider: IDebugConfigurationProvider) => this.registerDebugConfigurationProvider(type, provider),
			registerDebugAdapterDescriptorFactory: (type: string, factory: DebugAdapterDescriptorFactory) => this.registerDebugAdapterDescriptorFactory(type, factory),
			startDebugging: (folder: WorkspaceFolder | undefined, nameOrConfiguration: string | DebugConfiguration, options?: any) => this.startDebugging(folder, nameOrConfiguration, options),
			get activeDebugSession() {
				return self._activeSession;
			},
			get activeDebugConsole() {
				return {
					append: (value: string) => self._rpc.notify('main', 'debug.console.append', { value }),
					appendLine: (value: string) => self._rpc.notify('main', 'debug.console.appendLine', { value })
				};
			},
			get breakpoints() {
				return [];
			},
			onDidStartDebugSession: this.onDidStartDebugSession,
			onDidTerminateDebugSession: this.onDidTerminateDebugSession,
			onDidChangeActiveDebugSession: this.onDidChangeActiveDebugSession,
			onDidReceiveDebugSessionCustomEvent: this.onDidReceiveDebugSessionCustomEvent,
			onDidChangeBreakpoints: this.onDidChangeBreakpoints
		};
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$resolveDebugConfiguration': {
						const registration = [...this._configurationProviders.values()].find(r => r.type === payload.type);
						if (!registration) {
							return payload.configuration;
						}
						const folder = payload.folderUri ? new WorkspaceFolder({ uri: payload.folderUri, name: '', index: 0 }) : undefined;
						const provider = registration.provider;
						if (provider.resolveDebugConfiguration) {
							return provider.resolveDebugConfiguration(folder, payload.configuration);
						}
						return payload.configuration;
					}
					case '$provideDebugConfigurations': {
						const registration = [...this._configurationProviders.values()].find(r => r.type === payload.type);
						if (!registration?.provider.provideDebugConfigurations) {
							return [];
						}
						const folder = payload.folderUri ? new WorkspaceFolder({ uri: payload.folderUri, name: '', index: 0 }) : undefined;
						return registration.provider.provideDebugConfigurations(folder);
					}
					case '$createDebugAdapter': {
						const registration = [...this._adapterFactories.values()].find(r => r.type === payload.type);
						if (!registration?.factory.createDebugAdapterDescriptor) {
							return undefined;
						}
						const session = payload.session as DebugSession;
						return registration.factory.createDebugAdapterDescriptor(session, payload.executable);
					}
					default:
						throw new Error(`Perintah debug tidak dikenal: ${command}`);
				}
			}
		};
	}

	private _setActiveSession(session: DebugSession | undefined): void {
		if (session?.id !== this._activeSession?.id) {
			this._activeSession = session;
			this._onDidChangeActiveDebugSession.fire(session);
		}
	}
}
