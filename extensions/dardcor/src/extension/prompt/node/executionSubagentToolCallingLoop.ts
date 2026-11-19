/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import type { CancellationToken, ChatRequest, ChatResponseStream, LanguageModelToolInformation, Progress } from 'vscode';
import { IAuthenticationChatUpgradeService } from '../../../platform/authentication/common/authenticationUpgrade';
import { IChatHookService } from '../../../platform/chat/common/chatHookService';
import { ChatLocation, ChatResponse } from '../../../platform/chat/common/commonTypes';
import { ISessionTranscriptService } from '../../../platform/chat/common/sessionTranscriptService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IGitService } from '../../../platform/git/common/gitService';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { IOTelService } from '../../../platform/otel/common/otelService';
import { IRequestLogger } from '../../../platform/requestLogger/common/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { ITerminalService } from '../../../platform/terminal/common/terminalService';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatResponseProgressPart, ChatResponseReferencePart, LanguageModelToolResult2 } from '../../../dardcorTypes';
import { IToolCallingLoopOptions, ToolCallingLoop, ToolCallingLoopFetchOptions } from '../../intents/node/toolCallingLoop';
import { ExecutionSubagentPrompt } from '../../prompts/node/agent/executionSubagentPrompt';
import { PromptRenderer } from '../../prompts/node/base/promptRenderer';
import { ToolResultMetadata } from '../../prompts/node/panel/toolCalling';
import { ToolName } from '../../tools/common/toolNames';
import { IToolsService } from '../../tools/common/toolsService';
import { IBuildPromptContext } from '../common/intents';
import { IBuildPromptResult } from './intents';

export interface IExecutionSubagentToolCallingLoopOptions extends IToolCallingLoopOptions {
	request: ChatRequest;
	location: ChatLocation;
	promptText: string;
	subAgentInvocationId?: string;
	parentToolCallId?: string;
	parentHeaderRequestId?: string;
	parentModelCallId?: string;
	topLevelTurnId?: string;
}

export interface IBackgroundCommand {
	readonly command: string;
	readonly termId: string;
	readonly reason: 'timeout' | 'async' | 'inputNeeded';
	readonly timeoutMs?: number;
}

export class ExecutionSubagentToolCallingLoop extends ToolCallingLoop<IExecutionSubagentToolCallingLoopOptions> {

	public static readonly ID = 'executionSubagentTool';

	private readonly _backgroundCommands: IBackgroundCommand[] = [];
	private readonly _seenBackgroundCallIds = new Set<string>();
	private _endpoint: Promise<IChatEndpoint> | undefined;

	public get backgroundCommands(): readonly IBackgroundCommand[] {
		return this._backgroundCommands;
	}

	constructor(
		options: IExecutionSubagentToolCallingLoopOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
		@IRequestLogger requestLogger: IRequestLogger,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IToolsService private readonly toolsService: IToolsService,
		@IAuthenticationChatUpgradeService authenticationChatUpgradeService: IAuthenticationChatUpgradeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentationService: IExperimentationService,
		@IChatHookService chatHookService: IChatHookService,
		@ISessionTranscriptService sessionTranscriptService: ISessionTranscriptService,
		@IFileSystemService fileSystemService: IFileSystemService,
		@IOTelService otelService: IOTelService,
		@IGitService gitService: IGitService,
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super(options, instantiationService, endpointProvider, logService, requestLogger, authenticationChatUpgradeService, telemetryService, configurationService, experimentationService, chatHookService, sessionTranscriptService, fileSystemService, otelService, gitService);
	}

	protected override createPromptContext(availableTools: LanguageModelToolInformation[], outputStream: ChatResponseStream | undefined): IBuildPromptContext {
		const context = super.createPromptContext(availableTools, outputStream);
		if (context.tools) {
			context.tools = {
				...context.tools,
				toolReferences: [],
				subAgentInvocationId: this.options.subAgentInvocationId ?? randomUUID(),
				subAgentName: 'execution'
			};
		}
		context.query = this.options.promptText;
		return context;
	}

	private getEndpoint(): Promise<IChatEndpoint> {
		return this._endpoint ??= this.resolveEndpoint();
	}

	public async getModelName(): Promise<string> {
		return (await this.getEndpoint()).name;
	}

	private async resolveEndpoint(): Promise<IChatEndpoint> {
		const modelName = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ExecutionSubagentModel, this._experimentationService);
		const useDedicatedSubagentModel = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ExecutionSubagentUseAgenticProxy, this._experimentationService);
		const shellType = this.terminalService.terminalShellType;

		if (useDedicatedSubagentModel) {
			if (shellType === 'powershell' || shellType === 'pwsh') {
				return await this.endpointProvider.getChatEndpoint(this.options.request);
			}
			try {
				const dedicatedEndpoint = modelName
					? await this.endpointProvider.getChatEndpoint(modelName)
					: await this.endpointProvider.getChatEndpoint('dardcor-utility-small');
				if (dedicatedEndpoint.supportsToolCalls) {
					return dedicatedEndpoint;
				}
				this._logService.warn(`[ExecutionSubagentToolCallingLoop] Dedicated Router model '${dedicatedEndpoint.model}' does not support tool calls; using the main agent model.`);
			} catch (error) {
				this._logService.warn(`[ExecutionSubagentToolCallingLoop] Could not resolve the configured dedicated Router model; using the main agent model: ${error instanceof Error ? error.message : String(error)}`);
			}
			return await this.endpointProvider.getChatEndpoint(this.options.request);
		}

		if (modelName) {
			try {
				const allEndpoints = await this.endpointProvider.getAllChatEndpoints();
				const endpoint = allEndpoints.find(e => e.model === modelName)
					?? await this.endpointProvider.getChatEndpoint(modelName);
				if (endpoint.supportsToolCalls) {
					return endpoint;
				}
				return await this.endpointProvider.getChatEndpoint(this.options.request);
			} catch (error) {
				return await this.endpointProvider.getChatEndpoint(this.options.request);
			}
		} else {
			return await this.endpointProvider.getChatEndpoint(this.options.request);
		}
	}

	protected async buildPrompt(buildpromptContext: IBuildPromptContext, progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>, token: CancellationToken): Promise<IBuildPromptResult> {
		const endpoint = await this.getEndpoint();
		const maxExecutionTurns = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ExecutionSubagentToolCallLimit, this._experimentationService);

		const render = (hasBackgroundCommand: boolean) => PromptRenderer.create(
			this.instantiationService,
			endpoint,
			ExecutionSubagentPrompt,
			{
				promptContext: buildpromptContext,
				maxExecutionTurns,
				hasBackgroundCommand,
			}
		).render(progress, token);

		const hadBackgroundBefore = this._backgroundCommands.length > 0;
		let result = await render(hadBackgroundBefore);

		this.collectBackgroundCommands(buildpromptContext, result);

		if (!hadBackgroundBefore && this._backgroundCommands.length > 0) {
			const cache = buildpromptContext.toolCallResults;
			if (cache) {
				for (const meta of result.metadata.getAll(ToolResultMetadata)) {
					cache[meta.toolCallId] = meta.result;
				}
			}
			result = await render(true);
		}

		return result;
	}

	private collectBackgroundCommands(buildpromptContext: IBuildPromptContext, result: IBuildPromptResult): void {
		const lastRound = buildpromptContext.toolCallRounds?.at(-1);
		if (!lastRound) {
			return;
		}

		interface ITerminalCall {
			readonly command: string;
			readonly invokedAsAsync: boolean;
		}
		const terminalCallsById = new Map<string, ITerminalCall>();
		for (const tc of lastRound.toolCalls) {
			if (tc.name !== ToolName.CoreRunInTerminal || this._seenBackgroundCallIds.has(tc.id)) {
				continue;
			}
			let command = '';
			let invokedAsAsync = false;
			try {
				const args = JSON.parse(tc.arguments) as { command?: unknown; mode?: unknown; isBackground?: unknown };
				if (typeof args?.command === 'string') {
					command = args.command;
				}
				invokedAsAsync = args?.mode === 'async' || args?.isBackground === true;
			} catch {
			}
			terminalCallsById.set(tc.id, { command, invokedAsAsync });
		}
		if (terminalCallsById.size === 0) {
			return;
		}

		for (const meta of result.metadata.getAll(ToolResultMetadata)) {
			const call = terminalCallsById.get(meta.toolCallId);
			if (!call) {
				continue;
			}
			const termId = this.getTerminalId(meta.result);
			if (!termId) {
				continue;
			}
			const timeoutMs = this.getTimeoutMsIfTimedOut(meta.result);
			if (timeoutMs !== undefined) {
				this._seenBackgroundCallIds.add(meta.toolCallId);
				this._backgroundCommands.push({
					command: call.command,
					termId,
					reason: 'timeout',
					timeoutMs,
				});
			} else if (this.getInputNeeded(meta.result)) {
				this._seenBackgroundCallIds.add(meta.toolCallId);
				this._backgroundCommands.push({
					command: call.command,
					termId,
					reason: 'inputNeeded',
				});
			} else if (call.invokedAsAsync) {
				this._seenBackgroundCallIds.add(meta.toolCallId);
				this._backgroundCommands.push({
					command: call.command,
					termId,
					reason: 'async',
				});
			}
		}
	}

	private getTerminalId(toolResult: LanguageModelToolResult2): string | undefined {
		if (!('toolMetadata' in toolResult)) {
			return undefined;
		}
		const metadata = (toolResult as { toolMetadata?: unknown }).toolMetadata;
		if (!metadata || typeof metadata !== 'object') {
			return undefined;
		}
		const m = metadata as { id?: unknown };
		return typeof m.id === 'string' ? m.id : undefined;
	}

	private getTimeoutMsIfTimedOut(toolResult: LanguageModelToolResult2): number | undefined {
		if (!('toolMetadata' in toolResult)) {
			return undefined;
		}
		const metadata = (toolResult as { toolMetadata?: unknown }).toolMetadata;
		if (!metadata || typeof metadata !== 'object') {
			return undefined;
		}
		const m = metadata as { timedOut?: unknown; timeoutMs?: unknown };
		if (m.timedOut !== true) {
			return undefined;
		}
		return typeof m.timeoutMs === 'number' ? m.timeoutMs : undefined;
	}

	private getInputNeeded(toolResult: LanguageModelToolResult2): boolean {
		if (!('toolMetadata' in toolResult)) {
			return false;
		}
		const metadata = (toolResult as { toolMetadata?: unknown }).toolMetadata;
		if (!metadata || typeof metadata !== 'object') {
			return false;
		}
		const m = metadata as { inputNeeded?: unknown };
		return m.inputNeeded === true;
	}

	protected async getAvailableTools(): Promise<LanguageModelToolInformation[]> {
		if (this._backgroundCommands.length > 0) {
			return [];
		}

		const endpoint = await this.getEndpoint();
		const allTools = this.toolsService.getEnabledTools(this.options.request, endpoint);

		const allowedExecutionTools = new Set([
			ToolName.CoreRunInTerminal
		]);

		return allTools.filter(tool => allowedExecutionTools.has(tool.name as ToolName));
	}

	protected async fetch({ messages, finishedCb, requestOptions, modelCapabilities, iterationNumber }: ToolCallingLoopFetchOptions, token: CancellationToken): Promise<ChatResponse> {
		const endpoint = await this.getEndpoint();
		return endpoint.makeChatRequest2({
			debugName: ExecutionSubagentToolCallingLoop.ID,
			messages,
			finishedCb,
			location: this.options.location,
			modelCapabilities: { ...modelCapabilities, reasoningEffort: undefined },
			requestOptions: {
				...(requestOptions ?? {}),
				temperature: 0
			},
			userInitiatedRequest: false,
			interactionTypeOverride: 'conversation-subagent',
			turnId: this.options.request.id,
			topLevelTurnId: this.options.topLevelTurnId,
			telemetryProperties: {
				requestId: this.options.subAgentInvocationId,
				messageId: randomUUID(),
				messageSource: 'chat.editAgent',
				subType: 'execution_subagent',
				conversationId: this.options.conversation.sessionId,
				parentToolCallId: this.options.parentToolCallId,
				parentRequestId: this.options.request.id,
				parentHeaderRequestId: this.options.parentHeaderRequestId,
				parentModelCallId: this.options.parentModelCallId,
				iterationNumber: iterationNumber.toString(),
			},
		}, token);
	}
}
