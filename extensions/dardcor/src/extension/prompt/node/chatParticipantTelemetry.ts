/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptReference, Raw } from '@vscode/prompt-tsx';
import type * as vscode from 'vscode';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { getTextPart, roleToString } from '../../../platform/chat/common/globalStringUtils';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { isAutoModel } from '../../../platform/endpoint/node/autoChatEndpoint';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILanguageDiagnosticsService } from '../../../platform/languages/common/languageDiagnosticsService';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { TelemetryData as PlatformTelemetryData } from '../../../platform/telemetry/common/telemetryData';
import { getCachedSha256Hash } from '../../../util/common/crypto';
import { isNotebookCellOrNotebookChatInput } from '../../../util/common/notebooks';
import { extUriBiasedIgnorePathCase } from '../../../util/dardcor/base/common/resources';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { isBYOKModel } from '../../byok/node/openAIEndpoint';
import { Intent, agentsToCommands } from '../../common/constants';
import { DiagnosticsTelemetryData, findDiagnosticsTelemetry } from '../../inlineChat/node/diagnosticsTelemetry';
import { InteractionOutcome } from '../../inlineChat/node/promptCraftingTypes';
import { AgentIntent } from '../../intents/node/agentIntent';
import { EditCodeIntent } from '../../intents/node/editCodeIntent';
import { getCustomInstructionTelemetry } from '../../prompts/node/panel/customInstructions';
import { PATCH_PREFIX } from '../../tools/node/applyPatch/parseApplyPatch';
import { ChatVariablesCollection, parseSlashCommand } from '../common/chatVariablesCollection';
import { Conversation } from '../common/conversation';
import { IToolCall, IToolCallRound } from '../common/intents';
import { IDocumentContext } from './documentContext';
import { IIntent, TelemetryData } from './intents';
import { RepoInfoTelemetry } from './repoInfoTelemetry';
import { ConversationalBaseTelemetryData, ConversationalTelemetryData, createTelemetryWithId, extendUserMessageTelemetryData, getCodeBlocks, getModeNameForTelemetry, sendModelMessageTelemetry, sendOffTopicMessageTelemetry, sendUserActionTelemetry, sendUserMessageTelemetry } from './telemetry';


type ResponseInternalTelemetryProperties = {
	chatLocation: 'inline' | 'panel';
	intent: string;
	request: string;
	response: string;
	baseModel: string;
	apiType: string | undefined;
};

type ResponseInternalPanelTelemetryProperties = ResponseInternalTelemetryProperties & {
	chatLocation: 'panel';
	requestId: string;

	isParticipantDetected: string;
	sessionId: string;
};

type ResponseInternalPanelTelemetryMeasurements = {
	turnNumber: number;
};

type ResponseInternalInlineTelemetryProperties = ResponseInternalTelemetryProperties & {
	chatLocation: 'inline';

	conversationId: string;
	requestId: string;
	responseType: ChatFetchResponseType;

	problems: string;
	selectionProblems: string;
	diagnosticCodes: string;
	selectionDiagnosticCodes: string;
	diagnosticsProvider: string;
	language: string;
};

type ResponseInternalInlineTelemetryMeasurements = {
	isNotebook: number;
	turnNumber: number;
};




type RequestInternalPanelTelemetryProperties = {
	chatLocation: 'panel';
	sessionId: string;
	requestId: string;
	baseModel: string;
	apiType: string | undefined;
	intent: string;
	isParticipantDetected: string;
	detectedIntent: string;
	contextTypes: string;
	query: string;
};


type RequestInternalInlineTelemetryProperties = {
	chatLocation: 'inline';
	conversationId: string;
	requestId: string;
	intent: string;
	language: string;
	prompt: string;
	model: string;
	apiType: string | undefined;
};

type RequestInternalInlineTelemetryMeasurements = {
	isNotebook: number;
	turnNumber: number;
};





type RequestTelemetryProperties = {
	command: string;
	contextTypes: string;
	promptTypes: string;
	conversationId: string;
	requestId: string;

	responseType: string;
	languageId: string | undefined;
	model: string;
	apiType: string | undefined;
	toolCounts: string;
};

type RequestPanelTelemetryProperties = RequestTelemetryProperties & {
	responseId: string;
	codeBlocks: string;
	isParticipantDetected: string;
	mode: string;
	parentRequestId: string | undefined;
	vscodeRequestId: string | undefined;
	slashCommand: string;
	isSystemInitiated: string;
};

type RequestTelemetryMeasurements = {
	promptTokenCount: number;
	timeToRequest: number;
	timeToFirstToken: number;
	timeToComplete: number;
	responseTokenCount: number;
	messageTokenCount: number;
	numToolCalls: number;
	availableToolCount: number;
	toolTokenCount: number;
	isBYOK: number;
	isAuto: number;
};

type RequestPanelTelemetryMeasurements = RequestTelemetryMeasurements & {
	turn: number;
	round: number;
	textBlocks: number;
	links: number;
	maybeOffTopic: number;
	userPromptCount: number;
	summarizationEnabled: number;
};


type RequestInlineTelemetryProperties = RequestTelemetryProperties & {
	languageId: string;
	replyType: string;
	diagnosticsProvider: string;
	diagnosticCodes: string;
	selectionDiagnosticCodes: string;
	outcomeAnnotations: string;
};

type RequestInlineTelemetryMeasurements = RequestTelemetryMeasurements & {
	firstTurn: number;
	isNotebook: number;
	withIntentDetection: number;
	implicitCommand: number;
	attemptCount: number;
	selectionLineCount: number;
	wholeRangeLineCount: number;
	editCount: number;
	editLineCount: number;
	markdownCharCount: number;
	problemsCount: number;
	selectionProblemsCount: number;
	diagnosticsCount: number;
	selectionDiagnosticsCount: number;
};


const builtinSlashCommands = new Set(
	Object.values(agentsToCommands).flatMap(commands => commands ? Object.keys(commands) : [])
);

function getSlashCommandForTelemetry(request: vscode.ChatRequest, extensionUri: URI): string {
	if (request.command && builtinSlashCommands.has(request.command)) {
		return request.command;
	}

	const match = parseSlashCommand(request.prompt, new ChatVariablesCollection(request.references));
	if (!match) {
		return '';
	}

	if (URI.isUri(match.variable.value) && extUriBiasedIgnorePathCase.isEqualOrParent(match.variable.value, extensionUri)) {
		return match.command;
	}

	return getCachedSha256Hash(match.command);
}

export class ChatTelemetryBuilder {

	public readonly baseUserTelemetry: ConversationalBaseTelemetryData;

	private readonly _repoInfoTelemetry: RepoInfoTelemetry;

	public get telemetryMessageId() {
		return this.baseUserTelemetry.properties.messageId;
	}

	constructor(
		private readonly _startTime: number,
		private readonly _sessionId: string,
		private readonly _documentContext: IDocumentContext | undefined,
		private readonly _firstTurn: boolean,
		private readonly _request: vscode.ChatRequest,
		telemetryMessageId: string | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		this.baseUserTelemetry = telemetryMessageId
			? new ConversationalTelemetryData(PlatformTelemetryData.createAndMarkAsIssued({ messageId: telemetryMessageId }))
			: createTelemetryWithId();
		this._repoInfoTelemetry = this.instantiationService.createInstance(RepoInfoTelemetry, this.baseUserTelemetry.properties.messageId);
	}

	public makeRequest(intent: IIntent, location: ChatLocation.Editor, conversation: Conversation, messages: Raw.ChatMessage[], promptTokenLength: number, references: readonly PromptReference[], endpoint: IChatEndpoint, telemetryData: readonly TelemetryData[], availableToolCount: number, toolTokenCount: number): InlineChatTelemetry;
	public makeRequest(intent: IIntent, location: ChatLocation, conversation: Conversation, messages: Raw.ChatMessage[], promptTokenLength: number, references: readonly PromptReference[], endpoint: IChatEndpoint, telemetryData: readonly TelemetryData[], availableToolCount: number, toolTokenCount: number): PanelChatTelemetry;
	public makeRequest(intent: IIntent, location: ChatLocation, conversation: Conversation, messages: Raw.ChatMessage[], promptTokenLength: number, references: readonly PromptReference[], endpoint: IChatEndpoint, telemetryData: readonly TelemetryData[], availableToolCount: number, toolTokenCount: number): InlineChatTelemetry | PanelChatTelemetry {

		if (location === ChatLocation.Editor) {
			return this.instantiationService.createInstance(InlineChatTelemetry,
				this._sessionId,
				this._documentContext!,
				this._firstTurn,
				this._request,
				this._startTime,
				this.baseUserTelemetry,
				conversation,
				intent,
				messages,
				references,
				endpoint,
				promptTokenLength,
				telemetryData,
				availableToolCount,
				toolTokenCount,
				this._repoInfoTelemetry
			);
		} else {
			return this.instantiationService.createInstance(PanelChatTelemetry,
				this._sessionId,
				this._documentContext!,
				this._firstTurn,
				this._request,
				this._startTime,
				this.baseUserTelemetry,
				conversation,
				intent,
				messages,
				references,
				endpoint,
				promptTokenLength,
				telemetryData,
				availableToolCount,
				toolTokenCount,
				this._repoInfoTelemetry
			);
		}
	}
}

export abstract class ChatTelemetry<C extends IDocumentContext | undefined = IDocumentContext | undefined> {

	protected readonly _userTelemetry: ConversationalBaseTelemetryData;

	protected readonly _requestStartTime: number = Date.now();
	protected _firstTokenTime: number = 0;

	protected _addedLinkCount = 0;
	protected _markdownCharCount: number = 0;
	protected _editCount: number = 0;
	protected _editLineCount: number = 0;

	private _didSeePatchInResponse = false;
	private _lastMarkdownLine = '';

	public get telemetryMessageId(): string {
		return this._userTelemetry.properties.messageId;
	}

	public get editCount(): number {
		return this._editCount;
	}

	public get editLineCount(): number {
		return this._editLineCount;
	}

	public get sessionId(): string {
		return this._sessionId;
	}

	constructor(
		protected readonly _location: ChatLocation,
		protected readonly _sessionId: string,
		protected readonly _documentContext: C,
		protected readonly _firstTurn: boolean,
		protected readonly _request: vscode.ChatRequest,
		protected readonly _startTime: number,
		baseUserTelemetry: ConversationalBaseTelemetryData,
		protected readonly _conversation: Conversation,
		protected readonly _intent: IIntent,
		protected readonly _messages: Raw.ChatMessage[],
		protected readonly _references: readonly PromptReference[],
		protected readonly _endpoint: IChatEndpoint,
		promptTokenLength: number,
		protected readonly _genericTelemetryData: readonly TelemetryData[],
		protected readonly _availableToolCount: number,
		protected readonly _toolTokenCount: number,
		protected readonly _repoInfoTelemetry: RepoInfoTelemetry,
		@ITelemetryService protected readonly _telemetryService: ITelemetryService,
	) {
		this._userTelemetry = extendUserMessageTelemetryData(
			this._conversation,
			this._sessionId,
			this._location,
			this._request.prompt,
			promptTokenLength,
			this._intent.id,
			baseUserTelemetry
		);

		queueMicrotask(() => this._sendInternalRequestTelemetryEvent());
	}

	public markReceivedToken(): void {
		if (this._firstTokenTime === 0) {
			this._firstTokenTime = Date.now();
		}
	}

	public markAddedLinks(n: number): void {
		this._addedLinkCount += n;
	}

	public markEmittedMarkdown(str: vscode.MarkdownString) {
		this._markdownCharCount += str.value.length;
		this._lastMarkdownLine += str.value;
		if (this._lastMarkdownLine.includes(PATCH_PREFIX.trim())) {
			this._didSeePatchInResponse = true;
		}

		const i = this._lastMarkdownLine.lastIndexOf('\n');
		this._lastMarkdownLine = this._lastMarkdownLine.slice(i + 1);
	}

	public markEmittedEdits(uri: vscode.Uri, edits: vscode.TextEdit[]) {
		this._editCount += edits.length;
		this._editLineCount += edits.reduce((acc, edit) => acc + edit.newText.split('\n').length, 0);
	}

	public async sendTelemetry(requestId: string, responseType: ChatFetchResponseType, response: string, interactionOutcome: InteractionOutcome, toolCalls: IToolCall[]): Promise<void> {
		sendUserMessageTelemetry(
			this._telemetryService,
			this._location,
			requestId,
			this._request.prompt,
			responseType === ChatFetchResponseType.OffTopic ? true : false,
			this._documentContext?.document,
			this._userTelemetry,
			this._getModeNameForTelemetry(),
		);

		if (responseType === ChatFetchResponseType.OffTopic) {
			sendOffTopicMessageTelemetry(
				this._telemetryService,
				this._conversation,
				this._location,
				this._request.prompt,
				this.telemetryMessageId,
				this._documentContext?.document,
				this._userTelemetry
			);
		}

		if (responseType === ChatFetchResponseType.Success) {
			sendModelMessageTelemetry(
				this._telemetryService,
				this._conversation,
				this._location,
				response,
				this.telemetryMessageId,
				this._documentContext?.document,
				this._userTelemetry.extendedBy({ replyType: interactionOutcome.kind }),
				this._getModeNameForTelemetry()
			);
		}

		await this._sendResponseTelemetryEvent(responseType, response, interactionOutcome, toolCalls);
		this._sendResponseInternalTelemetryEvent(responseType, response);


		if (this._didSeePatchInResponse) {
			this._telemetryService.sendMSFTTelemetryEvent('applyPatch.inResponse', {
				model: this._endpoint.model
			});
		}
	}

	protected _getModeNameForTelemetry(): string {
		return getModeNameForTelemetry(this._request.modeInstructions2) ??
			(this._intent.id === AgentIntent.ID ? 'agent' :
				(this._intent.id === EditCodeIntent.ID) ? 'edit' :
					(this._intent.id === Intent.InlineChat) ? 'inlineChatIntent' :
						'ask');
	}

	public sendToolCallingTelemetry(toolCallRounds: IToolCallRound[], availableTools: readonly vscode.LanguageModelToolInformation[], responseType: ChatFetchResponseType | 'cancelled' | 'maxToolCalls'): void {
		if (availableTools.length === 0) {
			return;
		}

		const toolCounts = toolCallRounds.reduce((acc, round) => {
			round.toolCalls.forEach(call => {
				acc[call.name] = (acc[call.name] || 0) + 1;
			});
			return acc;
		}, {} as Record<string, number>);

		const invalidToolCallCount = toolCallRounds.reduce((acc, round) => {
			if (round.toolInputRetry > 0) {
				acc++;
			}
			return acc;
		}, 0);

		let totalToolCalls = 0;
		let parallelToolCallRounds = 0;
		let parallelToolCallsTotal = 0;
		for (const round of toolCallRounds) {
			const count = round.toolCalls.length;
			totalToolCalls += count;
			if (count > 1) {
				parallelToolCallRounds++;
				parallelToolCallsTotal += count;
			}
		}

		const toolCallProperties = {
			intentId: this._intent.id,
			conversationId: this._conversation.sessionId,
			requestId: this.telemetryMessageId,
			responseType,
			toolCounts: JSON.stringify(toolCounts),
			model: this._endpoint.model
		};

		const toolCallMeasurements = {
			numRequests: toolCallRounds.length,
			turnIndex: this._conversation.turns.length,
			sessionDuration: Date.now() - this._conversation.turns[0].startTime,
			turnDuration: Date.now() - this._conversation.getLatestTurn().startTime,
			promptTokenCount: this._userTelemetry.measurements.promptTokenLen,
			messageCharLen: this._userTelemetry.measurements.messageCharLen,
			availableToolCount: availableTools.length,
			toolTokenCount: this._toolTokenCount,
			invalidToolCallCount,
			totalToolCalls,
			parallelToolCallRounds,
			parallelToolCallsTotal
		};

		this._telemetryService.sendMSFTTelemetryEvent('toolCallDetails', toolCallProperties, toolCallMeasurements);

		this._telemetryService.sendInternalMSFTTelemetryEvent('toolCallDetailsInternal', {
			...toolCallProperties,
			messageId: this.telemetryMessageId,
			availableTools: JSON.stringify(availableTools.map(tool => tool.name))
		}, toolCallMeasurements);

		this._telemetryService.sendEnhancedGHTelemetryEvent('toolCallDetailsExternal', {
			...toolCallProperties,
			messageId: this.telemetryMessageId,
			availableTools: JSON.stringify(availableTools.map(tool => tool.name))
		}, toolCallMeasurements);

		this._repoInfoTelemetry.sendEndTelemetry();
	}

	protected abstract _sendInternalRequestTelemetryEvent(): void;

	protected abstract _sendResponseTelemetryEvent(responseType: ChatFetchResponseType, response: string, interactionOutcome: InteractionOutcome, toolCalls?: IToolCall[]): Promise<void>;

	protected abstract _sendResponseInternalTelemetryEvent(responseType: ChatFetchResponseType, response: string): void;

	protected _getTelemetryData<T extends TelemetryData>(ctor: new (...args: any[]) => T): T | undefined {
		return <T>this._genericTelemetryData.find(d => d instanceof ctor);
	}

}

export class PanelChatTelemetry extends ChatTelemetry<IDocumentContext | undefined> {

	constructor(
		sessionId: string,
		documentContext: IDocumentContext | undefined,
		firstTurn: boolean,
		request: vscode.ChatRequest,
		startTime: number,
		baseUserTelemetry: ConversationalBaseTelemetryData,
		conversation: Conversation,
		intent: IIntent,
		messages: Raw.ChatMessage[],
		references: readonly PromptReference[],
		endpoint: IChatEndpoint,
		promptTokenLength: number,
		genericTelemetryData: readonly TelemetryData[],
		availableToolCount: number,
		toolTokenCount: number,
		repoInfoTelemetry: RepoInfoTelemetry,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
	) {
		super(ChatLocation.Panel,
			sessionId,
			documentContext,
			firstTurn,
			request,
			startTime,
			baseUserTelemetry,
			conversation,
			intent,
			messages,
			references,
			endpoint,
			promptTokenLength,
			genericTelemetryData,
			availableToolCount,
			toolTokenCount,
			repoInfoTelemetry,
			telemetryService
		);
	}

	protected override _sendInternalRequestTelemetryEvent(): void {


		this._telemetryService.sendInternalMSFTTelemetryEvent('interactiveSessionMessage', {
			chatLocation: 'panel',
			sessionId: this._sessionId,
			requestId: this.telemetryMessageId,
			baseModel: this._endpoint.model,
			apiType: this._endpoint.apiType,
			intent: this._intent.id,
			isParticipantDetected: String(this._request.isParticipantDetected),
			detectedIntent: this._request.enableCommandDetection ? this._intent?.id : 'none',
			contextTypes: 'none',
			query: this._request.prompt
		} satisfies RequestInternalPanelTelemetryProperties, {
			turnNumber: this._conversation.turns.length,
		} satisfies ResponseInternalPanelTelemetryMeasurements);

		this._repoInfoTelemetry.sendBeginTelemetryIfNeeded();
	}

	protected override async _sendResponseTelemetryEvent(responseType: ChatFetchResponseType, response: string, interactionOutcome: InteractionOutcome, toolCalls: IToolCall[] = []): Promise<void> {


		const turn = this._conversation.getLatestTurn();
		const roundIndex = turn.rounds.length - 1;

		const codeBlocks = response ? getCodeBlocks(response) : [];
		const codeBlockLanguages = codeBlocks.map(block => block.languageId);

		const offTopicHints = ['programming-related tasks', 'programming related questions', 'software development topics', 'related to programming', 'expertise is limited', 'sorry, i can\'t assist with that'];
		let maybeOffTopic = 0;
		if (responseType === ChatFetchResponseType.Success && !response.trim().includes('\n')) {
			if (offTopicHints.some(flag => response.toLowerCase().includes(flag))) {
				maybeOffTopic = 1;
			}
		}

		const toolCounts = toolCalls.reduce((acc, call) => {
			acc[call.name] = (acc[call.name] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		const messageTokenCount = await this._endpoint.acquireTokenizer().tokenLength(turn.request.message);
		const promptTokenCount = await this._endpoint.acquireTokenizer().countMessagesTokens(this._messages);
		const responseTokenCount = await this._endpoint.acquireTokenizer().tokenLength(response) ?? 0;

		this._telemetryService.sendMSFTTelemetryEvent('panel.request', {
			command: this._intent.id,
			contextTypes: 'none',
			promptTypes: this._messages.map(msg => `${msg.role}${'name' in msg && msg.name ? `-${msg.name}` : ''}:${getTextPart(msg.content).length}`).join(','),
			conversationId: this._sessionId,
			requestId: turn.id,
			responseId: turn.id,
			responseType,
			languageId: this._documentContext?.document.languageId,
			codeBlocks: codeBlockLanguages.join(','),
			model: this._endpoint.model,
			apiType: this._endpoint.apiType,
			isParticipantDetected: String(this._request.isParticipantDetected),
			toolCounts: JSON.stringify(toolCounts),
			mode: this._getModeNameForTelemetry(),
			parentRequestId: this._request.parentRequestId,
			vscodeRequestId: this._request.id,
			slashCommand: getSlashCommandForTelemetry(this._request, URI.from(this._extensionContext.extensionUri)),
			isSystemInitiated: String(!!this._request.isSystemInitiated)
		} satisfies RequestPanelTelemetryProperties, {
			turn: this._conversation.turns.length,
			round: roundIndex,
			textBlocks: codeBlocks.length ? -1 : response.split(/\n{2,}/).length ?? 0,
			links: this._addedLinkCount,
			maybeOffTopic: maybeOffTopic,
			messageTokenCount,
			promptTokenCount,
			userPromptCount: this._messages.filter(msg => msg.role === Raw.ChatRole.User).length,
			responseTokenCount,
			timeToRequest: this._requestStartTime - this._startTime,
			timeToFirstToken: this._firstTokenTime ? this._firstTokenTime - this._startTime : -1,
			timeToComplete: Date.now() - this._startTime,
			...getCustomInstructionTelemetry(turn.references),
			numToolCalls: toolCalls.length,
			availableToolCount: this._availableToolCount,
			toolTokenCount: this._toolTokenCount,
			summarizationEnabled: this._configurationService.getConfig(ConfigKey.SummarizeAgentConversationHistory) ? 1 : 0,
			isBYOK: isBYOKModel(this._endpoint),
			isAuto: isAutoModel(this._endpoint)
		} satisfies RequestPanelTelemetryMeasurements);

		const modeName = this._getModeNameForTelemetry();
		sendUserActionTelemetry(
			this._telemetryService,
			undefined,
			{
				command: this._intent.id,
				conversationId: this._sessionId,
				requestId: turn.id,
				responseType,
				languageId: this._documentContext?.document.languageId ?? '',
				model: this._endpoint.model,
				isParticipantDetected: String(this._request.isParticipantDetected),
				toolCounts: JSON.stringify(toolCounts),
				mode: modeName,
				codeBlocks: JSON.stringify(codeBlocks),
				vscodeRequestId: this._request.id,
			},
			{
				isAgent: this._intent.id === AgentIntent.ID ? 1 : 0,
				turn: this._conversation.turns.length,
				round: roundIndex,
				textBlocks: codeBlocks.length ? -1 : response.split(/\n{2,}/).length ?? 0,
				links: this._addedLinkCount,
				maybeOffTopic,
				messageTokenCount,
				promptTokenCount,
				userPromptCount: this._messages.filter(msg => msg.role === Raw.ChatRole.User).length,
				responseTokenCount,
				timeToRequest: this._requestStartTime - this._startTime,
				timeToFirstToken: this._firstTokenTime ? this._firstTokenTime - this._startTime : -1,
				timeToComplete: Date.now() - this._startTime,
				numToolCalls: toolCalls.length,
				availableToolCount: this._availableToolCount,
			},
			'panel_request'
		);
	}

	protected override _sendResponseInternalTelemetryEvent(_responseType: ChatFetchResponseType, response: string): void {

		this._telemetryService.sendInternalMSFTTelemetryEvent('interactiveSessionResponse', {
			chatLocation: 'panel',
			requestId: this.telemetryMessageId,
			intent: this._intent.id,
			request: this._request.prompt,
			response: response ?? '',
			baseModel: this._endpoint.model,
			apiType: this._endpoint.apiType,

			isParticipantDetected: String(this._request.isParticipantDetected),
			sessionId: this._sessionId,
		} satisfies ResponseInternalPanelTelemetryProperties, {
			turnNumber: this._conversation.turns.length,
		} satisfies ResponseInternalPanelTelemetryMeasurements);
	}
}

export class InlineChatTelemetry extends ChatTelemetry<IDocumentContext> {

	private readonly _diagnosticsTelemetryData: {
		fileDiagnosticsTelemetry: DiagnosticsTelemetryData;
		selectionDiagnosticsTelemetry: DiagnosticsTelemetryData;
		diagnosticsProvider: string;
	};

	private get _isNotebookDocument(): number {
		return isNotebookCellOrNotebookChatInput(this._documentContext.document.uri) ? 1 : 0;
	}

	constructor(
		sessionId: string,
		documentContext: IDocumentContext,
		firstTurn: boolean,
		request: vscode.ChatRequest,
		startTime: number,
		baseUserTelemetry: ConversationalBaseTelemetryData,
		conversation: Conversation,
		intent: IIntent,
		messages: Raw.ChatMessage[],
		references: readonly PromptReference[],
		endpoint: IChatEndpoint,
		promptTokenLength: number,
		genericTelemetryData: readonly TelemetryData[],
		availableToolCount: number,
		toolTokenCount: number,
		repoInfoTelemetry: RepoInfoTelemetry,
		@ITelemetryService telemetryService: ITelemetryService,
		@ILanguageDiagnosticsService private readonly _languageDiagnosticsService: ILanguageDiagnosticsService,
	) {
		super(ChatLocation.Editor,
			sessionId,
			documentContext,
			firstTurn,
			request,
			startTime,
			baseUserTelemetry,
			conversation,
			intent,
			messages,
			references,
			endpoint,
			promptTokenLength,
			genericTelemetryData,
			availableToolCount,
			toolTokenCount,
			repoInfoTelemetry,
			telemetryService
		);

		this._diagnosticsTelemetryData = findDiagnosticsTelemetry(this._documentContext.selection, this._languageDiagnosticsService.getDiagnostics(this._documentContext.document.uri));
	}

	protected override _sendInternalRequestTelemetryEvent(): void {
		this._telemetryService.sendInternalMSFTTelemetryEvent('interactiveSessionRequest', {
			conversationId: this._sessionId,
			requestId: this.telemetryMessageId,
			chatLocation: 'inline',
			intent: this._intent.id,
			language: this._documentContext.document.languageId,
			prompt: this._messages.map(m => `${roleToString(m.role).toUpperCase()}:\n${m.content}`).join('\n---\n'),
			model: this._endpoint.model,
			apiType: this._endpoint.apiType
		} satisfies RequestInternalInlineTelemetryProperties, {
			isNotebook: this._isNotebookDocument,
			turnNumber: this._conversation.turns.length,
		} satisfies RequestInternalInlineTelemetryMeasurements);
	}

	protected override async _sendResponseTelemetryEvent(responseType: ChatFetchResponseType, response: string, interactionOutcome: InteractionOutcome, toolCalls: IToolCall[] = []): Promise<void> {

		const toolCounts = toolCalls.reduce((acc, call) => {
			acc[call.name] = (acc[call.name] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		this._telemetryService.sendMSFTTelemetryEvent('inline.request', {
			command: this._intent.id,
			contextTypes: 'none',
			promptTypes: this._messages.map(msg => `${msg.role}${'name' in msg && msg.name ? `-${msg.name}` : ''}:${getTextPart(msg.content).length}`).join(','),
			conversationId: this._sessionId,
			requestId: this.telemetryMessageId,
			languageId: this._documentContext.document.languageId,
			responseType: responseType,
			replyType: interactionOutcome.kind,
			model: this._endpoint.model,
			apiType: this._endpoint.apiType,
			diagnosticsProvider: this._diagnosticsTelemetryData.diagnosticsProvider,
			diagnosticCodes: this._diagnosticsTelemetryData.fileDiagnosticsTelemetry.diagnosticCodes,
			selectionDiagnosticCodes: this._diagnosticsTelemetryData.selectionDiagnosticsTelemetry.diagnosticCodes,
			outcomeAnnotations: interactionOutcome.annotations?.map(a => a.label).join(','),
			toolCounts: JSON.stringify(toolCounts),
		} satisfies RequestInlineTelemetryProperties, {
			firstTurn: this._firstTurn ? 1 : 0,
			isNotebook: this._isNotebookDocument,
			withIntentDetection: this._request.enableCommandDetection ? 1 : 0,
			messageTokenCount: await this._endpoint.acquireTokenizer().tokenLength(this._request.prompt),
			promptTokenCount: await this._endpoint.acquireTokenizer().countMessagesTokens(this._messages),
			responseTokenCount: responseType === ChatFetchResponseType.Success ? await this._endpoint.acquireTokenizer().tokenLength(response) : -1,
			implicitCommand: (!this._request.prompt.trim().startsWith(`/${this._intent.id}`) ? 1 : 0),
			attemptCount: this._request.attempt || 0,
			selectionLineCount: Math.abs(this._documentContext.selection.end.line - this._documentContext.selection.start.line) + 1,
			wholeRangeLineCount: Math.abs(this._documentContext.wholeRange.end.line - this._documentContext.wholeRange.start.line) + 1,
			editCount: this._editCount > 0 ? this._editCount : -1,
			editLineCount: this._editLineCount > 0 ? this._editLineCount : -1,
			markdownCharCount: this._markdownCharCount,
			problemsCount: this._diagnosticsTelemetryData.fileDiagnosticsTelemetry.problemsCount,
			selectionProblemsCount: this._diagnosticsTelemetryData.selectionDiagnosticsTelemetry.problemsCount,
			diagnosticsCount: this._diagnosticsTelemetryData.fileDiagnosticsTelemetry.diagnosticsCount,
			selectionDiagnosticsCount: this._diagnosticsTelemetryData.selectionDiagnosticsTelemetry.diagnosticsCount,
			timeToRequest: this._requestStartTime - this._startTime,
			timeToFirstToken: this._firstTokenTime ? this._firstTokenTime - this._startTime : -1,
			timeToComplete: Date.now() - this._startTime,
			...getCustomInstructionTelemetry(this._references),
			numToolCalls: toolCalls.length,
			availableToolCount: this._availableToolCount,
			toolTokenCount: this._toolTokenCount,
			isBYOK: isBYOKModel(this._endpoint),
			isAuto: isAutoModel(this._endpoint)
		} satisfies RequestInlineTelemetryMeasurements);
	}

	protected override  _sendResponseInternalTelemetryEvent(responseType: ChatFetchResponseType, response: string): void {
		this._telemetryService.sendInternalMSFTTelemetryEvent('interactiveSessionResponse', {
			chatLocation: 'inline',
			intent: this._intent.id,
			request: this._request.prompt,
			response,
			conversationId: this._sessionId,
			requestId: this.telemetryMessageId,
			baseModel: this._endpoint.model,
			apiType: this._endpoint.apiType,
			responseType,
			problems: this._diagnosticsTelemetryData.fileDiagnosticsTelemetry.problems,
			selectionProblems: this._diagnosticsTelemetryData.selectionDiagnosticsTelemetry.problems,
			diagnosticCodes: this._diagnosticsTelemetryData.fileDiagnosticsTelemetry.diagnosticCodes,
			selectionDiagnosticCodes: this._diagnosticsTelemetryData.selectionDiagnosticsTelemetry.diagnosticCodes,
			diagnosticsProvider: this._diagnosticsTelemetryData.diagnosticsProvider,
			language: this._documentContext.document.languageId,
		} satisfies ResponseInternalInlineTelemetryProperties, {
			isNotebook: this._isNotebookDocument,
			turnNumber: this._conversation.turns.length,
		} satisfies ResponseInternalInlineTelemetryMeasurements);
	}
}
