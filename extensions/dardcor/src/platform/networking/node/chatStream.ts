/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { hash } from '../../../util/dardcor/base/common/hash';
import { LRUCache } from '../../../util/dardcor/base/common/map';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { toTextParts } from '../../chat/common/globalStringUtils';
import { ILogService } from '../../log/common/logService';
import { ITelemetryService, multiplexProperties } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { APIJsonData, CAPIChatMessage, ChatCompletion, rawMessageToCAPI } from '../common/openai';
import { FinishedCompletion, convertToAPIJsonData } from './stream';

export function sendEngineMessagesLengthTelemetry(telemetryService: ITelemetryService, messages: CAPIChatMessage[], telemetryData: TelemetryData, isOutput: boolean, logService?: ILogService) {
	const messageType = isOutput ? 'output' : 'input';

	const modelCallId = telemetryData.properties.modelCallId as string;
	if (!modelCallId) {
		logService?.warn('[TELEMETRY] modelCallId not found in telemetryData, input/output messages cannot be linked');
		return;
	}

	const messagesWithLength = messages.map(msg => {
		const processedMsg: any = {
			...msg,
			content: typeof msg.content === 'string'
				? msg.content.length
				: Array.isArray(msg.content)
					? msg.content.reduce((total: number, part: any) => {
						if (typeof part === 'string') {
							return total + part.length;
						}
						if (part.type === 'text') {
							return total + (part.text?.length || 0);
						}
						return total;
					}, 0)
					: 0,
		};

		if ('tool_calls' in msg && msg.tool_calls && Array.isArray(msg.tool_calls)) {
			processedMsg.tool_calls = msg.tool_calls.map((toolCall: any) => ({
				...toolCall,
				function: toolCall.function ? {
					...toolCall.function,
					arguments: typeof toolCall.function.arguments === 'string'
						? toolCall.function.arguments.length
						: toolCall.function.arguments
				} : toolCall.function
			}));
		}

		return processedMsg;
	});

	const processedProperties: { [key: string]: string } = {};
	for (const [key, value] of Object.entries(telemetryData.properties)) {
		if (key.startsWith('request.option.tools')) {
			if (typeof value === 'string') {
				try {
					const parsed = JSON.parse(value);
					if (Array.isArray(parsed)) {
						processedProperties[key] = parsed.length.toString();
					} else {
						processedProperties[key] = value.length.toString();
					}
				} catch {
					processedProperties[key] = value.length.toString();
				}
			} else if (Array.isArray(value)) {
				processedProperties[key] = (value as any[]).length.toString();
			} else {
				processedProperties[key] = '0';
			}
		} else {
			processedProperties[key] = value;
		}
	}

	const telemetryDataWithPrompt = TelemetryData.createAndMarkAsIssued({
		...processedProperties,
		messagesJson: JSON.stringify(messagesWithLength),
		message_direction: messageType,
		modelCallId: modelCallId,
	}, telemetryData.measurements);

	void multiplexProperties(telemetryDataWithPrompt.properties).then(properties => {
		telemetryService.sendEnhancedGHTelemetryEvent('engine.messages.length', properties, telemetryDataWithPrompt.measurements);
		telemetryService.sendInternalMSFTTelemetryEvent('engine.messages.length', properties, telemetryDataWithPrompt.measurements);
	}).catch(() => { });
}

const messageHashToUuid = new LRUCache<string, string>(1000);

const requestOptionsHashToId = new LRUCache<string, string>(500);

const headerRequestIdTracker = new LRUCache<string, number>(1000);

const mainHeaderRequestIdTracker: { headerRequestId: string | null } = {
	headerRequestId: null
};

const conversationTracker = new LRUCache<string, number>(100);

function updateHeaderRequestIdTracker(headerRequestId: string): number {
	const currentTurn = headerRequestIdTracker.get(headerRequestId);
	if (currentTurn !== undefined) {
		const newTurn = currentTurn + 1;
		headerRequestIdTracker.set(headerRequestId, newTurn);
		return newTurn;
	} else {
		headerRequestIdTracker.set(headerRequestId, 1);
		return 1;
	}
}

function updateConversationTracker(conversationId: string): number {
	const currentTurn = conversationTracker.get(conversationId);
	if (currentTurn !== undefined) {
		const newTurn = currentTurn + 1;
		conversationTracker.set(conversationId, newTurn);
		return newTurn;
	} else {
		conversationTracker.set(conversationId, 1);
		return 1;
	}
}


function sendModelRequestOptionsTelemetry(telemetryService: ITelemetryService, telemetryData: TelemetryData, logService?: ILogService): string | undefined {
	const requestOptions: { [key: string]: string } = {};
	for (const [key, value] of Object.entries(telemetryData.properties)) {
		if (key.startsWith('request.option.')) {
			requestOptions[key] = value;
		}
	}

	if (Object.keys(requestOptions).length === 0) {
		return undefined;
	}

	const conversationId = telemetryData.properties.conversationId || telemetryData.properties.sessionId || 'unknown';
	const headerRequestId = telemetryData.properties.headerRequestId || 'unknown';

	const requestOptionsHash = hash(requestOptions).toString();

	let requestOptionsId = requestOptionsHashToId.get(requestOptionsHash);
	if (!requestOptionsId) {
		requestOptionsId = generateUuid();
		requestOptionsHashToId.set(requestOptionsHash, requestOptionsId);
	} else {
		return requestOptionsId;
	}

	const requestOptionsJsonString = JSON.stringify(requestOptions);
	const maxChunkSize = 8000;

	const chunks: string[] = [];
	for (let i = 0; i < requestOptionsJsonString.length; i += maxChunkSize) {
		chunks.push(requestOptionsJsonString.substring(i, i + maxChunkSize));
	}

	for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
		const requestOptionsData = TelemetryData.createAndMarkAsIssued({
			requestOptionsId,
			conversationId,
			headerRequestId,
			requestOptionsJson: chunks[chunkIndex],
			chunkIndex: chunkIndex.toString(),
			totalChunks: chunks.length.toString(),
		}, telemetryData.measurements);

		telemetryService.sendInternalMSFTTelemetryEvent('model.request.options.added', requestOptionsData.properties, requestOptionsData.measurements);
	}

	return requestOptionsId;
}

function sendNewRequestAddedTelemetry(telemetryService: ITelemetryService, telemetryData: TelemetryData, logService?: ILogService): void {

	const headerRequestId = telemetryData.properties.headerRequestId;
	if (!headerRequestId) {
		return;
	}

	const conversationId = telemetryData.properties.conversationId;
	if (conversationId) {
		mainHeaderRequestIdTracker.headerRequestId = headerRequestId;
	}

	if (headerRequestIdTracker.has(headerRequestId)) {
		return;
	}

	let conversationTurn: number | undefined;
	if (conversationId) {
		conversationTurn = updateConversationTracker(conversationId);
	}

	const filteredProperties: { [key: string]: string } = {};
	for (const [key, value] of Object.entries(telemetryData.properties)) {
		if (!key.startsWith('message') && !key.startsWith('request.option') && key !== 'modelCallId') {
			filteredProperties[key] = value;
		}
	}

	if (conversationTurn !== undefined) {
		filteredProperties.conversationTurn = conversationTurn.toString();
	}

	if (!conversationId && mainHeaderRequestIdTracker.headerRequestId) {
		const mostRecentTurn = headerRequestIdTracker.get(mainHeaderRequestIdTracker.headerRequestId);
		filteredProperties.mostRecentConversationHeaderRequestId = mainHeaderRequestIdTracker.headerRequestId;
		if (mostRecentTurn !== undefined) {
			filteredProperties.mostRecentConversationHeaderRequestIdTurn = mostRecentTurn.toString();
		}
	}

	const requestData = TelemetryData.createAndMarkAsIssued(filteredProperties, telemetryData.measurements);

	telemetryService.sendInternalMSFTTelemetryEvent('model.request.added', requestData.properties, requestData.measurements);
}

function sendIndividualMessagesTelemetry(telemetryService: ITelemetryService, messages: CAPIChatMessage[], telemetryData: TelemetryData, messageDirection: 'input' | 'output', logService?: ILogService): Array<{ uuid: string; headerRequestId: string }> {
	const messageData: Array<{ uuid: string; headerRequestId: string }> = [];

	for (const message of messages) {
		const conversationId = telemetryData.properties.conversationId || telemetryData.properties.sessionId || 'unknown';
		const headerRequestId = telemetryData.properties.headerRequestId || 'unknown';

		const messageHash = hash({
			role: message.role,
			content: message.content,
			headerRequestId: headerRequestId,
			...(('tool_calls' in message && message.tool_calls) && { tool_calls: message.tool_calls }),
			...(('tool_call_id' in message && message.tool_call_id) && { tool_call_id: message.tool_call_id })
		}).toString();

		let messageUuid = messageHashToUuid.get(messageHash);

		if (!messageUuid) {
			messageUuid = generateUuid();
			messageHashToUuid.set(messageHash, messageUuid);
		} else {
			messageData.push({ uuid: messageUuid, headerRequestId });

			continue;
		}

		messageData.push({ uuid: messageUuid, headerRequestId });

		const messageJsonString = JSON.stringify(message);

		const maxChunkSize = 8000;

		const chunks: string[] = [];
		for (let i = 0; i < messageJsonString.length; i += maxChunkSize) {
			chunks.push(messageJsonString.substring(i, i + maxChunkSize));
		}

		for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
			const messageData = TelemetryData.createAndMarkAsIssued({
				messageUuid,
				messageDirection,
				conversationId,
				headerRequestId,
				messageJson: chunks[chunkIndex],
				chunkIndex: chunkIndex.toString(),
				totalChunks: chunks.length.toString(),
			}, telemetryData.measurements);

			telemetryService.sendInternalMSFTTelemetryEvent('model.message.added', messageData.properties, messageData.measurements);
		}
	}

	return messageData;
}

function sendModelCallTelemetry(telemetryService: ITelemetryService, messageData: Array<{ uuid: string; headerRequestId: string }>, telemetryData: TelemetryData, messageDirection: 'input' | 'output', logService?: ILogService) {
	const modelCallId = telemetryData.properties.modelCallId as string;
	if (!modelCallId) {
		return;
	}

	let requestOptionsId: string | undefined;
	if (messageDirection === 'input') {
		requestOptionsId = sendModelRequestOptionsTelemetry(telemetryService, telemetryData, logService);
	}

	const conversationId = telemetryData.properties.conversationId || telemetryData.properties.sessionId || 'unknown';

	const messagesByHeaderRequestId = new Map<string, string[]>();

	for (const item of messageData) {
		if (!messagesByHeaderRequestId.has(item.headerRequestId)) {
			messagesByHeaderRequestId.set(item.headerRequestId, []);
		}
		messagesByHeaderRequestId.get(item.headerRequestId)!.push(item.uuid);
	}

	for (const [headerRequestId, messageUuids] of messagesByHeaderRequestId) {
		const eventName = messageDirection === 'input' ? 'model.modelCall.input' : 'model.modelCall.output';

		let requestTurn: number | undefined;
		if (messageDirection === 'input') {
			requestTurn = updateHeaderRequestIdTracker(headerRequestId);
		}

		const messageUuidsJsonString = JSON.stringify(messageUuids);
		const maxChunkSize = 8000;

		const chunks: string[] = [];
		for (let i = 0; i < messageUuidsJsonString.length; i += maxChunkSize) {
			chunks.push(messageUuidsJsonString.substring(i, i + maxChunkSize));
		}

		for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
			const parentToolCallId = telemetryData.properties.parentToolCallId;
			const parentHeaderRequestId = telemetryData.properties.parentHeaderRequestId;
			const parentModelCallId = telemetryData.properties.parentModelCallId;
			const modelCallData = TelemetryData.createAndMarkAsIssued({
				modelCallId,
				conversationId,
				headerRequestId,
				messageDirection,
				messageUuids: chunks[chunkIndex],
				chunkIndex: chunkIndex.toString(),
				totalChunks: chunks.length.toString(),
				messageCount: messageUuids.length.toString(),
				...(requestTurn !== undefined && { requestTurn: requestTurn.toString() }),
				...(requestOptionsId && { requestOptionsId }),
				...(telemetryData.properties.turnIndex && { turnIndex: telemetryData.properties.turnIndex }),
				...(telemetryData.properties.iterationNumber && { iterationNumber: telemetryData.properties.iterationNumber }),
				...(parentToolCallId && { parentToolCallId }),
				...(parentHeaderRequestId && { parentHeaderRequestId }),
				...(parentModelCallId && { parentModelCallId }),
			}, telemetryData.measurements);

			telemetryService.sendInternalMSFTTelemetryEvent(eventName, modelCallData.properties, modelCallData.measurements);
		}
	}
}

function sendModelTelemetryEvents(telemetryService: ITelemetryService, messages: CAPIChatMessage[], telemetryData: TelemetryData, isOutput: boolean, logService?: ILogService): void {
	const messageSource = telemetryData.properties.messageSource as string;
	if (messageSource === 'XtabProvider' || (messageSource && messageSource.startsWith('api.'))) {
		return;
	}

	if (!isOutput) {
		sendNewRequestAddedTelemetry(telemetryService, telemetryData, logService);
	}

	const isRetryRequest = telemetryData.properties.retryAfterFilterCategory !== undefined;
	if (!isOutput && isRetryRequest) {
		return;
	}

	const messageData = sendIndividualMessagesTelemetry(telemetryService, messages, telemetryData, isOutput ? 'output' : 'input', logService);

	sendModelCallTelemetry(telemetryService, messageData, telemetryData, isOutput ? 'output' : 'input', logService);
}


export function sendEngineMessagesTelemetry(telemetryService: ITelemetryService, messages: CAPIChatMessage[], telemetryData: TelemetryData, isOutput: boolean, logService?: ILogService) {
	const telemetryDataWithPrompt = telemetryData.extendedBy({
		messagesJson: JSON.stringify(messages),
	});

	void multiplexProperties(telemetryDataWithPrompt.properties).then(properties => telemetryService.sendEnhancedGHTelemetryEvent('engine.messages', properties, telemetryDataWithPrompt.measurements)).catch(() => { });

	sendModelTelemetryEvents(telemetryService, messages, telemetryData, isOutput, logService);

	sendEngineMessagesLengthTelemetry(telemetryService, messages, telemetryData, isOutput, logService);
}

export function sendResponsesApiCompactionTelemetry(
	telemetryService: ITelemetryService,
	properties: {
		outcome: 'compaction_returned' | 'threshold_met_no_compaction';
		headerRequestId: string;
		gitHubRequestId: string;
		model: string;
	},
	measurements: {
		compactThreshold?: number;
		promptTokens: number;
		totalTokens: number;
	}
): void {
	telemetryService.sendGHTelemetryEvent('responsesApi.compactionOutcome', {
		outcome: properties.outcome,
		headerRequestId: properties.headerRequestId,
		gitHubRequestId: properties.gitHubRequestId,
		model: properties.model,
	}, {
		compactThreshold: measurements.compactThreshold,
		promptTokens: measurements.promptTokens,
		totalTokens: measurements.totalTokens,
	});
}

export function prepareChatCompletionForReturn(
	telemetryService: ITelemetryService,
	logService: ILogService,
	c: FinishedCompletion,
	telemetryData: TelemetryData
): ChatCompletion {
	let messageContent = c.solution.text.join('');

	let blockFinished = false;
	if (c.finishOffset !== undefined) {
		logService.debug(`message ${c.index}: early finish at offset ${c.finishOffset}`);
		messageContent = messageContent.substring(0, c.finishOffset);
		blockFinished = true;
	}

	logService.info(`message ${c.index} returned. finish reason: [${c.reason}]`);
	logService.debug(
		`message ${c.index} details: finishOffset: [${c.finishOffset}] completionId: [{${c.requestId.completionId}}] created: [{${c.requestId.created}}]`
	);
	const jsonData: APIJsonData = convertToAPIJsonData(c.solution);
	const message: Raw.ChatMessage = {
		role: Raw.ChatRole.Assistant,
		content: toTextParts(messageContent),
	};

	const telemetryMessage = rawMessageToCAPI(message);

	telemetryData.extendWithRequestId(c.requestId);

	let telemetryDataWithUsage = telemetryData;
	if (c.usage) {
		telemetryDataWithUsage = telemetryData.extendedBy({}, {
			promptTokens: c.usage.prompt_tokens,
			completionTokens: c.usage.completion_tokens,
			totalTokens: c.usage.total_tokens,
			...(c.usage.prompt_tokens_details && { cachedTokens: c.usage.prompt_tokens_details.cached_tokens }),
			...(c.usage.completion_tokens_details && {
				reasoningTokens: c.usage.completion_tokens_details.reasoning_tokens,
				acceptedPredictionTokens: c.usage.completion_tokens_details.accepted_prediction_tokens,
				rejectedPredictionTokens: c.usage.completion_tokens_details.rejected_prediction_tokens,
			}),
		});
	}

	sendEngineMessagesTelemetry(telemetryService, [telemetryMessage], telemetryDataWithUsage, true, logService);
	return {
		message: message,
		choiceIndex: c.index,
		requestId: c.requestId,
		blockFinished: blockFinished,
		finishReason: c.reason,
		filterReason: c.filterReason,
		error: c.error,
		tokens: jsonData.tokens,
		model: c.solution.model,
		usage: c.usage,
		telemetryData: telemetryDataWithUsage,
	};
}
