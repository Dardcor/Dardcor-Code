/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentInfo, McpServerStatus, PermissionMode, Query, SDKUserMessage, SlashCommand, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IReference, toDisposable } from '../../../../base/common/lifecycle.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { ClaudeRuntimeEffortLevel } from '../../common/claudeModelConfig.js';
import { AgentSignal } from '../../common/agent.js';
import type { IAgentHostClientTelemetryContext } from '../../common/agentHostTelemetry.js';
import { ISessionDatabase } from '../../common/sessionDataService.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { ClaudePromptQueue, IPendingSdkMessage } from './claudePromptQueue.js';
import { ClaudeSdkMessageRouter } from './claudeSdkMessageRouter.js';
import type { SubagentRegistry } from './claudeSubagentRegistry.js';

export interface IRematerializer {
	(reason: 'restart' | 'recover'): Promise<{ readonly warm: WarmQuery; readonly abortController: AbortController }>;
}

export interface ISdkResolvedCustomizations {
	readonly commands: readonly SlashCommand[];
	readonly agents: readonly AgentInfo[];
	readonly mcpServers: readonly McpServerStatus[];
	readonly plugins: readonly { readonly name: string; readonly path: string; readonly source?: string }[];
}

export class ClaudeSdkPipeline extends Disposable {
	async reloadPlugins(): Promise<void> {
		const query = await this._ensureQueryBound();
		await query.reloadPlugins();
	}

	async snapshotResolvedCustomizations(): Promise<ISdkResolvedCustomizations> {
		const query = await this._ensureQueryBound();
		const [commands, agents, mcpServers] = await Promise.all([
			query.supportedCommands(),
			query.supportedAgents(),
			query.mcpServerStatus(),
		]);
		return { commands, agents, mcpServers, plugins: this._initPlugins };
	}

	async startMcpServer(serverName: string): Promise<boolean> {
		const query = await this._ensureQueryBound();
		return this._applyMcpServerEnablement(query, serverName, true);
	}

	async stopMcpServer(serverName: string): Promise<boolean> {
		const query = await this._ensureQueryBound();
		return this._applyMcpServerEnablement(query, serverName, false);
	}

	async reconcileMcpServerEnablement(desired: ReadonlyMap<string, boolean>): Promise<boolean> {
		const query = await this._ensureQueryBound();
		const observed = new Map((await query.mcpServerStatus()).map(server => [server.name, server.status !== 'disabled']));
		for (const [serverName, enabled] of desired) {
			const current = observed.get(serverName);
			if (current === undefined || current === enabled) {
				continue;
			}
			if (!await this._applyMcpServerEnablement(query, serverName, enabled)) {
				return false;
			}
		}
		return true;
	}

	private async _applyMcpServerEnablement(query: Query, serverName: string, enabled: boolean): Promise<boolean> {
		if (!query.toggleMcpServer || (enabled && !query.reconnectMcpServer)) {
			return false;
		}
		await query.toggleMcpServer(serverName, enabled);
		if (enabled) {
			await query.reconnectMcpServer!(serverName);
		}
		return true;
	}

	private async _ensureQueryBound(): Promise<Query> {
		if (this._needsRebind) {
			await this._rebindQuery('recover');
		}
		if (!this._query) {
			this._bindWarmQuery();
			await this._replayCurrentConfig();
		}
		return this._query!;
	}

	private _bindWarmQuery(): Query {
		const query = this._warm.query(this._queue.iterable);
		this._query = query;
		return query;
	}

	private _query: Query | undefined;
	private _warm: WarmQuery;
	private _abortController: AbortController;

	private readonly _queue: ClaudePromptQueue;

	private _isResumed = false;

	private _initPlugins: readonly { readonly name: string; readonly path: string; readonly source?: string }[] = [];

	private _appliedModel: string | undefined;
	private _appliedEffort: ClaudeRuntimeEffortLevel | undefined;
	private _appliedPermissionMode: PermissionMode | undefined;

	private _currentModel: string | undefined;
	private _currentEffort: ClaudeRuntimeEffortLevel | undefined;
	private _currentPermissionMode: PermissionMode | undefined;

	private _rematerializer: IRematerializer | undefined;

	private _needsRebind = false;

	private _consumerLoopRunning = false;

	private readonly _onDidProduceSignal = this._register(new Emitter<AgentSignal>());
	readonly onDidProduceSignal: Event<AgentSignal> = this._onDidProduceSignal.event;

	private readonly _router: ClaudeSdkMessageRouter;

	constructor(
		readonly sessionId: string,
		readonly chatChannelUri: URI,
		resource: URI,
		warm: WarmQuery,
		abortController: AbortController,
		dbRef: IReference<ISessionDatabase>,
		subagents: SubagentRegistry,
		clientToolOwner: ((toolName: string) => string | undefined) | undefined = undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._warm = warm;
		this._abortController = abortController;
		this._wireAbortHandler(abortController);
		this._queue = this._register(instantiationService.createInstance(
			ClaudePromptQueue,
			sessionId,
			() => this._abortController.signal,
			(pendingId: string) => this._onDidProduceSignal.fire({
				kind: 'steering_consumed',
				chat: this.chatChannelUri,
				id: pendingId,
			}),
		));
		this._router = this._register(instantiationService.createInstance(
			ClaudeSdkMessageRouter, chatChannelUri, resource, dbRef, subagents, clientToolOwner,
		));
		this._register(this._router.onDidProduceSignal(s => this._onDidProduceSignal.fire(s)));
		this._register(toDisposable(() => this._abortController.abort()));
		this._register(toDisposable(() => {
			void Promise.resolve(this._warm[Symbol.asyncDispose]()).catch((err: unknown) =>
				this._logService.warn(`[ClaudeSdkPipeline] WarmQuery dispose failed: ${err}`));
		}));
	}

	get isResumed(): boolean { return this._isResumed; }

	get isAborted(): boolean { return this._abortController.signal.aborted; }

	get hasActiveTurn(): boolean { return !this._queue.isEmpty; }

	async shutdownAndWait(): Promise<void> {
		this._abortController.abort();
		try {
			await this._warm[Symbol.asyncDispose]();
			await this._query?.return(undefined);
		} catch (err) {
			this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] shutdownAndWait: teardown failed`, err);
		}
	}

	rebindForRestart(): Promise<void> {
		return this._rebindQuery('restart');
	}

	setClientToolOwner(clientToolOwner: ((toolName: string) => string | undefined) | undefined): void {
		this._router.setClientToolOwner(clientToolOwner);
	}

	attachRematerializer(rematerializer: IRematerializer): void {
		this._rematerializer = rematerializer;
	}

	seedCurrentConfig(model: string | undefined, effort: ClaudeRuntimeEffortLevel | undefined, permissionMode: PermissionMode | undefined): void {
		this._currentModel = model;
		this._currentEffort = effort;
		this._currentPermissionMode = permissionMode;
		this._appliedModel = model;
		this._appliedEffort = effort;
		this._appliedPermissionMode = permissionMode;
	}

	async setModel(model: string): Promise<void> {
		this._currentModel = model;
		if (this._query && !this._needsRebind && model !== this._appliedModel) {
			try {
				await this._query.setModel(model);
				this._appliedModel = model;
			} catch (err) {
				this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] setModel failed: ${err}`);
			}
		}
	}

	async setEffort(effort: ClaudeRuntimeEffortLevel | undefined): Promise<void> {
		this._currentEffort = effort;
		if (this._query && !this._needsRebind && effort !== this._appliedEffort) {
			try {
				await this._query.applyFlagSettings({ effortLevel: effort ?? null });
				this._appliedEffort = effort;
			} catch (err) {
				this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] setEffort failed: ${err}`);
			}
		}
	}

	bufferConfigForRebind(model: string, effort: ClaudeRuntimeEffortLevel | undefined): void {
		this._currentModel = model;
		this._currentEffort = effort;
	}

	async send(prompt: SDKUserMessage, turnId: string, clientContext?: IAgentHostClientTelemetryContext): Promise<void> {
		if (this._needsRebind) {
			await this._rebindQuery('recover');
		}
		if (this._abortController.signal.aborted) {
			throw new CancellationError();
		}
		if (!this._query) {
			this._bindWarmQuery();
			await this._replayCurrentConfig();
		}
		this._ensureConsumerLoop();
		const entry: IPendingSdkMessage = {
			sdkMessage: prompt,
			sdkUuid: typeof prompt.uuid === 'string' ? prompt.uuid : turnId,
			turnId,
			clientContext,
			stopWatch: StopWatch.create(false),
			deferred: new DeferredPromise<void>(),
		};
		return this._queue.push(entry);
	}

	injectSteering(prompt: SDKUserMessage, pendingMessageId: string): void {
		if (this._abortController.signal.aborted) {
			this._logService.warn(`[Claude:${this.sessionId}] injectSteering: dropped (controller aborted) id=${pendingMessageId}`);
			return;
		}
		const parent = this._queue.peekParent();
		if (!parent) {
			this._logService.warn(`[Claude:${this.sessionId}] injectSteering: dropped (no in-flight turn) id=${pendingMessageId}`);
			return;
		}
		const sdkUuid = typeof prompt.uuid === 'string' ? prompt.uuid : pendingMessageId;
		this._queue.push({
			sdkMessage: prompt,
			sdkUuid,
			turnId: parent.turnId,
			clientContext: parent.clientContext,
			stopWatch: parent.stopWatch,
			deferred: new DeferredPromise<void>(),
			steeringPendingId: pendingMessageId,
		}).catch(() => { });
		this._logService.info(`[Claude:${this.sessionId}] injectSteering: enqueued id=${pendingMessageId} sdkUuid=${sdkUuid}`);
	}

	abort(): void {
		if (this._abortController.signal.aborted) {
			return;
		}
		this._abortController.abort();
		this._queue.failAll(new CancellationError());
		this._needsRebind = true;
	}

	async setPermissionMode(mode: PermissionMode): Promise<void> {
		this._currentPermissionMode = mode;
		if (this._query && !this._needsRebind && mode !== this._appliedPermissionMode) {
			await this._query.setPermissionMode(mode);
			this._appliedPermissionMode = mode;
		}
	}

	private _wireAbortHandler(controller: AbortController): void {
		controller.signal.addEventListener('abort', () => {
			this._queue.notifyAborted();
		}, { once: true });
	}

	private _ensureConsumerLoop(): void {
		if (this._consumerLoopRunning) {
			return;
		}
		this._consumerLoopRunning = true;
		this._runConsumerLoop();
	}

	private _runConsumerLoop(): void {
		const boundQuery = this._query;
		void this._processMessages()
			.catch(err => this._logService.error(`[ClaudeSdkPipeline:${this.sessionId}] _processMessages crashed: ${err}`))
			.finally(() => {
				if (!this._store.isDisposed && this._query && this._query !== boundQuery) {
					this._runConsumerLoop();
				} else {
					this._consumerLoopRunning = false;
				}
			});
	}

	private async _replayCurrentConfig(): Promise<void> {
		try {
			if (this._currentModel !== undefined && this._currentModel !== this._appliedModel) {
				await this._query?.setModel(this._currentModel);
				this._appliedModel = this._currentModel;
			}
			if (this._currentEffort !== undefined && this._currentEffort !== this._appliedEffort) {
				await this._query?.applyFlagSettings({ effortLevel: this._currentEffort });
				this._appliedEffort = this._currentEffort;
			}
			if (this._currentPermissionMode !== undefined && this._currentPermissionMode !== this._appliedPermissionMode) {
				await this._query?.setPermissionMode(this._currentPermissionMode);
				this._appliedPermissionMode = this._currentPermissionMode;
			}
		} catch (err) {
			this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] _replayCurrentConfig failed: ${err}`);
		}
	}

	private async _rebindQuery(reason: 'restart' | 'recover'): Promise<void> {
		if (!this._rematerializer) {
			throw new Error(`ClaudeSdkPipeline.rebind: no rematerializer attached (reason=${reason})`);
		}
		const oldWarm = this._warm;
		const placeholder = new AbortController();
		this._abortController = placeholder;
		const built = await this._rematerializer(reason);
		if (this._store.isDisposed) {
			built.abortController.abort();
			void Promise.resolve(built.warm[Symbol.asyncDispose]()).catch((err: unknown) =>
				this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] rebind-after-dispose: warm dispose failed: ${err}`));
			throw new CancellationError();
		}
		if (placeholder.signal.aborted) {
			built.abortController.abort();
			void Promise.resolve(built.warm[Symbol.asyncDispose]()).catch((err: unknown) =>
				this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] rebind-aborted: warm dispose failed: ${err}`));
			void Promise.resolve(oldWarm[Symbol.asyncDispose]()).catch((err: unknown) =>
				this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] previous WarmQuery dispose failed during aborted rebind: ${err}`));
			this._queue.failAll(new CancellationError());
			this._needsRebind = true;
			throw new CancellationError();
		}
		void Promise.resolve(oldWarm[Symbol.asyncDispose]()).catch((err: unknown) =>
			this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] previous WarmQuery dispose failed during rebind: ${err}`));
		this._warm = built.warm;
		this._abortController = built.abortController;
		this._wireAbortHandler(built.abortController);
		this._queue.resetForRebind();
		this._needsRebind = false;
		this._appliedModel = undefined;
		this._appliedEffort = undefined;
		this._appliedPermissionMode = undefined;
		this._bindWarmQuery();
		await this._replayCurrentConfig();
	}

	private async _processMessages(): Promise<void> {
		const query = this._query;
		if (!query) {
			throw new Error('ClaudeSdkPipeline._processMessages called before query was bound');
		}
		try {
			for await (const message of query) {
				if (this._abortController.signal.aborted) {
					throw new CancellationError();
				}
				if (message.type === 'system' && message.subtype === 'init') {
					this._initPlugins = message.plugins ?? [];
					if (!this._isResumed) {
						this._isResumed = true;
					}
				}
				const parent = this._queue.peekParent();
				const turnId = parent?.turnId;
				const clientContext = parent?.clientContext;
				const turnDuration = parent?.stopWatch.elapsed();
				try {
					await this._router.handle(message, turnId, {
						turnDuration,
						mode: this._currentPermissionMode,
						clientContext,
					});
				} catch (handlerErr) {
					this._logService.warn(`[ClaudeSdkPipeline:${this.sessionId}] router threw, skipping: ${handlerErr}`);
				}
				if (message.type === 'result') {
					const completed = this._queue.settleHead();
					this._logService.info(`[Claude:${this.sessionId}] result for sdkUuid=${completed?.sdkUuid}`);
					if (completed && this._queue.isEmpty) {
						this._onDidProduceSignal.fire({
							kind: 'action',
							resource: this.chatChannelUri,
							action: {
								type: ActionType.ChatTurnComplete,
								turnId: completed.turnId,
								duration: Math.max(0, completed.stopWatch.elapsed()),
							},
						});
					}
				}
			}
			if (this._abortController.signal.aborted) {
				throw new CancellationError();
			}
			if (this._query !== query) {
				return;
			}
			throw new Error('Claude SDK stream ended without a result message');
		} catch (err) {
			const fatal = err instanceof Error ? err : new Error(String(err));
			if (this._query === query) {
				this._queue.failAll(fatal);
				this._needsRebind = true;
			}
			if (!isCancellationError(fatal)) {
				throw fatal;
			}
		}
	}
}
