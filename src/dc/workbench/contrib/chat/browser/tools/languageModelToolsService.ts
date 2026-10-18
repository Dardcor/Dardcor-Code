/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderAsPlaintext } from '../../../../../base/browser/markdownRenderer.js';
import { assertNever } from '../../../../../base/common/assert.js';
import { RunOnceScheduler, timeout } from '../../../../../base/common/async.js';
import { encodeBase64 } from '../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { arrayEqualsC } from '../../../../../base/common/equals.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { CancellationError, isCancellationError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createMarkdownCommandLink, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { combinedDisposable, Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { getMediaMime } from '../../../../../base/common/mime.js';
import { derived, derivedOpts, IObservable, IReader, observableFromEventOpts, ObservableSet, observableSignal, transaction } from '../../../../../base/common/observable.js';
import Severity from '../../../../../base/common/severity.js';
import { StopWatch } from '../../../../../base/common/stopwatch.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../../nls.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import type { LanguageModelToolInvokedClassification, LanguageModelToolInvokedEvent, LanguageModelToolTelemetryClassification, LanguageModelToolTelemetryData } from '../../../../../platform/telemetry/common/languageModelToolTelemetry.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import * as JSONContributionRegistry from '../../../../../platform/jsonschemas/common/jsonContributionRegistry.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { observableConfigValue } from '../../../../../platform/observable/common/platformObservableUtils.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ChatRequestToolReferenceEntry, toToolSetVariableEntry, toToolVariableEntry } from '../../common/attachments/chatVariableEntries.js';
import { IVariableReference } from '../../common/chatModes.js';
import { ConfirmedReason, IChatService, IChatToolInvocation, ToolConfirmKind } from '../../common/chatService/chatService.js';
import { ChatConfiguration, isAutoApproveLevel, isAutopilotLevel } from '../../common/constants.js';
import { localChatSessionType } from '../../common/chatSessionsService.js';
import { ILanguageModelChatMetadata } from '../../common/languageModels.js';
import { IChatModel, IChatRequestModel } from '../../common/model/chatModel.js';
import { ChatToolInvocation } from '../../common/model/chatProgressTypes/chatToolInvocation.js';
import { chatSessionResourceToId, getChatSessionType } from '../../common/model/chatUri.js';
import { HookType } from '../../common/promptSyntax/hookTypes.js';
import { ILanguageModelToolsConfirmationService } from '../../common/tools/languageModelToolsConfirmationService.js';
import { TerminalToolId } from '../../common/tools/terminalToolIds.js';
import { CountTokensCallback, createToolSchemaUri, IBeginToolCallOptions, IExternalPreToolUseHookResult, ILanguageModelToolsService, IPreparedToolInvocation, isToolSet, IToolData, IToolImpl, IToolInvocation, IToolInvokedEvent, IToolResult, IToolResultInputOutputDetails, IToolSet, SpecedToolAliases, stringifyPromptTsxPart, ToolAndToolSetEnablementMap, ToolDataSource, ToolInvocationPresentation, toolMatchesModel, ToolSet, ToolSetForModel, VSCodeToolReference } from '../../common/tools/languageModelToolsService.js';
import { IToolResultCompressor } from '../../common/tools/toolResultCompressor.js';
import { getToolConfirmationAlert } from '../accessibility/chatAccessibilityProvider.js';
import { IChatWidgetService } from '../chat.js';
import { IChatToolRiskAssessmentService, ToolRiskLevel } from './chatToolRiskAssessmentService.js';

const jsonSchemaRegistry = Registry.as<JSONContributionRegistry.IJSONContributionRegistry>(JSONContributionRegistry.Extensions.JSONContribution);

interface IToolEntry {
	data: IToolData;
	impl?: IToolImpl;
}

interface ITrackedCall {
	store: IDisposable;
}

export const enum AutoApproveStorageKeys {
	GlobalAutoApproveOptIn = 'chat.tools.global.autoApprove.optIn'
}

const SkipAutoApproveConfirmationKey = 'vscode.chat.tools.global.autoApprove.testMode';

const autoApproveAllReason = 'auto-approve-all';

const toolIdsThatCannotBeAutoApproved = new Set([
	'vscode_get_confirmation_with_options',
	'vscode_get_modified_files_confirmation',
]);

const fetchWebPageToolIds = new Set([
	'copilot_fetchWebPage',
	'vscode_fetchWebPage_internal',
]);

export const globalAutoApproveDescription = localize2(
	{
		key: 'autoApprove3.markdown',
		comment: [
			'{Locked=\'](https://github.com/features/codespaces)\'}',
			'{Locked=\'](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)\'}',
			'{Locked=\'](https://www.dardcor-code.web.id/docs/agents/run/security)\'}',
			'{Locked=\'**\'}',
			'{Locked=\'[`chat.autoReply`](command:workbench.action.openSettings?%5B%22chat.autoReply%22%5D)\'}',
		]
	},
	'Global auto approve also known as "YOLO mode" disables manual approval completely for _all tools in all workspaces_, allowing the agent to act fully autonomously. This is extremely dangerous and is *never* recommended, even containerized environments like [Codespaces](https://github.com/features/codespaces) and [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) have user keys forwarded into the container that could be compromised.\n\n**This feature disables [critical security protections](https://www.dardcor-code.web.id/docs/agents/run/security) and makes it much easier for an attacker to compromise the machine.**\n\nNote: This setting only controls tool approval and does not prevent the agent from asking questions. To automatically answer agent questions, use the [`chat.autoReply`](command:workbench.action.openSettings?%5B%22chat.autoReply%22%5D) setting.'
);

export class LanguageModelToolsService extends Disposable implements ILanguageModelToolsService {
	_serviceBrand: undefined;
	readonly vscodeToolSet: ToolSet;
	readonly executeToolSet: ToolSet;
	readonly readToolSet: ToolSet;
	readonly agentToolSet: ToolSet;

	private readonly _onDidChangeTools = this._register(new Emitter<void>());
	readonly onDidChangeTools = this._onDidChangeTools.event;
	private readonly _onDidPrepareToolCallBecomeUnresponsive = this._register(new Emitter<{ sessionResource: URI; toolData: IToolData }>());
	readonly onDidPrepareToolCallBecomeUnresponsive = this._onDidPrepareToolCallBecomeUnresponsive.event;
	private readonly _onDidInvokeTool = this._register(new Emitter<IToolInvokedEvent>());
	readonly onDidInvokeTool = this._onDidInvokeTool.event;

	private readonly _onDidChangeToolsScheduler = this._register(new RunOnceScheduler(() => this._onDidChangeTools.fire(), 750));
	private readonly _tools = new Map<string, IToolEntry>();
	private readonly _toolContextKeys = new Set<string>();
	private readonly _ctxToolsCount: IContextKey<number>;

	private readonly _callsByRequestId = new Map<string, ITrackedCall[]>();

	private readonly _pendingToolCalls = new Map<string, ChatToolInvocation>();

	private _pendingGlobalAutoApproveCheck: Promise<boolean> | undefined;

	private readonly _isAgentModeEnabled: IObservable<boolean>;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IChatService private readonly _chatService: IChatService,
		@IDialogService private readonly _dialogService: IDialogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IAccessibilitySignalService private readonly _accessibilitySignalService: IAccessibilitySignalService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILanguageModelToolsConfirmationService private readonly _confirmationService: ILanguageModelToolsConfirmationService,
		@ICommandService private readonly _commandService: ICommandService,
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
		@IToolResultCompressor private readonly _toolResultCompressor: IToolResultCompressor,
		@IChatToolRiskAssessmentService private readonly _riskAssessmentService: IChatToolRiskAssessmentService,
	) {
		super();

		this._isAgentModeEnabled = observableConfigValue(ChatConfiguration.AgentEnabled, true, this._configurationService);

		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(this._toolContextKeys)) {
				this._onDidChangeToolsScheduler.schedule();
			}
		}));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.ExtensionToolsEnabled) || e.affectsConfiguration(ChatConfiguration.AgentEnabled)) {
				this._onDidChangeToolsScheduler.schedule();
			}
		}));

		this._register(Event.runAndSubscribe(this._configurationService.onDidChangeConfiguration, e => {
			if (!e || e.affectsConfiguration(ChatConfiguration.GlobalAutoApprove)) {
				if (this._configurationService.getValue(ChatConfiguration.GlobalAutoApprove) !== true) {
					this._storageService.remove(AutoApproveStorageKeys.GlobalAutoApproveOptIn, StorageScope.APPLICATION);
				}
			}
		}));

		this._ctxToolsCount = ChatContextKeys.Tools.toolsCount.bindTo(_contextKeyService);

		this.vscodeToolSet = this._register(this.createToolSet(
			ToolDataSource.Internal,
			'vscode',
			'vscode',
			{
				icon: ThemeIcon.fromId(Codicon.dardcorCode.id),
				description: localize('copilot.toolSet.vscode.description', 'Use Dardcor Code features'),
				legacyFullNames: ['vscode'],
				deprecated: true,
			}
		));

		this.executeToolSet = this._register(this.createToolSet(
			ToolDataSource.Internal,
			'execute',
			SpecedToolAliases.execute,
			{
				icon: ThemeIcon.fromId(Codicon.terminal.id),
				description: localize('copilot.toolSet.execute.description', 'Execute code and applications on your machine'),
				deprecated: true,
			}
		));

		this.readToolSet = this._register(this.createToolSet(
			ToolDataSource.Internal,
			'read',
			SpecedToolAliases.read,
			{
				icon: ThemeIcon.fromId(Codicon.book.id),
				description: localize('copilot.toolSet.read.description', 'Read files in your workspace'),
				deprecated: true,
			}
		));

		this.agentToolSet = this._register(this.createToolSet(
			ToolDataSource.Internal,
			'agent',
			SpecedToolAliases.agent,
			{
				icon: ThemeIcon.fromId(Codicon.agent.id),
				description: localize('copilot.toolSet.agent.description', 'Delegate tasks to other agents'),
				deprecated: true,
			}
		));
	}

	private isToolEnabledForModel(toolData: IToolData, model: ILanguageModelChatMetadata | undefined): boolean {
		if (!toolMatchesModel(toolData, model)) {
			return false;
		}

		return true;
	}

	private isPermitted(toolOrToolSet: IToolData | ToolSet, reader?: IReader): boolean {
		const agentModeEnabled = this._isAgentModeEnabled.read(reader);
		if (agentModeEnabled !== false) {
			return true;
		}

		if (!isToolSet(toolOrToolSet) && toolOrToolSet.canBeReferencedInPrompt === false && toolOrToolSet.source.type === 'internal') {
			return true;
		}

		const permittedInternalToolSetIds = [SpecedToolAliases.read, SpecedToolAliases.search, SpecedToolAliases.web];
		if (isToolSet(toolOrToolSet)) {
			const permitted = toolOrToolSet.source.type === 'internal' && permittedInternalToolSetIds.includes(toolOrToolSet.referenceName);
			this._logService.trace(`LanguageModelToolsService#isPermitted: ToolSet ${toolOrToolSet.id} (${toolOrToolSet.referenceName}) permitted=${permitted}`);
			return permitted;
		}
		for (const toolSet of this._toolSets) {
			if (toolSet.source.type === 'internal' && permittedInternalToolSetIds.includes(toolSet.referenceName)) {
				for (const memberTool of toolSet.getTools()) {
					if (memberTool.id === toolOrToolSet.id) {
						this._logService.trace(`LanguageModelToolsService#isPermitted: Tool ${toolOrToolSet.id} (${toolOrToolSet.toolReferenceName}) permitted=true (member of ${toolSet.referenceName})`);
						return true;
					}
				}
			}
		}

		if (toolOrToolSet.id === 'vscode_fetchWebPage_internal' && permittedInternalToolSetIds.includes(SpecedToolAliases.web)) {
			this._logService.trace(`LanguageModelToolsService#isPermitted: Tool ${toolOrToolSet.id} (${toolOrToolSet.toolReferenceName}) permitted=true (special case)`);
			return true;
		}

		this._logService.trace(`LanguageModelToolsService#isPermitted: Tool ${toolOrToolSet.id} (${toolOrToolSet.toolReferenceName}) permitted=false`);
		return false;
	}

	override dispose(): void {
		super.dispose();

		this._callsByRequestId.forEach(calls => calls.forEach(call => call.store.dispose()));
		this._pendingToolCalls.clear();
		this._ctxToolsCount.reset();
	}

	registerToolData(toolData: IToolData): IDisposable {
		if (this._tools.has(toolData.id)) {
			throw new Error(`Tool "${toolData.id}" is already registered.`);
		}

		this._tools.set(toolData.id, { data: toolData });
		this._ctxToolsCount.set(this._tools.size);
		if (!this._onDidChangeToolsScheduler.isScheduled()) {
			this._onDidChangeToolsScheduler.schedule();
		}

		toolData.when?.keys().forEach(key => this._toolContextKeys.add(key));

		let store: DisposableStore | undefined;
		if (toolData.inputSchema) {
			store = new DisposableStore();
			const schemaUrl = createToolSchemaUri(toolData.id).toString();
			jsonSchemaRegistry.registerSchema(schemaUrl, toolData.inputSchema, store);
			store.add(jsonSchemaRegistry.registerSchemaAssociation(schemaUrl, `/lm/tool/${toolData.id}/tool_input.json`));
		}

		return toDisposable(() => {
			store?.dispose();
			this._tools.delete(toolData.id);
			this._ctxToolsCount.set(this._tools.size);
			this._refreshAllToolContextKeys();
			if (!this._onDidChangeToolsScheduler.isScheduled()) {
				this._onDidChangeToolsScheduler.schedule();
			}
		});
	}

	flushToolUpdates(): void {
		this._onDidChangeToolsScheduler.flush();
	}

	private _refreshAllToolContextKeys() {
		this._toolContextKeys.clear();
		for (const tool of this._tools.values()) {
			tool.data.when?.keys().forEach(key => this._toolContextKeys.add(key));
		}
	}

	registerToolImplementation(id: string, tool: IToolImpl): IDisposable {
		const entry = this._tools.get(id);
		if (!entry) {
			throw new Error(`Tool "${id}" was not contributed.`);
		}

		if (entry.impl) {
			throw new Error(`Tool "${id}" already has an implementation.`);
		}

		entry.impl = tool;
		return toDisposable(() => {
			entry.impl = undefined;
		});
	}

	registerTool(toolData: IToolData, tool: IToolImpl): IDisposable {
		return combinedDisposable(
			this.registerToolData(toolData),
			this.registerToolImplementation(toolData.id, tool)
		);
	}

	getTools(model: ILanguageModelChatMetadata | undefined): Iterable<IToolData> {
		const toolDatas = Iterable.map(this._tools.values(), i => i.data);
		const extensionToolsEnabled = this._configurationService.getValue<boolean>(ChatConfiguration.ExtensionToolsEnabled);
		return Iterable.filter(
			toolDatas,
			toolData => {
				const satisfiesWhenClause = !toolData.when || this._contextKeyService.contextMatchesRules(toolData.when);
				const satisfiesExternalToolCheck = toolData.source.type !== 'extension' || !!extensionToolsEnabled;
				const satisfiesPermittedCheck = this.isPermitted(toolData);
				const satisfiesModelFilter = this.isToolEnabledForModel(toolData, model);
				return satisfiesWhenClause && satisfiesExternalToolCheck && satisfiesPermittedCheck && satisfiesModelFilter;
			});
	}

	observeTools(model: ILanguageModelChatMetadata | undefined): IObservable<readonly IToolData[]> {
		const meta = derived(reader => {
			const signal = observableSignal('observeToolsContext');
			const trigger = () => transaction(tx => signal.trigger(tx));
			reader.store.add(this.onDidChangeTools(trigger));
			return signal;
		});

		return derivedOpts({ equalsFn: arrayEqualsC() }, reader => {
			meta.read(reader).read(reader);
			return Array.from(this.getTools(model));
		});
	}

	getAllToolsIncludingDisabled(): Iterable<IToolData> {
		const toolDatas = Iterable.map(this._tools.values(), i => i.data);
		const extensionToolsEnabled = this._configurationService.getValue<boolean>(ChatConfiguration.ExtensionToolsEnabled);
		return Iterable.filter(
			toolDatas,
			toolData => {
				const satisfiesExternalToolCheck = toolData.source.type !== 'extension' || !!extensionToolsEnabled;
				const satisfiesPermittedCheck = this.isPermitted(toolData);
				return satisfiesExternalToolCheck && satisfiesPermittedCheck;
			});
	}

	getTool(id: string): IToolData | undefined {
		return this._tools.get(id)?.data;
	}

	getToolByName(name: string): IToolData | undefined {
		for (const tool of this.getAllToolsIncludingDisabled()) {
			if (tool.toolReferenceName === name) {
				return tool;
			}
		}
		return undefined;
	}

	private _handlePreToolUseDenial(
		dto: IToolInvocation,
		hookResult: IExternalPreToolUseHookResult,
		toolData: IToolData | undefined,
		pendingInvocation: ChatToolInvocation | undefined,
		request: IChatRequestModel | undefined,
	): IToolResult {
		const hookReason = hookResult.permissionDecisionReason ?? localize('hookDeniedNoReason', "Hook denied tool execution");
		const reason = localize('deniedByPreToolUseHook', "Denied by {0} hook: {1}", HookType.PreToolUse, hookReason);
		this._logService.debug(`[LanguageModelToolsService#invokeTool] Tool ${dto.toolId} denied by preToolUse hook: ${hookReason}`);

		if (toolData) {
			if (pendingInvocation) {
				pendingInvocation.presentation = ToolInvocationPresentation.Hidden;
				pendingInvocation.cancelFromStreaming(ToolConfirmKind.Denied, reason);
			} else if (request) {
				const cancelledInvocation = ChatToolInvocation.createCancelled(
					{ toolCallId: dto.callId, toolId: dto.toolId, toolData, subagentInvocationId: dto.subAgentInvocationId, chatRequestId: dto.chatRequestId },
					dto.parameters,
					ToolConfirmKind.Denied,
					reason
				);
				cancelledInvocation.presentation = ToolInvocationPresentation.Hidden;
				this._chatService.appendProgress(request, cancelledInvocation);
			}
		}

		return {
			content: [{ kind: 'text', value: `Tool execution denied: ${hookReason}` }],
			toolResultError: hookReason,
		};
	}

	private async _validateUpdatedInput(toolId: string, toolData: IToolData | undefined, updatedInput: object): Promise<string | undefined> {
		if (!toolData?.inputSchema) {
			return undefined;
		}

		type JsonDiagnostic = {
			message: string;
			range: { line: number; character: number }[];
			severity: string;
			code?: string | number;
		};

		try {
			const schemaUri = createToolSchemaUri(toolId);
			const inputJson = JSON.stringify(updatedInput);
			const diagnostics = await this._commandService.executeCommand<JsonDiagnostic[]>('json.validate', schemaUri, inputJson) || [];
			if (diagnostics.length > 0) {
				return diagnostics.map(d => d.message).join('; ');
			}
		} catch (e) {
			this._logService.debug(`[LanguageModelToolsService#_validateUpdatedInput] json.validate command failed, skipping validation: ${toErrorMessage(e)}`);
		}

		return undefined;
	}

	async invokeTool(dto: IToolInvocation, countTokens: CountTokensCallback, token: CancellationToken): Promise<IToolResult> {
		this._logService.trace(`[LanguageModelToolsService#invokeTool] Invoking tool ${dto.toolId} with parameters ${JSON.stringify(dto.parameters)}`);

		const toolData = this._tools.get(dto.toolId)?.data;
		let model: IChatModel | undefined;
		let request: IChatRequestModel | undefined;
		if (dto.context?.sessionResource) {
			model = this._chatService.getSession(dto.context.sessionResource);
			request = model?.getRequests().at(-1);
			if (request?.response?.isCanceled || request?.response?.isComplete) {
				this._logService.debug(`[LanguageModelToolsService#invokeTool] Ignoring tool ${dto.toolId} for cancelled/complete request ${request.id}`);
				throw new CancellationError();
			}

			if (model?.workingDirectory && !dto.context.workingDirectory) {
				dto = { ...dto, context: { ...dto.context, workingDirectory: model.workingDirectory } };
			}
		}

		let pendingToolCallKey: string | undefined;
		let toolInvocation: ChatToolInvocation | undefined;
		if (this._pendingToolCalls.has(dto.callId)) {
			pendingToolCallKey = dto.callId;
			toolInvocation = this._pendingToolCalls.get(dto.callId);
		} else if (dto.chatStreamToolCallId && this._pendingToolCalls.has(dto.chatStreamToolCallId)) {
			pendingToolCallKey = dto.chatStreamToolCallId;
			toolInvocation = this._pendingToolCalls.get(dto.chatStreamToolCallId);
		}

		let requestId: string | undefined;
		let store: DisposableStore | undefined;
		if (dto.context && request) {
			requestId = request.id;
			store = new DisposableStore();
			if (!this._callsByRequestId.has(requestId)) {
				this._callsByRequestId.set(requestId, []);
			}
			const trackedCall: ITrackedCall = { store };
			this._callsByRequestId.get(requestId)!.push(trackedCall);

			const source = new CancellationTokenSource();
			store.add(toDisposable(() => {
				source.dispose(true);
			}));
			store.add(token.onCancellationRequested((() => {
				IChatToolInvocation.confirmWith(toolInvocation, { type: ToolConfirmKind.Denied });
				source.cancel();
			})));
			store.add(source.token.onCancellationRequested(() => {
				IChatToolInvocation.confirmWith(toolInvocation, { type: ToolConfirmKind.Denied });
			}));
			token = source.token;
		}

		const preToolUseHookResult = dto.preToolUseResult;
		if (preToolUseHookResult?.permissionDecision === 'deny') {
			const denialResult = this._handlePreToolUseDenial(dto, preToolUseHookResult, toolData, toolInvocation, request);
			if (pendingToolCallKey) {
				this._pendingToolCalls.delete(pendingToolCallKey);
			}
			return denialResult;
		}

		if (preToolUseHookResult?.updatedInput) {
			const validationError = await this._validateUpdatedInput(dto.toolId, toolData, preToolUseHookResult.updatedInput);
			if (validationError) {
				this._logService.warn(`[LanguageModelToolsService#invokeTool] Tool ${dto.toolId} updatedInput from preToolUse hook failed schema validation: ${validationError}`);
			} else {
				this._logService.debug(`[LanguageModelToolsService#invokeTool] Tool ${dto.toolId} input modified by preToolUse hook`);
				dto.parameters = preToolUseHookResult.updatedInput;
			}
		}

		this._onDidInvokeTool.fire({
			toolId: dto.toolId,
			sessionResource: dto.context?.sessionResource,
			requestId: dto.chatRequestId,
			subagentInvocationId: dto.subAgentInvocationId,
		});

		let tool = this._tools.get(dto.toolId);
		if (!tool) {
			throw new Error(`Tool ${dto.toolId} was not contributed`);
		}

		if (!tool.impl) {
			await this._extensionService.activateByEvent(`onLanguageModelTool:${dto.toolId}`);

			tool = this._tools.get(dto.toolId);
			if (!tool?.impl) {
				throw new Error(`Tool ${dto.toolId} does not have an implementation registered.`);
			}
		}

		const hadPendingInvocation = !!toolInvocation;
		if (hadPendingInvocation && pendingToolCallKey) {
			this._pendingToolCalls.delete(pendingToolCallKey);
		}

		let toolResult: IToolResult | undefined;
		let prepareTimeWatch: StopWatch | undefined;
		let invocationTimeWatch: StopWatch | undefined;
		let preparedInvocation: IPreparedToolInvocation | undefined;
		let activeTool = tool;
		try {
			if (dto.context) {
				if (!model) {
					throw new Error(`Tool called for unknown chat session`);
				}

				if (!request) {
					throw new Error(`Tool called for unknown chat request`);
				}
				dto.modelId = request.modelId;
				dto.userSelectedTools = request.userSelectedTools && { ...request.userSelectedTools };

				prepareTimeWatch = StopWatch.create(true);
				preparedInvocation = await this.prepareToolInvocationWithHookResult(tool, dto, preToolUseHookResult, token);
				prepareTimeWatch.stop();

				const { autoConfirmed: resolvedAutoConfirmed, preparedInvocation: updatedPreparedInvocation } = await this.resolveAutoConfirmFromHook(preToolUseHookResult, tool, dto, preparedInvocation, dto.context?.sessionResource);
				preparedInvocation = updatedPreparedInvocation;

				const preResolvedAutoConfirmed = resolvedAutoConfirmed
					?? (preToolUseHookResult?.permissionDecision === 'ask' ? undefined : dto.preApproved);

				const { autoConfirmed, skipExplanation: riskSkipExplanation } = await this._maybeApplyAutopilotRiskGate(tool, dto, preparedInvocation, preResolvedAutoConfirmed, token);

				if (hadPendingInvocation && toolInvocation) {
					if (toolInvocation.state.get().type === IChatToolInvocation.StateKind.Streaming) {
						toolInvocation.transitionFromStreaming(preparedInvocation, dto.parameters, autoConfirmed);
					} else {
						toolInvocation.updatePreparedInvocation(preparedInvocation, dto.parameters);
					}
				} else {
					toolInvocation = new ChatToolInvocation(preparedInvocation, tool.data, dto.chatStreamToolCallId ?? dto.callId, dto.subAgentInvocationId, dto.parameters);
					if (autoConfirmed) {
						IChatToolInvocation.confirmWith(toolInvocation, autoConfirmed);
					}

					this._chatService.appendProgress(request, toolInvocation);
				}

				dto.toolSpecificData = toolInvocation?.toolSpecificData;

				if (riskSkipExplanation) {
					this._logToolApprovalTelemetry(tool, dto, { type: ToolConfirmKind.Skipped });
					this._chatService.appendProgress(request, {
						kind: 'info',
						content: new MarkdownString(localize('autopilotRiskSkipped', "Autopilot skipped \"{0}\" because it was assessed as high-risk: {1}", tool.data.displayName, riskSkipExplanation)),
					});
					toolResult = {
						content: [{
							kind: 'text',
							value: `Autopilot skipped this tool call because it was automatically assessed as high-risk: ${riskSkipExplanation} The action was not performed. Do not retry it as-is — choose a safer approach or leave it for the user to run manually.`
						}]
					};
					return toolResult;
				}
				if (preparedInvocation?.confirmationMessages?.title) {
					if (!IChatToolInvocation.executionConfirmedOrDenied(toolInvocation) && !autoConfirmed) {
						this.playAccessibilitySignal([toolInvocation], dto.context?.sessionResource);
					}
					const userConfirmed = await IChatToolInvocation.awaitConfirmation(toolInvocation, token);
					this._logToolApprovalTelemetry(tool, dto, userConfirmed);
					if (userConfirmed.type === ToolConfirmKind.Denied) {
						throw new CancellationError();
					}
					if (userConfirmed.type === ToolConfirmKind.Skipped) {
						toolResult = {
							content: [{
								kind: 'text',
								value: 'The user chose to skip the tool call, they want to proceed without running it'
							}]
						};
						return toolResult;
					}
					if (userConfirmed.type === ToolConfirmKind.UserAction && userConfirmed.selectedButton) {
						dto.selectedCustomButton = userConfirmed.selectedButton;
					}

					if (dto.toolSpecificData?.kind === 'input') {
						dto.parameters = dto.toolSpecificData.rawInput;
						dto.toolSpecificData = undefined;
					}
				} else {
					this._logToolApprovalTelemetry(tool, dto, autoConfirmed ?? { type: ToolConfirmKind.ConfirmationNotNeeded });
				}
			} else {
				prepareTimeWatch = StopWatch.create(true);
				preparedInvocation = await this.prepareToolInvocationWithHookResult(tool, dto, preToolUseHookResult, token);
				prepareTimeWatch.stop();

				const { autoConfirmed: fallbackAutoConfirmed, preparedInvocation: updatedPreparedInvocation } = await this.resolveAutoConfirmFromHook(preToolUseHookResult, tool, dto, preparedInvocation, undefined);
				preparedInvocation = updatedPreparedInvocation;
				const autoConfirmed = fallbackAutoConfirmed
					?? (preToolUseHookResult?.permissionDecision === 'ask' ? undefined : dto.preApproved);
				if (preparedInvocation?.confirmationMessages?.title && !autoConfirmed) {
					const result = await this._dialogService.confirm({ message: renderAsPlaintext(preparedInvocation.confirmationMessages.title), detail: renderAsPlaintext(preparedInvocation.confirmationMessages.message!) });
					if (!result.confirmed) {
						throw new CancellationError();
					}
				}
				dto.toolSpecificData = preparedInvocation?.toolSpecificData;
			}

			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			invocationTimeWatch = StopWatch.create(true);
			const currentTool = this._tools.get(dto.toolId);
			if (!currentTool) {
				throw new Error(`Tool ${dto.toolId} was not contributed`);
			}
			if (!currentTool.impl) {
				throw new Error(`Tool ${dto.toolId} does not have an implementation registered.`);
			}
			activeTool = currentTool;
			toolResult = await currentTool.impl.invoke(dto, countTokens, {
				report: step => {
					toolInvocation?.acceptProgress(step);
				}
			}, token);
			invocationTimeWatch.stop();
			const compressed = this._toolResultCompressor.maybeCompress(activeTool.data.id, dto.parameters, toolResult);
			if (compressed) {
				toolResult = compressed;
			}
			this.ensureToolDetails(dto, toolResult, activeTool.data, toolInvocation);

			const afterExecuteState = await toolInvocation?.didExecuteTool(toolResult, undefined, () =>
				this.shouldAutoConfirmPostExecution(activeTool.data.id, activeTool.data.runsInWorkspace, activeTool.data.source, dto.parameters, dto.context?.sessionResource, dto.chatRequestId, dto.context?.workingDirectory));

			if (toolInvocation && afterExecuteState?.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
				const postConfirm = await IChatToolInvocation.awaitPostConfirmation(toolInvocation, token);
				if (postConfirm.type === ToolConfirmKind.Denied) {
					throw new CancellationError();
				}
				if (postConfirm.type === ToolConfirmKind.Skipped) {
					toolResult = {
						content: [{
							kind: 'text',
							value: 'The tool executed but the user chose not to share the results'
						}]
					};
				}
			}

			this._telemetryService.publicLog2<LanguageModelToolInvokedEvent, LanguageModelToolInvokedClassification>(
				'languageModelToolInvoked',
				{
					result: 'success',
					chatSessionId: dto.context?.sessionResource ? chatSessionResourceToId(dto.context.sessionResource) : undefined,
					toolId: activeTool.data.id,
					toolExtensionId: activeTool.data.source.type === 'extension' ? activeTool.data.source.extensionId.value : undefined,
					toolSourceKind: activeTool.data.source.type,
					prepareTimeMs: prepareTimeWatch?.elapsed(),
					invocationTimeMs: invocationTimeWatch?.elapsed(),
				});
			return toolResult;
		} catch (err) {
			const result = isCancellationError(err) ? 'userCancelled' : 'error';
			this._telemetryService.publicLog2<LanguageModelToolInvokedEvent, LanguageModelToolInvokedClassification>(
				'languageModelToolInvoked',
				{
					result,
					chatSessionId: dto.context?.sessionResource ? chatSessionResourceToId(dto.context.sessionResource) : undefined,
					toolId: activeTool.data.id,
					toolExtensionId: activeTool.data.source.type === 'extension' ? activeTool.data.source.extensionId.value : undefined,
					toolSourceKind: activeTool.data.source.type,
					prepareTimeMs: prepareTimeWatch?.elapsed(),
					invocationTimeMs: invocationTimeWatch?.elapsed(),
				});
			if (!isCancellationError(err)) {
				this._logService.error(`[LanguageModelToolsService#invokeTool] Error from tool ${dto.toolId} with parameters ${JSON.stringify(dto.parameters)}:\n${toErrorMessage(err, true)}`);
			}

			toolResult ??= { content: [] };
			toolResult.toolResultError = err instanceof Error ? err.message : String(err);
			if (activeTool.data.alwaysDisplayInputOutput) {
				toolResult.toolResultDetails = { input: this.formatToolInput(dto), output: [{ type: 'embed', isText: true, value: String(err) }], isError: true };
			}

			throw err;
		} finally {
			toolInvocation?.didExecuteTool(toolResult, true);
			if (store) {
				this.cleanupCallDisposables(requestId, store);
			}
		}
	}

	private async prepareToolInvocationWithHookResult(tool: IToolEntry, dto: IToolInvocation, hookResult: IExternalPreToolUseHookResult | undefined, token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		let forceConfirmationReason: string | undefined;
		if (hookResult?.permissionDecision === 'ask') {
			const hookMessage = localize('preToolUseHookRequiredConfirmation', "{0} required confirmation", HookType.PreToolUse);
			forceConfirmationReason = hookResult.permissionDecisionReason
				? `${hookMessage}: ${hookResult.permissionDecisionReason}`
				: hookMessage;
		}
		return this.prepareToolInvocation(tool, dto, forceConfirmationReason, token);
	}

	private _logToolApprovalTelemetry(tool: IToolEntry, dto: IToolInvocation, reason: ConfirmedReason): void {
		const confirmKindNames: Record<ToolConfirmKind, string> = {
			[ToolConfirmKind.Denied]: 'denied',
			[ToolConfirmKind.ConfirmationNotNeeded]: 'confirmationNotNeeded',
			[ToolConfirmKind.Setting]: 'setting',
			[ToolConfirmKind.LmServicePerTool]: 'lmServicePerTool',
			[ToolConfirmKind.UserAction]: 'userAction',
			[ToolConfirmKind.Skipped]: 'skipped',
		};
		const allowedConfirmationNotNeededReasons = new Set([autoApproveAllReason, 'inlineChat']);
		let confirmationNotNeededReason: string | undefined;
		if (reason.type === ToolConfirmKind.ConfirmationNotNeeded && reason.reason) {
			const raw = typeof reason.reason === 'string' ? reason.reason : reason.reason.value;
			confirmationNotNeededReason = allowedConfirmationNotNeededReasons.has(raw) ? raw : 'other';
		}
		const terminalData = dto.toolSpecificData?.kind === 'terminal' ? dto.toolSpecificData : undefined;
		this._telemetryService.publicLog2<ToolApprovalEvent, ToolApprovalClassification>(
			'chat.toolApproval',
			{
				confirmKind: confirmKindNames[reason.type],
				requestId: dto.chatRequestId,
				settingId: reason.type === ToolConfirmKind.Setting ? reason.id : undefined,
				lmServiceScope: reason.type === ToolConfirmKind.LmServicePerTool ? reason.scope : undefined,
				customButtonKind: reason.type === ToolConfirmKind.UserAction ? reason.selectedButtonKind : undefined,
				confirmationNotNeededReason,
				sandboxWrapped: terminalData?.commandLine.isSandboxWrapped,
				requestUnsandboxedExecution: terminalData?.requestUnsandboxedExecution,
				chatSessionId: dto.context?.sessionResource ? chatSessionResourceToId(dto.context.sessionResource) : undefined,
				toolId: tool.data.id,
				toolExtensionId: tool.data.source.type === 'extension' ? tool.data.source.extensionId.value : undefined,
				toolSourceKind: tool.data.source.type,
			});
	}

	private async resolveAutoConfirmFromHook(
		hookResult: IExternalPreToolUseHookResult | undefined,
		tool: IToolEntry,
		dto: IToolInvocation,
		preparedInvocation: IPreparedToolInvocation | undefined,
		sessionResource: URI | undefined,
	): Promise<{ autoConfirmed: ConfirmedReason | undefined; preparedInvocation: IPreparedToolInvocation | undefined }> {
		if (hookResult?.permissionDecision === 'allow') {
			this._logService.debug(`[LanguageModelToolsService#invokeTool] Tool ${dto.toolId} auto-approved by preToolUse hook`);
			return { autoConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded, reason: localize('hookAllowed', "Allowed by hook") }, preparedInvocation };
		}

		if (hookResult?.permissionDecision === 'ask') {
			this._logService.debug(`[LanguageModelToolsService#invokeTool] Tool ${dto.toolId} requires confirmation (preToolUse hook returned 'ask')`);
			if (!preparedInvocation?.confirmationMessages?.title) {
				if (!preparedInvocation) {
					preparedInvocation = {};
				}
				const fullReferenceName = getToolFullReferenceName(tool.data);
				const hookReason = hookResult.permissionDecisionReason;
				const hookNote = hookReason
					? localize('hookRequiresConfirmation.messageWithReason', "{0} hook required confirmation: {1}", HookType.PreToolUse, hookReason)
					: localize('hookRequiresConfirmation.message', "{0} hook required confirmation", HookType.PreToolUse);
				preparedInvocation.confirmationMessages = {
					...preparedInvocation.confirmationMessages,
					title: localize('hookRequiresConfirmation.title', "Use the '{0}' tool?", fullReferenceName),
					message: new MarkdownString(`_${hookNote}_`),
					allowAutoConfirm: false,
				};
				preparedInvocation.toolSpecificData = {
					kind: 'input',
					rawInput: dto.parameters,
				};
			} else {
				const hookReason = hookResult.permissionDecisionReason;
				const hookNote = hookReason
					? localize('hookRequiresConfirmation.note', "{0} hook required confirmation: {1}", HookType.PreToolUse, hookReason)
					: localize('hookRequiresConfirmation.noteNoReason', "{0} hook required confirmation", HookType.PreToolUse);

				const existing = preparedInvocation.confirmationMessages!;
				if (preparedInvocation.toolSpecificData?.kind === 'terminal') {
					const existingDisclaimerText = existing.disclaimer
						? (typeof existing.disclaimer === 'string' ? existing.disclaimer : existing.disclaimer.value)
						: undefined;
					const combinedDisclaimer = existingDisclaimerText
						? `${hookNote}\n\n${existingDisclaimerText}`
						: hookNote;
					preparedInvocation.confirmationMessages = {
						...existing,
						disclaimer: combinedDisclaimer,
						allowAutoConfirm: false,
					};
				} else {
					const msgText = typeof existing.message === 'string' ? existing.message : existing.message?.value ?? '';
					preparedInvocation.confirmationMessages = {
						...existing,
						message: new MarkdownString(`_${hookNote}_\n\n${msgText}`),
						allowAutoConfirm: false,
					};
				}
			}
			return { autoConfirmed: undefined, preparedInvocation };
		}

		const approveCombination = preparedInvocation?.confirmationMessages?.approveCombination;
		let combination: { label: string; key: string } | undefined;
		if (approveCombination) {
			combination = {
				label: typeof approveCombination.label === 'string' ? approveCombination.label : approveCombination.label.value,
				key: approveCombination.key,
			};
		}
		const autoConfirmed = await this.shouldAutoConfirm(tool.data.id, tool.data.runsInWorkspace, tool.data.source, dto.parameters, sessionResource, dto.chatRequestId, combination, dto.context?.workingDirectory);
		return { autoConfirmed, preparedInvocation };
	}

	private async _maybeApplyAutopilotRiskGate(
		tool: IToolEntry,
		dto: IToolInvocation,
		preparedInvocation: IPreparedToolInvocation | undefined,
		autoConfirmed: ConfirmedReason | undefined,
		token: CancellationToken,
	): Promise<{ autoConfirmed: ConfirmedReason | undefined; skipExplanation?: string }> {
		const isTerminalTool = tool.data.id === TerminalToolId.RunInTerminal;
		const isFetchTool = fetchWebPageToolIds.has(tool.data.id);
		const isAlwaysClassifyTool = isTerminalTool || isFetchTool;

		const isBlanketSessionApprove = autoConfirmed?.type === ToolConfirmKind.ConfirmationNotNeeded
			&& autoConfirmed.reason === autoApproveAllReason;
		const isSelfApprovedAlwaysClassify = isAlwaysClassifyTool
			&& autoConfirmed === undefined
			&& !preparedInvocation?.confirmationMessages?.title;
		if (!isBlanketSessionApprove && !isSelfApprovedAlwaysClassify) {
			return { autoConfirmed };
		}

		if (!isAlwaysClassifyTool && !preparedInvocation?.confirmationMessages?.title) {
			return { autoConfirmed };
		}

		if (this._configurationService.getValue<boolean>(ChatConfiguration.AutopilotAdvancedEnabled) !== true) {
			return { autoConfirmed };
		}

		const sessionResource = dto.context?.sessionResource;
		if (!sessionResource || getChatSessionType(sessionResource) !== localChatSessionType) {
			return { autoConfirmed };
		}
		if (!this._isSessionInAutopilotLevel(sessionResource)) {
			return { autoConfirmed };
		}

		try {
			const assessment = await this._riskAssessmentService.assess(tool.data, dto.parameters, token, undefined, { ignoreEnablement: true });
			if (token.isCancellationRequested) {
				return { autoConfirmed };
			}
			if (assessment?.risk === ToolRiskLevel.Red) {
				const fallbackExplanation = localize('autopilotRiskSkipFallback', "The action was assessed as potentially destructive or irreversible.");
				const explanation = assessment.explanation.trim() || fallbackExplanation;
				this._logService.info(`[LanguageModelToolsService#invokeTool] Autopilot skipping high-risk tool ${tool.data.id}: ${explanation}`);
				return { autoConfirmed: { type: ToolConfirmKind.Skipped }, skipExplanation: explanation };
			}
		} catch (err) {
			this._logService.warn(`[LanguageModelToolsService#invokeTool] Autopilot risk assessment failed for tool ${tool.data.id}, allowing: ${toErrorMessage(err)}`);
		}

		return { autoConfirmed };
	}

	private async prepareToolInvocation(tool: IToolEntry, dto: IToolInvocation, forceConfirmationReason: string | undefined, token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		let prepared: IPreparedToolInvocation | undefined;
		if (tool.impl!.prepareToolInvocation) {
			const preparePromise = tool.impl!.prepareToolInvocation({
				parameters: dto.parameters,
				toolCallId: dto.callId,
				chatRequestId: dto.chatRequestId,
				chatSessionResource: dto.context?.sessionResource,
				chatInteractionId: dto.chatInteractionId,
				modelId: dto.modelId,
				forceConfirmationReason: forceConfirmationReason,
				workingDirectory: dto.context?.workingDirectory,
			}, token);

			const raceResult = await Promise.race([
				timeout(3000, token).then(() => 'timeout'),
				preparePromise
			]);
			if (raceResult === 'timeout' && dto.context) {
				this._onDidPrepareToolCallBecomeUnresponsive.fire({
					sessionResource: dto.context.sessionResource,
					toolData: tool.data
				});
			}

			prepared = await preparePromise;
		}

		const isEligibleForAutoApproval = this.isToolEligibleForAutoApproval(tool.data);

		if (!isEligibleForAutoApproval && !prepared?.confirmationMessages?.title) {
			if (!prepared) {
				prepared = {};
			}
			const fullReferenceName = getToolFullReferenceName(tool.data);

			prepared.confirmationMessages = {
				...prepared.confirmationMessages,
				title: localize('defaultToolConfirmation.title', 'Confirm tool execution'),
				message: localize('defaultToolConfirmation.message', 'Run the \'{0}\' tool?', fullReferenceName),
				disclaimer: toolIdsThatCannotBeAutoApproved.has(tool.data.id) ? undefined : new MarkdownString(localize('defaultToolConfirmation.disclaimer', 'Auto approval for \'{0}\' is restricted via {1}.', getToolFullReferenceName(tool.data), createMarkdownCommandLink({ text: '`' + ChatConfiguration.EligibleForAutoApproval + '`', id: 'workbench.action.openSettings', arguments: [ChatConfiguration.EligibleForAutoApproval], tooltip: localize('openSettings.autoApproval.tooltip', 'Open settings to configure auto-approval') }, false)), { isTrusted: true }),
				allowAutoConfirm: false,
			};
		}

		if (!isEligibleForAutoApproval && prepared?.confirmationMessages?.title) {
			prepared.confirmationMessages.disclaimer = toolIdsThatCannotBeAutoApproved.has(tool.data.id) ? undefined : new MarkdownString(localize('defaultToolConfirmation.disclaimer', 'Auto approval for \'{0}\' is restricted via {1}.', getToolFullReferenceName(tool.data), createMarkdownCommandLink({ text: '`' + ChatConfiguration.EligibleForAutoApproval + '`', id: 'workbench.action.openSettings', arguments: [ChatConfiguration.EligibleForAutoApproval], tooltip: localize('openSettings.autoApproval.tooltip', 'Open settings to configure auto-approval') }, false)), { isTrusted: true });
		}

		if (prepared?.confirmationMessages?.title) {
			if (this._isAutoApprovePolicyRestricted()) {
				prepared.confirmationMessages.allowAutoConfirm = false;
			} else if (prepared.toolSpecificData?.kind !== 'terminal' && prepared.confirmationMessages.allowAutoConfirm !== false) {
				prepared.confirmationMessages.allowAutoConfirm = isEligibleForAutoApproval;
			}

			if (!prepared.toolSpecificData && tool.data.alwaysDisplayInputOutput) {
				prepared.toolSpecificData = {
					kind: 'input',
					rawInput: dto.parameters,
				};
			}
		}

		return prepared;
	}

	beginToolCall(options: IBeginToolCallOptions): IChatToolInvocation | undefined {
		const toolEntry = this._tools.get(options.toolId);
		if (!toolEntry) {
			return undefined;
		}

		if (!options.force && !toolEntry.impl?.handleToolStream) {
			return undefined;
		}

		const invocation = ChatToolInvocation.createStreaming({
			toolCallId: options.toolCallId,
			toolId: options.toolId,
			toolData: toolEntry.data,
			subagentInvocationId: options.subagentInvocationId,
			chatRequestId: options.chatRequestId,
		});

		this._pendingToolCalls.set(options.toolCallId, invocation);

		if (options.sessionResource) {
			const model = this._chatService.getSession(options.sessionResource);
			if (model) {
				const request = (options.chatRequestId
					? model.getRequests().find(r => r.id === options.chatRequestId)
					: undefined) ?? model.getRequests().at(-1);
				if (request) {
					this._chatService.appendProgress(request, invocation);
				}
			}
		}

		this._callHandleToolStream(toolEntry, invocation, options.toolCallId, undefined, CancellationToken.None);

		return invocation;
	}

	private async _callHandleToolStream(toolEntry: IToolEntry, invocation: ChatToolInvocation, toolCallId: string, rawInput: unknown, token: CancellationToken): Promise<void> {
		if (!toolEntry.impl?.handleToolStream) {
			return;
		}
		try {
			const result = await toolEntry.impl.handleToolStream({
				toolCallId,
				rawInput,
				chatRequestId: invocation.chatRequestId,
			}, token);

			if (result?.invocationMessage) {
				invocation.updateStreamingMessage(result.invocationMessage);
			}
		} catch (error) {
			this._logService.error(`[LanguageModelToolsService#_callHandleToolStream] Error calling handleToolStream for tool ${toolEntry.data.id}:`, error);
		}
	}

	async updateToolStream(toolCallId: string, partialInput: unknown, token: CancellationToken): Promise<void> {
		const invocation = this._pendingToolCalls.get(toolCallId);
		if (!invocation) {
			return;
		}

		invocation.updatePartialInput(partialInput);

		const toolEntry = this._tools.get(invocation.toolId);
		if (toolEntry) {
			await this._callHandleToolStream(toolEntry, invocation, toolCallId, partialInput, token);
		}
	}

	private playAccessibilitySignal(toolInvocations: ChatToolInvocation[], chatSessionResource: URI | undefined): void {
		const autoApproved = this._configurationService.getValue(ChatConfiguration.GlobalAutoApprove);
		if (autoApproved) {
			return;
		}

		if (chatSessionResource) {
			const model = this._chatService.getSession(chatSessionResource);
			const request = model?.getRequests().at(-1);
			if (isAutoApproveLevel(request?.modeInfo?.permissionLevel) || this._isSessionLiveAutoApproveLevel(chatSessionResource)) {
				return;
			}
		}

		const pendingInvocations = toolInvocations.filter(inv => !IChatToolInvocation.executionConfirmedOrDenied(inv));
		if (pendingInvocations.length === 0) {
			return;
		}

		const setting: { sound?: 'auto' | 'on' | 'off'; announcement?: 'auto' | 'off' } | undefined = this._configurationService.getValue(AccessibilitySignal.chatUserActionRequired.settingsKey);
		if (!setting) {
			return;
		}
		const soundEnabled = setting.sound === 'on' || (setting.sound === 'auto' && (this._accessibilityService.isScreenReaderOptimized()));
		const announcementEnabled = this._accessibilityService.isScreenReaderOptimized() && setting.announcement === 'auto';
		if (soundEnabled || announcementEnabled) {
			this._accessibilitySignalService.playSignal(AccessibilitySignal.chatUserActionRequired, { customAlertMessage: this._instantiationService.invokeFunction(getToolConfirmationAlert, pendingInvocations), userGesture: true, modality: !soundEnabled ? 'announcement' : undefined });
		}
	}

	private ensureToolDetails(dto: IToolInvocation, toolResult: IToolResult, toolData: IToolData, toolInvocation: ChatToolInvocation | undefined): void {
		if (!toolResult.toolResultDetails && (toolData.alwaysDisplayInputOutput || (this.toolResultHasImages(toolResult) && !this.toolResultMessageHasImageFileWidgets(toolResult, toolInvocation)))) {
			toolResult.toolResultDetails = {
				input: this.formatToolInput(dto),
				output: this.toolResultToIO(toolResult),
			};
		}
	}

	private toolResultHasImages(toolResult: IToolResult): boolean {
		return toolResult.content.some(part => part.kind === 'data' && part.value.mimeType?.startsWith('image/'));
	}

	private toolResultMessageHasImageFileWidgets(toolResult: IToolResult, toolInvocation: ChatToolInvocation | undefined): boolean {
		const message = toolResult.toolResultMessage ?? toolInvocation?.pastTenseMessage;
		if (!message) {
			return false;
		}
		const value = typeof message === 'string' ? message : message.value;
		const linkPattern = /\[\s*\]\((?<uri>[^)]+)\)/g;
		let match: RegExpExecArray | null;
		while ((match = linkPattern.exec(value)) !== null) {
			try {
				const parsed = URI.parse(match.groups!.uri);
				const mime = getMediaMime(parsed.path);
				if (mime?.startsWith('image/')) {
					return true;
				}
			} catch {
			}
		}
		return false;
	}

	private formatToolInput(dto: IToolInvocation): string {
		return JSON.stringify(dto.parameters, undefined, 2);
	}

	private toolResultToIO(toolResult: IToolResult): IToolResultInputOutputDetails['output'] {
		return toolResult.content.map(part => {
			if (part.kind === 'text') {
				return { type: 'embed', isText: true, value: part.value };
			} else if (part.kind === 'promptTsx') {
				return { type: 'embed', isText: true, value: stringifyPromptTsxPart(part) };
			} else if (part.kind === 'data') {
				return { type: 'embed', value: encodeBase64(part.value.data), mimeType: part.value.mimeType };
			} else {
				assertNever(part);
			}
		});
	}





	private _isAutoApprovePolicyRestricted(): boolean {
		const inspected = this._configurationService.inspect<boolean>(ChatConfiguration.GlobalAutoApprove);
		return inspected.policyValue === false;
	}

	private _isSessionLiveAutoApproveLevel(chatSessionResource: URI): boolean {
		const widget = this._chatWidgetService.getWidgetBySessionResource(chatSessionResource)
			?? this._chatWidgetService.lastFocusedWidget;
		return !!widget && isAutoApproveLevel(widget.input.currentModeInfo.permissionLevel);
	}

	private _isSessionInAutoApproveLevel(chatSessionResource: URI | undefined): boolean {
		if (!chatSessionResource) {
			return false;
		}
		const model = this._chatService.getSession(chatSessionResource);
		const request = model?.getRequests().at(-1);
		return isAutoApproveLevel(request?.modeInfo?.permissionLevel) || this._isSessionLiveAutoApproveLevel(chatSessionResource);
	}

	private _isSessionLiveAutopilotLevel(chatSessionResource: URI): boolean {
		const widget = this._chatWidgetService.getWidgetBySessionResource(chatSessionResource)
			?? this._chatWidgetService.lastFocusedWidget;
		return !!widget && isAutopilotLevel(widget.input.currentModeInfo.permissionLevel);
	}

	private _isSessionInAutopilotLevel(chatSessionResource: URI | undefined): boolean {
		if (!chatSessionResource) {
			return false;
		}
		const model = this._chatService.getSession(chatSessionResource);
		const request = model?.getRequests().at(-1);
		return isAutopilotLevel(request?.modeInfo?.permissionLevel) || this._isSessionLiveAutopilotLevel(chatSessionResource);
	}

	private getEligibleForAutoApprovalSpecialCase(toolData: IToolData): string | undefined {
		if (toolData.id === 'vscode_fetchWebPage_internal') {
			return 'fetch';
		}
		return undefined;
	}

	private isToolEligibleForAutoApproval(toolData: IToolData): boolean {
		const fullReferenceName = this.getEligibleForAutoApprovalSpecialCase(toolData) ?? getToolFullReferenceName(toolData);
		if (toolData.id === 'copilot_fetchWebPage') {
			return true;
		}
		if (toolIdsThatCannotBeAutoApproved.has(toolData.id)) {
			return false;
		}
		const eligibilityConfig = this._configurationService.getValue<Record<string, boolean>>(ChatConfiguration.EligibleForAutoApproval);
		if (eligibilityConfig && typeof eligibilityConfig === 'object' && fullReferenceName) {
			if (Object.prototype.hasOwnProperty.call(eligibilityConfig, fullReferenceName)) {
				return eligibilityConfig[fullReferenceName];
			}
			if (toolData.legacyToolReferenceFullNames) {
				for (const legacyName of toolData.legacyToolReferenceFullNames) {
					if (Object.prototype.hasOwnProperty.call(eligibilityConfig, legacyName)) {
						return eligibilityConfig[legacyName];
					}
					if (legacyName.includes('/')) {
						const trimmedLegacyName = legacyName.split('/').pop();
						if (trimmedLegacyName && Object.prototype.hasOwnProperty.call(eligibilityConfig, trimmedLegacyName)) {
							return eligibilityConfig[trimmedLegacyName];
						}
					}
				}
			}
		}
		return true;
	}

	private async shouldAutoConfirm(toolId: string, runsInWorkspace: boolean | undefined, source: ToolDataSource, parameters: unknown, chatSessionResource: URI | undefined, chatRequestId: string | undefined, combination?: { label: string; key: string }, workingDirectory?: URI): Promise<ConfirmedReason | undefined> {
		const tool = this._tools.get(toolId);
		if (!tool) {
			return undefined;
		}


		if (chatSessionResource && !this._isAutoApprovePolicyRestricted() && this._isSessionInAutoApproveLevel(chatSessionResource)) {
			if (!(toolIdsThatCannotBeAutoApproved.has(tool.data.id) && getChatSessionType(chatSessionResource) !== localChatSessionType)) {
				return { type: ToolConfirmKind.ConfirmationNotNeeded, reason: autoApproveAllReason };
			}
		}

		if (!this.isToolEligibleForAutoApproval(tool.data)) {
			return undefined;
		}

		const reason = this._confirmationService.getPreConfirmAction({ toolId, source, parameters, chatSessionResource, workingDirectory, combination });
		if (reason) {
			return reason;
		}

		const config = this._configurationService.inspect<boolean | Record<string, boolean>>(ChatConfiguration.GlobalAutoApprove);


		let value = config.value ?? config.defaultValue;
		if (typeof runsInWorkspace === 'boolean') {
			value = config.userLocalValue ?? config.applicationValue;
			if (runsInWorkspace) {
				value = config.workspaceValue ?? config.workspaceFolderValue ?? config.userRemoteValue ?? value;
			}
		}

		const autoConfirm = value === true || (typeof value === 'object' && value.hasOwnProperty(toolId) && value[toolId] === true);
		if (autoConfirm) {
			if (await this._checkGlobalAutoApprove()) {
				return { type: ToolConfirmKind.Setting, id: ChatConfiguration.GlobalAutoApprove };
			}
		}

		return undefined;
	}

	private async shouldAutoConfirmPostExecution(toolId: string, runsInWorkspace: boolean | undefined, source: ToolDataSource, parameters: unknown, chatSessionResource: URI | undefined, chatRequestId: string | undefined, workingDirectory?: URI): Promise<ConfirmedReason | undefined> {

		const sessionAutoApprove = chatSessionResource && !this._isAutoApprovePolicyRestricted() && this._isSessionInAutoApproveLevel(chatSessionResource);
		if (sessionAutoApprove) {
			if (!(toolIdsThatCannotBeAutoApproved.has(toolId) && getChatSessionType(chatSessionResource!) !== localChatSessionType)) {
				return { type: ToolConfirmKind.ConfirmationNotNeeded, reason: autoApproveAllReason };
			}
		}

		if (this._configurationService.getValue<boolean>(ChatConfiguration.GlobalAutoApprove) && !sessionAutoApprove && await this._checkGlobalAutoApprove()) {
			return { type: ToolConfirmKind.Setting, id: ChatConfiguration.GlobalAutoApprove };
		}

		return this._confirmationService.getPostConfirmAction({ toolId, source, parameters, chatSessionResource, workingDirectory });
	}

	private async _checkGlobalAutoApprove(): Promise<boolean> {
		const optedIn = this._storageService.getBoolean(AutoApproveStorageKeys.GlobalAutoApproveOptIn, StorageScope.APPLICATION, false);
		if (optedIn) {
			return true;
		}

		if (this._contextKeyService.getContextKeyValue(SkipAutoApproveConfirmationKey) === true) {
			return true;
		}

		if (this._pendingGlobalAutoApproveCheck) {
			return this._pendingGlobalAutoApproveCheck;
		}

		this._pendingGlobalAutoApproveCheck = this._doCheckGlobalAutoApprove();
		try {
			return await this._pendingGlobalAutoApproveCheck;
		} finally {
			this._pendingGlobalAutoApproveCheck = undefined;
		}
	}

	private async _doCheckGlobalAutoApprove(): Promise<boolean> {
		const store = new DisposableStore();
		try {
			const cts = new CancellationTokenSource();
			store.add(cts);
			store.add(this._storageService.onDidChangeValue(StorageScope.APPLICATION, AutoApproveStorageKeys.GlobalAutoApproveOptIn, store)(() => {
				if (this._storageService.getBoolean(AutoApproveStorageKeys.GlobalAutoApproveOptIn, StorageScope.APPLICATION, false)) {
					cts.cancel();
				}
			}));

			const promptResult = await this._dialogService.prompt({
				type: Severity.Warning,
				message: localize('autoApprove2.title', 'Enable global auto approve?'),
				buttons: [
					{
						label: localize('autoApprove2.button.enable', 'Enable'),
						run: () => true
					},
					{
						label: localize('autoApprove2.button.disable', 'Disable'),
						run: () => false
					},
				],
				custom: {
					icon: Codicon.warning,
					markdownDetails: [{
						markdown: new MarkdownString(globalAutoApproveDescription.value, { isTrusted: { enabledCommands: ['workbench.action.openSettings'] } }),
					}],
				},
				token: cts.token,
			});

			if (cts.token.isCancellationRequested) {
				return true;
			}

			if (promptResult.result !== true) {
				await this._configurationService.updateValue(ChatConfiguration.GlobalAutoApprove, false);
				return false;
			}

			this._storageService.store(AutoApproveStorageKeys.GlobalAutoApproveOptIn, true, StorageScope.APPLICATION, StorageTarget.USER);
			return true;
		} finally {
			store.dispose();
		}
	}

	private cleanupCallDisposables(requestId: string | undefined, store: DisposableStore): void {
		if (requestId) {
			const disposables = this._callsByRequestId.get(requestId);
			if (disposables) {
				const index = disposables.findIndex(d => d.store === store);
				if (index > -1) {
					disposables.splice(index, 1);
				}
				if (disposables.length === 0) {
					this._callsByRequestId.delete(requestId);
				}
			}
		}

		store.dispose();
	}

	cancelToolCallsForRequest(requestId: string): void {
		const calls = this._callsByRequestId.get(requestId);
		if (calls) {
			calls.forEach(call => call.store.dispose());
			this._callsByRequestId.delete(requestId);
		}

		for (const [toolCallId, invocation] of this._pendingToolCalls) {
			if (invocation.chatRequestId === requestId) {
				this._pendingToolCalls.delete(toolCallId);
			}
		}
	}

	private static readonly githubMCPServerAliases = ['github/github-mcp-server', 'io.github.github/github-mcp-server', 'github-mcp-server'];
	private static readonly playwrightMCPServerAliases = ['microsoft/playwright-mcp', 'com.microsoft/playwright-mcp'];

	private *getToolSetAliases(toolSet: ToolSet, fullReferenceName: string): Iterable<string> {
		if (fullReferenceName !== toolSet.referenceName) {
			yield toolSet.referenceName;
		}
		if (toolSet.legacyFullNames) {
			yield* toolSet.legacyFullNames;
		}
		switch (toolSet.referenceName) {
			case 'github':
				for (const alias of LanguageModelToolsService.githubMCPServerAliases) {
					yield alias + '/*';
				}
				break;
			case 'playwright':
				for (const alias of LanguageModelToolsService.playwrightMCPServerAliases) {
					yield alias + '/*';
				}
				break;
			case SpecedToolAliases.execute:
				yield 'shell';
				break;
			case SpecedToolAliases.agent:
				yield VSCodeToolReference.runSubagent;
				yield 'custom-agent';
				break;
		}
	}

	private * getToolAliases(toolSet: IToolData, fullReferenceName: string): Iterable<string> {
		const referenceName = toolSet.toolReferenceName ?? toolSet.displayName;
		if (fullReferenceName !== referenceName && referenceName !== VSCodeToolReference.runSubagent) {
			yield referenceName;
		}
		if (toolSet.legacyToolReferenceFullNames) {
			for (const legacyName of toolSet.legacyToolReferenceFullNames) {
				yield legacyName;
				const lastSlashIndex = legacyName.lastIndexOf('/');
				if (lastSlashIndex !== -1) {
					yield legacyName.substring(lastSlashIndex + 1);
				}
			}
		}
		const slashIndex = fullReferenceName.lastIndexOf('/');
		if (slashIndex !== -1) {
			switch (fullReferenceName.substring(0, slashIndex)) {
				case 'github':
					for (const alias of LanguageModelToolsService.githubMCPServerAliases) {
						yield alias + fullReferenceName.substring(slashIndex);
					}
					break;
				case 'playwright':
					for (const alias of LanguageModelToolsService.playwrightMCPServerAliases) {
						yield alias + fullReferenceName.substring(slashIndex);
					}
					break;
			}
		}
	}

	toToolAndToolSetEnablementMap(fullReferenceNames: readonly string[], model: ILanguageModelChatMetadata | undefined): ToolAndToolSetEnablementMap {
		const toolOrToolSetNames = new Set(fullReferenceNames);
		const result = new Map<IToolSet | IToolData, boolean>();
		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				const enabled = toolOrToolSetNames.has(fullReferenceName) || Iterable.some(this.getToolSetAliases(tool, fullReferenceName), name => toolOrToolSetNames.has(name));
				const scoped = model ? new ToolSetForModel(tool, model) : tool;
				result.set(scoped, enabled);
				if (enabled) {
					for (const memberTool of scoped.getTools()) {
						result.set(memberTool, true);
					}
				}
			} else {
				if (!this.isToolEnabledForModel(tool, model)) {
					continue;
				}

				if (!result.has(tool)) {
					const enabled = toolOrToolSetNames.has(fullReferenceName)
						|| Iterable.some(this.getToolAliases(tool, fullReferenceName), name => toolOrToolSetNames.has(name))
						|| !!tool.legacyToolReferenceFullNames?.some(toolFullName => {
							const index = toolFullName.lastIndexOf('/');
							return index !== -1 && toolOrToolSetNames.has(toolFullName.substring(0, index));
						});
					result.set(tool, enabled);
				}
			}
		}

		for (const toolSet of this._toolSets) {
			if (toolSet.source.type === 'user') {
				const enabled = Iterable.every(toolSet.getTools(), t => result.get(t) === true);
				result.set(toolSet, enabled);
			}
		}
		return ToolAndToolSetEnablementMap.fromMap(result);
	}

	toFullReferenceNames(map: ToolAndToolSetEnablementMap): string[] {
		const result: string[] = [];
		const toolsCoveredByEnabledToolSet = new Set<IToolData>();

		const enabledToolSetIds = new Set<string>();
		const enabledToolIds = new Set<string>();
		for (const [tool, enabled] of map) {
			if (enabled) {
				if (isToolSet(tool)) {
					enabledToolSetIds.add(tool.id);
				} else {
					enabledToolIds.add(tool.id);
				}
			}
		}
		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				if (enabledToolSetIds.has(tool.id)) {
					result.push(fullReferenceName);
					for (const memberTool of tool.getTools()) {
						toolsCoveredByEnabledToolSet.add(memberTool);
					}
				}
			} else {
				if (enabledToolIds.has(tool.id) && !toolsCoveredByEnabledToolSet.has(tool)) {
					result.push(fullReferenceName);
				}
			}
		}
		return result;
	}

	toToolReferences(variableReferences: readonly IVariableReference[]): ChatRequestToolReferenceEntry[] {
		const toolsOrToolSetByName = new Map<string, ToolSet | IToolData>();
		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			toolsOrToolSetByName.set(fullReferenceName, tool);
		}

		const result: ChatRequestToolReferenceEntry[] = [];
		for (const ref of variableReferences) {
			const toolOrToolSet = toolsOrToolSetByName.get(ref.name);
			if (toolOrToolSet) {
				if (isToolSet(toolOrToolSet)) {
					result.push(toToolSetVariableEntry(toolOrToolSet, ref.range));
				} else {
					result.push(toToolVariableEntry(toolOrToolSet, ref.range));
				}
			}
		}
		return result;
	}


	private readonly _toolSets = new ObservableSet<ToolSet>();

	readonly toolSets: IObservable<Iterable<ToolSet>> = derived(this, reader => {
		const allToolSets = Array.from(this._toolSets.observable.read(reader));
		return allToolSets.filter(toolSet => this.isPermitted(toolSet, reader));
	});

	getToolSetsForModel(model: ILanguageModelChatMetadata | undefined, reader?: IReader): Iterable<IToolSet> {
		if (!model) {
			return this.toolSets.read(reader);
		}

		return Iterable.map(this.toolSets.read(reader), ts => new ToolSetForModel(ts, model, toolData => this.isToolEnabledForModel(toolData, model)));
	}

	getToolSet(id: string): ToolSet | undefined {
		for (const toolSet of this._toolSets) {
			if (toolSet.id === id) {
				return toolSet;
			}
		}
		return undefined;
	}

	getToolSetByName(name: string): ToolSet | undefined {
		for (const toolSet of this._toolSets) {
			if (toolSet.referenceName === name || toolSet.id === name || (toolSet.id === 'vscode' && (name === 'vscode' || name === 'Dardcor Code' || name === 'dardcor'))) {
				return toolSet;
			}
		}
		return undefined;
	}

	getSpecedToolSetName(referenceName: string): string {
		if (LanguageModelToolsService.githubMCPServerAliases.includes(referenceName)) {
			return 'github';
		}
		if (LanguageModelToolsService.playwrightMCPServerAliases.includes(referenceName)) {
			return 'playwright';
		}
		return referenceName;
	}

	createToolSet(source: ToolDataSource, id: string, referenceName: string, options?: { icon?: ThemeIcon; description?: string; detail?: string; legacyFullNames?: string[]; deprecated?: boolean; hiddenInToolsPicker?: boolean }): ToolSet & IDisposable {

		const that = this;

		referenceName = this.getSpecedToolSetName(referenceName);

		const result = new class extends ToolSet implements IDisposable {
			dispose(): void {
				if (that._toolSets.has(result)) {
					this._tools.clear();
					that._toolSets.delete(result);
				}

			}
		}(id, referenceName, options?.icon ?? Codicon.tools, source, options?.description, options?.detail, options?.legacyFullNames, options?.deprecated, options?.hiddenInToolsPicker, this._contextKeyService);

		this._toolSets.add(result);
		return result;
	}

	private readonly allToolsIncludingDisableObs = observableFromEventOpts<readonly IToolData[], void>(
		{ equalsFn: arrayEqualsC() },
		this.onDidChangeTools,
		() => Array.from(this.getAllToolsIncludingDisabled()),
	);

	private readonly toolsWithFullReferenceName = derived<[IToolData | ToolSet, string][]>(reader => {
		const result: [IToolData | ToolSet, string][] = [];
		const coveredByToolSets = new Set<IToolData>();
		for (const toolSet of this.toolSets.read(reader)) {
			if (toolSet.source.type !== 'user') {
				result.push([toolSet, getToolSetFullReferenceName(toolSet)]);
				for (const tool of toolSet.getTools()) {
					result.push([tool, getToolFullReferenceName(tool, toolSet)]);
					coveredByToolSets.add(tool);
				}
			}
		}
		for (const tool of this.allToolsIncludingDisableObs.read(reader)) {
			if (tool.when && !this._contextKeyService.contextMatchesRules(tool.when)) {
				continue;
			}

			if (tool.canBeReferencedInPrompt && !coveredByToolSets.has(tool) && this.isPermitted(tool, reader)) {
				result.push([tool, getToolFullReferenceName(tool)]);
			}
		}
		return result;
	});

	* getFullReferenceNames(): Iterable<string> {
		for (const [, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			yield fullReferenceName;
		}
	}

	getDeprecatedFullReferenceNames(): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		const knownToolSetNames = new Set<string>();
		const add = (name: string, fullReferenceName: string) => {
			if (name !== fullReferenceName) {
				if (!result.has(name)) {
					result.set(name, new Set<string>());
				}
				result.get(name)!.add(fullReferenceName);
			}
		};

		for (const [tool, _] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				knownToolSetNames.add(tool.referenceName);
				if (tool.legacyFullNames) {
					for (const legacyName of tool.legacyFullNames) {
						knownToolSetNames.add(legacyName);
					}
				}
			}
		}

		for (const [tool, fullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (isToolSet(tool)) {
				for (const alias of this.getToolSetAliases(tool, fullReferenceName)) {
					add(alias, fullReferenceName);
				}
			} else {
				for (const alias of this.getToolAliases(tool, fullReferenceName)) {
					add(alias, fullReferenceName);
				}
				if (tool.legacyToolReferenceFullNames) {
					const slashIndex = fullReferenceName.lastIndexOf('/');
					const toolSetPrefix = slashIndex !== -1 ? fullReferenceName.substring(0, slashIndex + 1) : undefined;

					for (const legacyName of tool.legacyToolReferenceFullNames) {
						if (toolSetPrefix && !legacyName.includes('/')) {
							add(toolSetPrefix + legacyName, fullReferenceName);
						}
						if (legacyName.includes('/')) {
							const toolSetFullName = legacyName.substring(0, legacyName.lastIndexOf('/'));
							if (!knownToolSetNames.has(toolSetFullName)) {
								add(toolSetFullName, fullReferenceName);
							}
						}
					}
				}
			}
		}
		return result;
	}

	getToolByFullReferenceName(fullReferenceName: string): IToolData | ToolSet | undefined {
		for (const [tool, toolFullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (fullReferenceName === toolFullReferenceName) {
				return tool;
			}
			const aliases = isToolSet(tool) ? this.getToolSetAliases(tool, toolFullReferenceName) : this.getToolAliases(tool, toolFullReferenceName);
			if (Iterable.some(aliases, alias => fullReferenceName === alias)) {
				return tool;
			}
		}
		return undefined;
	}

	getFullReferenceName(tool: IToolData | IToolSet, toolSet?: IToolSet): string {
		for (const [item, toolFullReferenceName] of this.toolsWithFullReferenceName.get()) {
			if (item === tool) {
				return toolFullReferenceName;
			}
		}

		if (isToolSet(tool)) {
			return getToolSetFullReferenceName(tool);
		}
		return getToolFullReferenceName(tool, toolSet);
	}

	getFullReferenceNameMap(): Map<IToolData | IToolSet, string> {
		const result = new Map<IToolData | IToolSet, string>();
		for (const [item, toolFullReferenceName] of this.toolsWithFullReferenceName.get()) {
			result.set(item, toolFullReferenceName);
		}
		return result;
	}
}

function getToolFullReferenceName(tool: IToolData, toolSet?: IToolSet) {
	const toolName = tool.toolReferenceName ?? tool.displayName;
	if (toolSet) {
		return `${toolSet.referenceName}/${toolName}`;
	} else if (tool.source.type === 'extension') {
		return `${tool.source.extensionId.value.toLowerCase()}/${toolName}`;
	}
	return toolName;
}

function getToolSetFullReferenceName(toolSet: IToolSet) {
	if (toolSet.source.type === 'mcp') {
		return `${toolSet.referenceName}/*`;
	}
	return toolSet.referenceName;
}


type ToolApprovalEvent = LanguageModelToolTelemetryData & {
	confirmKind: string;
	requestId: string | undefined;
	settingId: string | undefined;
	lmServiceScope: string | undefined;
	customButtonKind: string | undefined;
	confirmationNotNeededReason: string | undefined;
	sandboxWrapped: boolean | undefined;
	requestUnsandboxedExecution: boolean | undefined;
};

type ToolApprovalClassification = LanguageModelToolTelemetryClassification & {
	confirmKind: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the confirmation was resolved (userAction, setting, lmServicePerTool, confirmationNotNeeded, denied, skipped). Anything other than userAction implies auto-approval. "denied" and "skipped" mean the tool did not run; otherwise it ran (note: a custom Deny button click resolves as userAction since the tool still runs and the chosen label is passed to it; see customButtonKind to distinguish).' };
	requestId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat request turn that this tool approval is associated with, if available.' };
	settingId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'When confirmKind is setting, the configuration id that auto-approved the tool.' };
	lmServiceScope: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'When confirmKind is lmServicePerTool, the scope (session/workspace/profile).' };
	customButtonKind: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'When the user clicked a custom button on the confirmation widget, whether the button represents approve or deny semantics. Undefined when no custom button was clicked.' };
	confirmationNotNeededReason: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'When confirmKind is confirmationNotNeeded, a stable identifier for why the tool did not require confirmation. Limited to a known allowlist (e.g. auto-approve-all, inlineChat); set to "other" for any other reason; undefined when no reason was supplied.' };
	sandboxWrapped: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'For terminal tool calls, whether this specific invocation runs inside the agent terminal sandbox. Undefined for non-terminal tools.' };
	requestUnsandboxedExecution: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'For terminal tool calls, whether the model requested to bypass the sandbox for this invocation. Undefined for non-terminal tools.' };
	owner: 'chrmarti';
	comment: 'Provides insight into how tool confirmations are resolved (user action vs. auto-approval).';
};
