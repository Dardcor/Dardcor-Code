/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Barrier, DeferredPromise, disposableTimeout, raceCancellation } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IProcessPropertyMap, ITerminalChildProcess, ITerminalLaunchError, ITerminalLaunchResult, ITerminalLogService, ProcessPropertyType } from '../../../../platform/terminal/common/terminal.js';
import { IAgentConnection } from '../../../../platform/agentHost/common/agentService.js';
import { AGENT_HOST_SCHEME, fromAgentHostUri } from '../../../../platform/agentHost/common/agentHostUri.js';
import { ActionType, ActionEnvelope } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { TerminalClaimKind, type TerminalContentPart, type TerminalState } from '../../../../platform/agentHost/common/state/protocol/state.js';
import { IAgentSubscription } from '../../../../platform/agentHost/common/state/agentSubscription.js';
import { StateComponents } from '../../../../platform/agentHost/common/state/sessionState.js';
import { BasePty } from '../common/basePty.js';

export interface IAgentHostPtyOptions {
	readonly name?: string;
	readonly cwd?: URI;
	readonly attachOnly?: boolean;
}

export interface IAgentHostPtyCommandExecutedEvent {
	readonly commandId: string;
	readonly commandLine: string;
	readonly timestamp: number;
	readonly storedOutput?: string;
}

export interface IAgentHostPtyCommandFinishedEvent {
	readonly commandId: string;
	readonly exitCode?: number;
	readonly durationMs?: number;
}

export const enum AhpCommandMarkKind {
	Executed = 's',
	End = 'e'
}


export function getAhpCommandMarkId(commandId: string, kind: AhpCommandMarkKind): string {
	return `ahp-${commandId}-${kind}`;
}

function getAhpCommandMarkCode(commandId: string, kind: AhpCommandMarkKind): string {
	return `\x1b]633;SetMark;Id=${getAhpCommandMarkId(commandId, kind)};Hidden\x07`;
}

const COPILOT_SENTINEL_PREFIX = '<<<COPILOT_SENTINEL_';

function isCopilotSentinelCommand(commandLine: string): boolean {
	return commandLine.includes(COPILOT_SENTINEL_PREFIX);
}

export class AgentHostPty extends BasePty implements ITerminalChildProcess {

	private readonly _startBarrier = new Barrier();
	private readonly _lifetime = this._register(new CancellationTokenSource());
	private readonly _subscription = this._register(new MutableDisposable<DisposableStore>());
	private _terminalCreation: Promise<void> | undefined;
	private _initialCwd = '';
	private _didSignalReady = false;

	private readonly _onCommandExecuted = this._register(new Emitter<IAgentHostPtyCommandExecutedEvent>());
	readonly onCommandExecuted: Event<IAgentHostPtyCommandExecutedEvent> = this._onCommandExecuted.event;

	private readonly _onCommandFinished = this._register(new Emitter<IAgentHostPtyCommandFinishedEvent>());
	readonly onCommandFinished: Event<IAgentHostPtyCommandFinishedEvent> = this._onCommandFinished.event;

	private readonly _onSupportsCommandDetection = this._register(new Emitter<void>());
	readonly onSupportsCommandDetection: Event<void> = this._onSupportsCommandDetection.event;

	private _supportsCommandDetection = false;
	get supportsCommandDetection(): boolean { return this._supportsCommandDetection; }

	private readonly _suppressedCommandIds = new Set<string>();

	constructor(
		id: number,
		private _connection: IAgentConnection,
		private readonly _terminalUri: URI,
		private readonly _options: IAgentHostPtyOptions | undefined,
		private readonly _logService: ITerminalLogService,
	) {
		super(id, false);
	}

	async start(): Promise<ITerminalLaunchError | ITerminalLaunchResult | undefined> {
		const connection = this._connection;
		try {
			if (this._lifetime.token.isCancellationRequested) {
				return undefined;
			}

			if (!this._options?.attachOnly) {
				const terminalCreation = connection.createTerminal({
					channel: this._terminalUri.toString(),
					claim: { kind: TerminalClaimKind.Client, clientId: connection.clientId },
					name: this._options?.name,
					cwd: this._resolveCwdForProtocol(this._options?.cwd),
					cols: this._lastDimensions.cols > 0 ? this._lastDimensions.cols : undefined,
					rows: this._lastDimensions.rows > 0 ? this._lastDimensions.rows : undefined,
				});
				this._terminalCreation = terminalCreation;
				terminalCreation.then(
					() => this._clearTerminalCreation(terminalCreation),
					() => this._clearTerminalCreation(terminalCreation),
				);
				const created = await raceCancellation(terminalCreation.then(() => true), this._lifetime.token, false);
				if (!created) {
					return undefined;
				}
			}

			if (this._lifetime.token.isCancellationRequested || this._connection !== connection) {
				return undefined;
			}

			const { subscription, store } = this._createSubscription(this._connection);

			if (!await this._waitForHydration(subscription, store)) {
				return undefined;
			}
			if (this._lifetime.token.isCancellationRequested || this._subscription.value !== store) {
				return undefined;
			}

			const state = subscription.value as TerminalState;

			if (state.supportsCommandDetection) {
				this._supportsCommandDetection = true;
				this._onSupportsCommandDetection.fire();
			}
			this._replayContent(state.content);

			this._initialCwd = state.cwd?.toString() ?? '';
			this._properties.cwd = this._initialCwd;
			this._properties.initialCwd = this._initialCwd;
			if (state.title) {
				this._properties.title = state.title;
			}

			this._signalReady();

			store.add(subscription.onDidApplyAction(envelope => {
				this._handleAction(envelope);
			}));

			return undefined;
		} catch (err) {
			if (this._lifetime.token.isCancellationRequested || this._connection !== connection) {
				return undefined;
			}
			return { message: err instanceof Error ? err.message : String(err) };
		} finally {
			this._startBarrier.open();
		}
	}

	private _clearTerminalCreation(terminalCreation: Promise<void>): void {
		if (this._terminalCreation === terminalCreation) {
			this._terminalCreation = undefined;
		}
	}

	private _signalReady(): void {
		if (this._didSignalReady || this._lifetime.token.isCancellationRequested) {
			return;
		}
		this._didSignalReady = true;
		this.handleReady({ pid: -1, cwd: this._initialCwd, windowsPty: undefined });
	}

	private _handleAction(envelope: ActionEnvelope): void {
		if (this._lifetime.token.isCancellationRequested) {
			return;
		}
		const action = envelope.action;
		switch (action.type) {
			case ActionType.TerminalData:
				this.handleData(action.data);
				break;
			case ActionType.TerminalExited:
				this._exitAndDispose(action.exitCode);
				break;
			case ActionType.TerminalCwdChanged:
				this._properties.cwd = action.cwd.toString();
				this.handleDidChangeProperty({ type: ProcessPropertyType.Cwd, value: action.cwd.toString() });
				break;
			case ActionType.TerminalTitleChanged:
				this._properties.title = action.title;
				this.handleDidChangeProperty({ type: ProcessPropertyType.Title, value: action.title });
				break;
			case ActionType.TerminalResized:
				if (envelope.origin?.clientId !== this._connection.clientId) {
					this.handleDidChangeProperty({
						type: ProcessPropertyType.OverrideDimensions,
						value: { cols: action.cols, rows: action.rows },
					});
				}
				break;
			case ActionType.TerminalCommandDetectionAvailable:
				if (!this._supportsCommandDetection) {
					this._supportsCommandDetection = true;
					this._onSupportsCommandDetection.fire();
				}
				break;
			case ActionType.TerminalCommandExecuted:
				if (isCopilotSentinelCommand(action.commandLine)) {
					this._suppressedCommandIds.add(action.commandId);
					break;
				}
				this.handleData(getAhpCommandMarkCode(action.commandId, AhpCommandMarkKind.Executed));
				this._onCommandExecuted.fire({
					commandId: action.commandId,
					commandLine: action.commandLine,
					timestamp: action.timestamp,
				});
				break;
			case ActionType.TerminalCommandFinished:
				if (this._suppressedCommandIds.delete(action.commandId)) {
					break;
				}
				this.handleData(getAhpCommandMarkCode(action.commandId, AhpCommandMarkKind.End));
				this._onCommandFinished.fire({
					commandId: action.commandId,
					exitCode: action.exitCode,
					durationMs: action.durationMs,
				});
				break;
		}
	}

	private _replayContent(content: TerminalContentPart[]): void {
		for (const part of content) {
			if (part.type === 'unclassified') {
				if (part.value) {
					this.handleData(part.value);
				}
			} else if (part.type === 'command') {
				if (isCopilotSentinelCommand(part.commandLine)) {
					continue;
				}
				this.handleData(getAhpCommandMarkCode(part.commandId, AhpCommandMarkKind.Executed));
				this._onCommandExecuted.fire({
					commandId: part.commandId,
					commandLine: part.commandLine,
					timestamp: part.timestamp,
					storedOutput: part.output,
				});
				if (part.output) {
					this.handleData(part.output);
				}
				if (part.isComplete) {
					this.handleData(getAhpCommandMarkCode(part.commandId, AhpCommandMarkKind.End));
					this._onCommandFinished.fire({
						commandId: part.commandId,
						exitCode: part.exitCode,
						durationMs: part.durationMs,
					});
				}
			}
		}
	}

	private _resolveCwdForProtocol(cwd: URI | undefined): string | undefined {
		if (!cwd) {
			return undefined;
		}
		if (cwd.scheme === AGENT_HOST_SCHEME) {
			return fromAgentHostUri(cwd).toString();
		}
		return cwd.toString();
	}

	private _createSubscription(connection: IAgentConnection): { readonly subscription: IAgentSubscription<TerminalState>; readonly store: DisposableStore } {
		const store = new DisposableStore();
		try {
			const subscription = store.add(connection.getSubscription(StateComponents.Terminal, this._terminalUri, 'AgentHostPty')).object;
			this._subscription.value = store;
			return { subscription, store };
		} catch (error) {
			store.dispose();
			throw error;
		}
	}

	private async _waitForHydration(subscription: IAgentSubscription<TerminalState>, store: DisposableStore, timeoutMs?: number): Promise<boolean> {
		if (subscription.value !== undefined) {
			return true;
		}

		const hydration = new DeferredPromise<boolean>();
		const timeout = timeoutMs === undefined ? undefined : disposableTimeout(() => hydration.error(new Error('Reconnect hydration timed out')), timeoutMs, store);
		store.add(toDisposable(() => hydration.complete(false)));
		store.add(Event.once(subscription.onDidChange)(() => {
			timeout?.dispose();
			hydration.complete(true);
		}));
		return raceCancellation(hydration.p, this._lifetime.token, false);
	}

	input(data: string): void {
		if (this._inReplay || this._lifetime.token.isCancellationRequested) {
			return;
		}
		this._startBarrier.wait().then(() => {
			if (this._lifetime.token.isCancellationRequested) {
				return;
			}
			this._connection.dispatch(
				this._terminalUri.toString(),
				{ type: ActionType.TerminalInput, data },
			);
		});
	}

	resize(cols: number, rows: number): void {
		if (this._lifetime.token.isCancellationRequested || this._inReplay || (this._lastDimensions.cols === cols && this._lastDimensions.rows === rows)) {
			return;
		}
		this._lastDimensions.cols = cols;
		this._lastDimensions.rows = rows;
		this._startBarrier.wait().then(() => {
			if (this._lifetime.token.isCancellationRequested) {
				return;
			}
			this._connection.dispatch(
				this._terminalUri.toString(),
				{ type: ActionType.TerminalResized, cols, rows },
			);
		});
	}

	shutdown(_immediate: boolean): void {
		if (this._lifetime.token.isCancellationRequested) {
			return;
		}
		this._requestHostTerminalDisposal();
		this._exitAndDispose(undefined);
	}

	private _requestHostTerminalDisposal(): void {
		if (this._options?.attachOnly) {
			return;
		}

		this._disposeHostTerminal();
		if (this._terminalCreation) {
			void this._terminalCreation.then(
				() => this._disposeHostTerminal(),
				() => this._disposeHostTerminal(),
			);
		}
	}

	private _disposeHostTerminal(): void {
		try {
			void this._connection.disposeTerminal(this._terminalUri).catch(err => this._logHostDisposalError(err));
		} catch (err) {
			this._logHostDisposalError(err);
		}
	}

	private _logHostDisposalError(err: unknown): void {
		this._logService.warn(`[AgentHostPty] Failed to dispose host terminal: ${err instanceof Error ? err.message : String(err)}`);
	}

	private _exitAndDispose(exitCode: number | undefined): void {
		if (this._lifetime.token.isCancellationRequested) {
			return;
		}
		this._lifetime.cancel();
		this._subscription.clear();
		this._startBarrier.open();
		queueMicrotask(() => {
			this.handleExit(exitCode);
			this.dispose();
		});
	}

	override async getInitialCwd(): Promise<string> {
		return this._initialCwd;
	}

	override async getCwd(): Promise<string> {
		return this._properties.cwd || this._initialCwd;
	}

	async clearBuffer(): Promise<void> {
		if (this._lifetime.token.isCancellationRequested) {
			return;
		}
		this._connection.dispatch(
			this._terminalUri.toString(),
			{ type: ActionType.TerminalCleared },
		);
	}

	acknowledgeDataEvent(_charCount: number): void {
	}

	async setUnicodeVersion(_version: '6' | '11'): Promise<void> {
	}

	processBinary(_data: string): Promise<void> {
		return Promise.resolve();
	}

	sendSignal(_signal: string): void {
	}

	async refreshProperty<T extends ProcessPropertyType>(type: T): Promise<IProcessPropertyMap[T]> {
		return this._properties[type];
	}

	async updateProperty<T extends ProcessPropertyType>(_type: T, _value: IProcessPropertyMap[T]): Promise<void> {
	}

	async reconnect(newConnection: IAgentConnection): Promise<boolean> {
		if (this._lifetime.token.isCancellationRequested) {
			return false;
		}

		this._subscription.clear();
		this._connection = newConnection;
		let subscriptionStore: DisposableStore | undefined;

		try {
			const result = this._createSubscription(this._connection);
			const subscription = result.subscription;
			subscriptionStore = result.store;

			const RECONNECT_HYDRATE_TIMEOUT_MS = 10_000;
			if (!await this._waitForHydration(subscription, subscriptionStore, RECONNECT_HYDRATE_TIMEOUT_MS)) {
				return false;
			}
			if (this._lifetime.token.isCancellationRequested || this._subscription.value !== subscriptionStore) {
				return false;
			}

			const state = subscription.value as TerminalState;

			if (state.supportsCommandDetection && !this._supportsCommandDetection) {
				this._supportsCommandDetection = true;
				this._onSupportsCommandDetection.fire();
			}

			this.handleData('\x1b[2J\x1b[3J\x1b[H');
			this._replayContent(state.content);

			if (state.cwd) {
				this._properties.cwd = state.cwd.toString();
			}
			if (state.title) {
				this._properties.title = state.title;
			}
			this._signalReady();

			subscriptionStore.add(subscription.onDidApplyAction(envelope => {
				this._handleAction(envelope);
			}));

			return true;
		} catch (err) {
			if (!this._lifetime.token.isCancellationRequested) {
				this._logService.warn(`[AgentHostPty] Reconnection failed: ${err instanceof Error ? err.message : String(err)}`);
			}
			if (subscriptionStore && this._subscription.value === subscriptionStore) {
				this._subscription.clear();
			}
			if (!this._didSignalReady && !this._lifetime.token.isCancellationRequested) {
				this._requestHostTerminalDisposal();
				this._exitAndDispose(undefined);
			}
			return false;
		}
	}

	get terminalUri(): URI {
		return this._terminalUri;
	}

	override dispose(): void {
		this._lifetime.cancel();
		this._subscription.clear();
		super.dispose();
	}
}
