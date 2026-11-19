/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EffortLevel, McpServerConfig, Options, PermissionMode, Query, SDKUserMessage, SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IChatDebugFileLoggerService } from '../../../../platform/chat/common/chatDebugFileLoggerService';
import { INativeEnvService } from '../../../../platform/env/common/envService';
import { IGitService } from '../../../../platform/git/common/gitService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IMcpService } from '../../../../platform/mcp/common/mcpService';
import { IOTelService, type ISpanHandle, SpanStatusCode, type TraceContext } from '../../../../platform/otel/common/index';
import { deriveClaudeOTelEnv } from '../../../../platform/otel/common/agentOTelEnv';
import { extractToolParameters } from '../../../../platform/otel/node/extractToolParameters';
import { CapturingToken } from '../../../../platform/requestLogger/common/capturingToken';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { DeferredPromise } from '../../../../util/dardcor/base/common/async';
import { Disposable, DisposableMap } from '../../../../util/dardcor/base/common/lifecycle';
import { isWindows } from '../../../../util/dardcor/base/common/platform';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { LanguageModelToolMCPSource } from '../../../../dardcorTypes';
import { IClaudePluginService } from './claudeSkills';
import { ExternalEditTracker } from '../../common/externalEditTracker';
import { resolveAppModulePathSync } from '../../../common/node/appNodeModules';
import { buildMcpServersFromRegistry } from '../common/claudeMcpServerRegistry';
import { dispatchMessage, ClaudeProxyError, KnownClaudeError } from '../common/claudeMessageDispatch';
import { IClaudeRuntimeDataService } from '../common/claudeRuntimeDataService';
import { ClaudeSessionUri } from '../common/claudeSessionUri';
import { IClaudeToolPermissionService } from '../common/claudeToolPermissionService';
import { IClaudePlanFileTracker } from '../common/claudePlanFileTracker';
import { IClaudeCodeSdkService } from './claudeCodeSdkService';
import { ClaudeLanguageModelServer } from './claudeLanguageModelServer';
import { resolvePromptToContentBlocks } from './claudePromptResolver';
import { ClaudeSettingsChangeTracker } from './claudeSettingsChangeTracker';
import { ParsedClaudeModelId } from '../common/claudeModelId';
import { IClaudeSessionStateService } from '../common/claudeSessionStateService';
import { ClaudeOTelTracker } from './claudeOTelTracker';

export class ClaudeAgentManager extends Disposable {
	private _langModelServer: ClaudeLanguageModelServer | undefined;
	private _sessions = this._register(new DisposableMap<string, ClaudeCodeSession>());

	private async getLangModelServer(): Promise<ClaudeLanguageModelServer> {
		if (!this._langModelServer) {
			this._langModelServer = this.instantiationService.createInstance(ClaudeLanguageModelServer);
			await this._langModelServer.start();
		}

		return this._langModelServer;
	}

	constructor(
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	public async handleRequest(
		claudeSessionId: string,
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		isNewSession: boolean,
		yieldRequested?: () => boolean
	): Promise<vscode.ChatResult> {
		try {
			const langModelServer = await this.getLangModelServer();

			this.logService.trace(`[ClaudeAgentManager] Handling request for sessionId=${claudeSessionId}.`);
			let session = this._sessions.get(claudeSessionId);
			if (session) {
				this.logService.trace(`[ClaudeAgentManager] Reusing Claude session ${claudeSessionId}.`);
			} else {
				this.logService.trace(`[ClaudeAgentManager] Creating Claude session for sessionId=${claudeSessionId}.`);
				session = this.instantiationService.createInstance(ClaudeCodeSession, langModelServer, claudeSessionId, isNewSession);
				this._sessions.set(claudeSessionId, session);
			}

			await session.invoke(
				request,
				stream,
				yieldRequested,
				token,
			);

			return {};
		} catch (invokeError) {
			const isAbortError = invokeError instanceof Error && (
				invokeError.name === 'AbortError' ||
				invokeError.message?.includes('aborted') ||
				invokeError.message?.includes('cancelled') ||
				invokeError.message?.includes('canceled')
			);
			if (isAbortError) {
				this.logService.trace('[ClaudeAgentManager] Request was aborted/cancelled');
				return {};
			}

			if (invokeError instanceof ClaudeProxyError) {
				this.logService.info(`[ClaudeAgentManager] Request failed due to proxy error: ${invokeError.fetchError.type}`);
				return { errorDetails: { message: invokeError.message } };
			}

			this.logService.error(invokeError as Error);
			const errorMessage = (invokeError instanceof KnownClaudeError) ? invokeError.message : l10n.t('Claude CLI Error: {0}', invokeError.message);
			stream.markdown(l10n.t('Error: {0}', errorMessage));
			return {
				errorDetails: { message: errorMessage },
			};
		}
	}
}

interface QueuedRequest {
	readonly request: vscode.ChatRequest;
	readonly stream: vscode.ChatResponseStream;
	readonly token: vscode.CancellationToken;
	readonly yieldRequested?: () => boolean;
	readonly deferred: DeferredPromise<void>;
	readonly modelId: ParsedClaudeModelId;
	readonly permissionMode: PermissionMode;
	readonly effort: EffortLevel | undefined;
	readonly toolsSnapshot: ReadonlySet<string>;
}

export class ClaudeCodeSession extends Disposable {
	private static readonly GATEWAY_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

	private _queryGenerator: Query | undefined;
	private _pendingPrompt: DeferredPromise<void> | undefined;
	private _queuedRequests: QueuedRequest[] = [];
	private _inFlightRequests: QueuedRequest[] = [];
	private _abortController = new AbortController();
	private _editTracker: ExternalEditTracker;
	private _settingsChangeTracker: ClaudeSettingsChangeTracker;
	private _currentModelId: ParsedClaudeModelId | undefined;
	private _currentPermissionMode: PermissionMode = 'acceptEdits';
	private _currentEffort: EffortLevel | undefined;
	private _isResumed: boolean;
	private _pendingRestart = false;
	private _sessionStarting: Promise<void> | undefined;
	private _currentToolNames: ReadonlySet<string> | undefined;
	private _gateway: vscode.McpGateway | undefined;
	private _gatewayIdleTimeout: ReturnType<typeof setTimeout> | undefined;
	private _otelTracker: ClaudeOTelTracker;

	private get _currentRequest(): QueuedRequest | undefined {
		return this._inFlightRequests[0];
	}

	private async _setModel(modelId: ParsedClaudeModelId): Promise<void> {
		if (modelId === this._currentModelId) {
			return;
		}
		this._currentModelId = modelId;
		if (this._queryGenerator) {
			const sdkId = modelId.toSdkModelId();
			this.logService.trace(`[ClaudeCodeSession] Setting model to ${sdkId} on active session`);
			await this._queryGenerator.setModel(sdkId);
		}
	}

	private async _setPermissionMode(mode: PermissionMode): Promise<void> {
		if (mode === this._currentPermissionMode) {
			return;
		}
		this._currentPermissionMode = mode;
		if (this._queryGenerator) {
			this.logService.trace(`[ClaudeCodeSession] Setting permission mode to ${mode} on active session`);
			await this._queryGenerator.setPermissionMode(mode);
		}
	}

	private async _setEffort(effort: EffortLevel | undefined): Promise<void> {
		if (effort === this._currentEffort) {
			return;
		}
		this._currentEffort = effort;
		if (this._queryGenerator) {
			this.logService.trace(`[ClaudeCodeSession] Setting effort to ${effort} on active session`);
			await this._queryGenerator.applyFlagSettings({ effortLevel: effort as 'low' | 'medium' | 'high' | 'xhigh' | undefined });
		}
	}

	constructor(
		private readonly langModelServer: ClaudeLanguageModelServer,
		public readonly sessionId: string,
		isNewSession: boolean,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@INativeEnvService private readonly envService: INativeEnvService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IClaudeCodeSdkService private readonly claudeCodeService: IClaudeCodeSdkService,
		@IClaudeToolPermissionService private readonly toolPermissionService: IClaudeToolPermissionService,
		@IClaudePlanFileTracker private readonly planFileTracker: IClaudePlanFileTracker,
		@IClaudeSessionStateService private readonly sessionStateService: IClaudeSessionStateService,
		@IClaudeRuntimeDataService private readonly runtimeDataService: IClaudeRuntimeDataService,
		@IMcpService private readonly mcpService: IMcpService,
		@IClaudePluginService private readonly claudePluginService: IClaudePluginService,
		@IOTelService private readonly _otelService: IOTelService,
		@IChatDebugFileLoggerService private readonly _debugFileLogger: IChatDebugFileLoggerService,
		@IGitService private readonly _gitService: IGitService,
	) {
		super();
		this._isResumed = !isNewSession;
		this._otelTracker = new ClaudeOTelTracker(this.sessionId, this._otelService, this.sessionStateService, this._gitService);
		this._debugFileLogger.startSession(this.sessionId).catch(err => {
			this.logService.error('[ClaudeCodeSession] Failed to start debug log session', err);
		});
		this._register({
			dispose: () => {
				this._debugFileLogger.endSession(this.sessionId).catch(err => {
					this.logService.error('[ClaudeCodeSession] Failed to end debug log session', err);
				});
			}
		});
		const planDirUri = URI.joinPath(this.envService.userHome, '.claude', 'plans');
		this._editTracker = new ExternalEditTracker([planDirUri]);
		this._settingsChangeTracker = this._createSettingsChangeTracker();
	}

	private _createSettingsChangeTracker(): ClaudeSettingsChangeTracker {
		const tracker = this.instantiationService.createInstance(ClaudeSettingsChangeTracker);

		tracker.registerPathResolver(() => {
			const paths: URI[] = [];
			paths.push(URI.joinPath(this.envService.userHome, '.claude', 'CLAUDE.md'));
			for (const folder of this.workspaceService.getWorkspaceFolders()) {
				paths.push(URI.joinPath(folder, '.claude', 'CLAUDE.md'));
				paths.push(URI.joinPath(folder, '.claude', 'CLAUDE.local.md'));
				paths.push(URI.joinPath(folder, 'CLAUDE.md'));
				paths.push(URI.joinPath(folder, 'CLAUDE.local.md'));
			}
			return paths;
		});

		tracker.registerPathResolver(() => {
			const paths: URI[] = [];
			paths.push(URI.joinPath(this.envService.userHome, '.claude', 'settings.json'));
			for (const folder of this.workspaceService.getWorkspaceFolders()) {
				paths.push(URI.joinPath(folder, '.claude', 'settings.json'));
				paths.push(URI.joinPath(folder, '.claude', 'settings.local.json'));
			}
			return paths;
		});

		tracker.registerDirectoryResolver(() => {
			const dirs: URI[] = [];
			dirs.push(URI.joinPath(this.envService.userHome, '.claude', 'agents'));
			for (const folder of this.workspaceService.getWorkspaceFolders()) {
				dirs.push(URI.joinPath(folder, '.claude', 'agents'));
			}
			return dirs;
		}, '.md');

		return tracker;
	}

	public override dispose(): void {
		this._cancelGatewayIdleTimer();
		this._disposeGateway();
		this._abortController.abort();
		this.planFileTracker.clear(this.sessionId);
		this._inFlightRequests.forEach(req => {
			if (!req.deferred.isSettled) {
				req.deferred.error(new Error('Session disposed'));
			}
		});
		this._inFlightRequests = [];
		this._queuedRequests.forEach(req => {
			if (!req.deferred.isSettled) {
				req.deferred.error(new Error('Session disposed'));
			}
		});
		this._queuedRequests = [];
		this._pendingPrompt?.error(new Error('Session disposed'));
		this._pendingPrompt = undefined;
		super.dispose();
	}

	public async invoke(
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		yieldRequested: (() => boolean) | undefined,
		token: vscode.CancellationToken,
	): Promise<void> {
		if (this._store.isDisposed) {
			throw new Error('Session disposed');
		}

		this._cancelGatewayIdleTimer();

		const modelId = this.sessionStateService.getModelIdForSession(this.sessionId);
		if (!modelId) {
			throw new Error(`Model not set for session ${this.sessionId}. State must be committed before invoking.`);
		}
		const permissionMode = this.sessionStateService.getPermissionModeForSession(this.sessionId);
		const effort = this.sessionStateService.getReasoningEffortForSession(this.sessionId);
		const toolsSnapshot = this._computeToolsSnapshot(request.tools);

		const deferred = new DeferredPromise<void>();
		const queuedRequest: QueuedRequest = {
			request,
			stream,
			token,
			yieldRequested,
			deferred,
			modelId,
			permissionMode,
			effort,
			toolsSnapshot,
		};

		this._queuedRequests.push(queuedRequest);

		if (!this._queryGenerator) {
			await this._startSession(token);
		}

		if (this._pendingPrompt) {
			const pendingPrompt = this._pendingPrompt;
			this._pendingPrompt = undefined;
			pendingPrompt.complete();
		}

		return deferred.p;
	}

	private async _startSession(token: vscode.CancellationToken): Promise<void> {
		if (this._sessionStarting) {
			await this._sessionStarting;
			return;
		}

		const startPromise = this._doStartSession(token);
		this._sessionStarting = startPromise;
		try {
			await startPromise;
		} finally {
			this._sessionStarting = undefined;
		}
	}

	private async _doStartSession(token: vscode.CancellationToken): Promise<void> {
		const folderInfo = this.sessionStateService.getFolderInfoForSession(this.sessionId);
		if (!folderInfo) {
			throw new Error(`No folder info found for session ${this.sessionId}. State must be committed before invoking.`);
		}
		const headRequest = this._queuedRequests[0];
		if (!headRequest) {
			throw new Error(`No queued request to start session ${this.sessionId} with.`);
		}

		this._currentModelId = headRequest.modelId;
		this._currentPermissionMode = headRequest.permissionMode;
		this._currentEffort = headRequest.effort;
		this._currentToolNames = headRequest.toolsSnapshot;

		const { cwd, additionalDirectories } = folderInfo;

		this.logService.trace(`appRoot: ${this.envService.appRoot}`);
		const pathSep = isWindows ? ';' : ':';
		const mcpServers: Record<string, McpServerConfig> = await buildMcpServersFromRegistry(this.instantiationService) ?? {};

		try {
			this._gateway ??= await this.mcpService.startMcpGateway(ClaudeSessionUri.forSessionId(this.sessionId)) ?? undefined;
			if (this._gateway) {
				for (const server of this._gateway.servers) {
					const serverId = server.label.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || `vscode-mcp-server-${Object.keys(mcpServers).length}`;
					mcpServers[serverId] = {
						type: 'http',
						url: server.address.toString(),
					};
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? (error.stack ?? error.message) : String(error);
			this.logService.warn(`[ClaudeCodeSession] Failed to start MCP gateway: ${errorMessage}`);
		}

		const plugins: SdkPluginConfig[] = [];
		try {
			const pluginLocations = await this.claudePluginService.getPluginLocations(token);
			for (const pluginLocation of pluginLocations) {
				plugins.push({ type: 'local', path: pluginLocation.fsPath });
			}
			if (plugins.length > 0) {
				this.logService.info(`[ClaudeCodeSession] Passing ${plugins.length} plugin(s) from skill locations`);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? (error.stack ?? error.message) : String(error);
			this.logService.warn(`[ClaudeCodeSession] Failed to resolve skill locations for plugins: ${errorMessage}`);
		}

		await this._settingsChangeTracker.takeSnapshot();

		const serverConfig = this.langModelServer.getConfig();
		const options: Options = {
			cwd,
			additionalDirectories,
			allowDangerouslySkipPermissions: true,
			abortController: this._abortController,
			effort: headRequest.effort,
			executable: process.execPath as 'node',
			disallowedTools: ['WebSearch'],
			...(this._isResumed
				? { resume: this.sessionId }
				: { sessionId: this.sessionId }),
			model: headRequest.modelId.toSdkModelId(),
			permissionMode: headRequest.permissionMode,
			includeHookEvents: true,
			mcpServers,
			plugins,
			settings: {
				env: {
					ANTHROPIC_BASE_URL: `http://localhost:${serverConfig.port}`,
					ANTHROPIC_AUTH_TOKEN: `${serverConfig.nonce}.${this.sessionId}`,
					CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
					USE_BUILTIN_RIPGREP: '0',
					PATH: `${resolveAppModulePathSync(this.envService.appRoot, '@vscode', 'ripgrep-universal', 'bin', `${process.platform}-${process.arch}`)}${pathSep}${process.env.PATH}`,
					...deriveClaudeOTelEnv(this._otelService.config),
				},
				attribution: {
					commit: '',
					pr: '',
				},
			},
			canUseTool: async (name, input) => {
				if (!this._currentRequest) {
					return { behavior: 'deny', message: 'No active request' };
				}
				this.logService.trace(`[ClaudeCodeSession]: canUseTool: ${name}(${JSON.stringify(input)})`);
				return this.toolPermissionService.canUseTool(name, input, {
					toolInvocationToken: this._currentRequest.request.toolInvocationToken,
					permissionMode: this._currentPermissionMode,
					stream: this._currentRequest.stream,
					sessionId: this.sessionId,
				});
			},
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code'
			},
			settingSources: ['user', 'project', 'local'],
			stderr: data => this.logService.error(`claude-agent-sdk stderr: ${data}`)
		};

		this.logService.trace(`claude-agent-sdk: Starting query`);
		this._queryGenerator = await this.claudeCodeService.query({
			prompt: this._createPromptIterable(),
			options
		});

		void this.runtimeDataService.update(this._queryGenerator);


		void this._processMessages().catch(err => {
			this.logService.error('[ClaudeCodeSession] Unhandled error in message processing loop', err);
		});
	}

	private async *_createPromptIterable(): AsyncIterable<SDKUserMessage> {
		while (true) {
			while (this._queuedRequests.length === 0) {
				this._pendingPrompt = new DeferredPromise<void>();
				await this._pendingPrompt.p;
			}
			const request = this._queuedRequests.shift()!;

			if (this._inFlightRequests.length === 0 && await this._settingsChangeTracker.hasChanges()) {
				this.logService.trace('[ClaudeCodeSession] Settings files changed, restarting session with resume');
				this._queuedRequests.unshift(request);
				this._pendingRestart = true;
				this._isResumed = true;
				return;
			}

			if (!this._toolsMatch(request.toolsSnapshot)) {
				this._queuedRequests.unshift(request);
				this._pendingRestart = true;
				this._isResumed = true;
				return;
			}

			await this._setModel(request.modelId);
			await this._setPermissionMode(request.permissionMode);
			await this._setEffort(request.effort);

			this._inFlightRequests.push(request);

			this.langModelServer.incrementUserInitiatedMessageCount(request.modelId.toEndpointModelId());

			const prompt = await resolvePromptToContentBlocks(request.request);

			const promptLabel = prompt.filter(p => p.type === 'text').at(-1)?.text ?? 'Claude Session Prompt';
			this.sessionStateService.setCapturingTokenForSession(
				this.sessionId,
				new CapturingToken(promptLabel, 'claude', undefined, undefined, this.sessionId)
			);

			this._otelTracker.startRequest(request.modelId.toEndpointModelId());

			this._otelTracker.emitUserMessage(promptLabel);

			yield {
				type: 'user',
				message: {
					role: 'user',
					content: prompt
				},
				priority: 'now',
				parent_tool_use_id: null,
				session_id: this.sessionId,
				uuid: request.request.id as `${string}-${string}-${string}-${string}-${string}`
			};
		}
	}

	private async _processMessages(): Promise<void> {
		const otelToolSpans = new Map<string, ISpanHandle>();
		const otelHookSpans = new Map<string, ISpanHandle>();
		const hookStartTimes = new Map<string, number>();
		const subagentTraceContexts = new Map<string, TraceContext>();
		try {
			const unprocessedToolCalls = new Map<string, Anthropic.Beta.Messages.BetaToolUseBlock>();
			const toolStartTimes = new Map<string, number>();
			for await (const message of this._queryGenerator!) {
				if (message.session_id && !this._isResumed) {
					this._isResumed = true;
				}

				if (!this._currentRequest) {
					this.logService.trace('[ClaudeCodeSession] Skipping message - no current request');
					continue;
				}

				const currentRequest = this._currentRequest;

				if (currentRequest.token.isCancellationRequested) {
					throw new Error('Request was cancelled');
				}

				this._otelTracker.onMessage(message, subagentTraceContexts);

				this.logService.trace(`claude-agent-sdk Message: ${JSON.stringify(message, null, 2)}`);

				let result;
				try {
					result = this.instantiationService.invokeFunction(dispatchMessage, message, this.sessionId, {
						stream: currentRequest.stream,
						toolInvocationToken: currentRequest.request.toolInvocationToken,
						editTracker: this._editTracker,
						token: currentRequest.token,
					}, {
						unprocessedToolCalls,
						toolStartTimes,
						otelToolSpans,
						otelHookSpans,
						hookStartTimes,
						parentTraceContext: this._otelTracker.traceContext,
						subagentTraceContexts,
						extractToolParameters,
					});
				} catch (dispatchError) {
					if (dispatchError instanceof ClaudeProxyError || dispatchError instanceof KnownClaudeError) {
						throw dispatchError;
					}
					this.logService.warn(`[ClaudeCodeSession] Failed to dispatch message (stream may be disposed after yield): ${dispatchError}`);
				}

				if (currentRequest.yieldRequested?.()) {
					this.logService.trace('[ClaudeCodeSession] Yield requested - signaling session completion so next request can start');

					if (!currentRequest.deferred.isSettled) {
						await currentRequest.deferred.complete();
					}
				}

				if (result?.requestComplete) {
					this._otelTracker.endRequest();
					this.sessionStateService.setCapturingTokenForSession(this.sessionId, undefined);
					const completed = this._inFlightRequests.shift();
					if (completed && !completed.deferred.isSettled) {
						await completed.deferred.complete();
					}
					if (this._inFlightRequests.length === 0 && this._queuedRequests.length === 0) {
						this._startGatewayIdleTimer();
					}
					subagentTraceContexts.clear();
				}
			}
			throw new Error('Session ended unexpectedly');
		} catch (error) {
			if (this._pendingRestart) {
				this._pendingRestart = false;
				this._restartSession();
				const headToken = this._queuedRequests[0]?.token;
				if (headToken) {
					await this._startSession(headToken);
				}
				return;
			}

			this.sessionStateService.setCapturingTokenForSession(this.sessionId, undefined);
			this._otelTracker.endRequestWithError(error.message);


			this._queryGenerator = undefined;
			this._abortController = new AbortController();


			this._inFlightRequests.forEach(req => {
				if (!req.deferred.isSettled) {
					req.deferred.error(error);
				}
			});
			this._inFlightRequests = [];
			this._queuedRequests.forEach(req => {
				if (!req.deferred.isSettled) {
					req.deferred.error(error);
				}
			});
			this._queuedRequests = [];
			if (this._pendingPrompt && !this._pendingPrompt.isSettled) {
				this._pendingPrompt.error(error);
			}
			this._pendingPrompt = undefined;
		} finally {
			for (const [, span] of otelToolSpans) {
				span.setStatus(SpanStatusCode.ERROR, 'session ended before tool completed');
				span.end();
			}
			otelToolSpans.clear();
			for (const [, span] of otelHookSpans) {
				span.setStatus(SpanStatusCode.ERROR, 'session ended before hook completed');
				span.end();
			}
			otelHookSpans.clear();
			this._otelTracker.endRequestWithError('session ended');
		}
	}

	private _restartSession(): void {
		this._queryGenerator = undefined;
		this._abortController.abort();
		this._abortController = new AbortController();
		this._isResumed = true;
	}


	private _cancelGatewayIdleTimer(): void {
		if (this._gatewayIdleTimeout !== undefined) {
			clearTimeout(this._gatewayIdleTimeout);
			this._gatewayIdleTimeout = undefined;
		}
	}

	private _startGatewayIdleTimer(): void {
		this._cancelGatewayIdleTimer();
		this._gatewayIdleTimeout = setTimeout(() => {
			this._gatewayIdleTimeout = undefined;
			this._disposeGateway();
			this._restartSession();
		}, ClaudeCodeSession.GATEWAY_IDLE_TIMEOUT_MS);
	}

	private _disposeGateway(): void {
		this._gateway?.dispose();
		this._gateway = undefined;
	}


	private _computeToolsSnapshot(tools: vscode.ChatRequest['tools']): ReadonlySet<string> {
		return new Set(
			[...tools]
				.filter(([tool]) => tool.source instanceof LanguageModelToolMCPSource)
				.map(([tool]) => tool.name)
		);
	}

	private _toolsMatch(snapshot: ReadonlySet<string>): boolean {
		if (!this._currentToolNames) {
			return true;
		}

		if (snapshot.size !== this._currentToolNames.size) {
			return false;
		}

		for (const name of snapshot) {
			if (!this._currentToolNames.has(name)) {
				return false;
			}
		}

		return true;
	}

}
