/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import type { OpenAI } from 'openai';
import { Response } from '../../../platform/networking/common/fetcherService';
import { coalesce } from '../../../util/dardcor/base/common/arrays';
import { AsyncIterableObject } from '../../../util/dardcor/base/common/async';
import { binaryIndexOf } from '../../../util/dardcor/base/common/buffer';
import { Lazy } from '../../../util/dardcor/base/common/lazy';
import { SSEParser } from '../../../util/dardcor/base/common/sseParser';
import { isDefined } from '../../../util/dardcor/base/common/types';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { IInstantiationService, ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatLocation } from '../../chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { ILogService } from '../../log/common/logService';
import { CUSTOM_TOOL_SEARCH_NAME } from '../../networking/common/anthropic';
import { FinishedCallback, getRequestId, IResponseDelta, OpenAiFunctionTool, OpenAiResponsesFunctionTool, OpenAiToolSearchTool } from '../../networking/common/fetch';
import { IChatEndpoint, ICreateEndpointBodyOptions, IEndpointBody } from '../../networking/common/networking';
import { APIErrorResponse, ChatCompletion, FilterReason, FinishedCompletionReason, modelsWithoutResponsesContextManagement, openAIContextManagementCompactionType, OpenAIContextManagementResponse, rawMessageToCAPI, TokenLogProb } from '../../networking/common/openai';
import { IToolDeferralService } from '../../networking/common/toolDeferralService';
import { sendEngineMessagesTelemetry, sendResponsesApiCompactionTelemetry } from '../../networking/node/chatStream';
import { IChatWebSocketManager } from '../../networking/node/chatWebSocketManager';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { getVerbosityForModelSync, modelSupportCacheBreakPoints } from '../common/chatModelCapabilities';
import { rawPartAsCompactionData } from '../common/compactionDataContainer';
import { rawPartAsPhaseData } from '../common/phaseDataContainer';
import { getIndexOfStatefulMarker, getStatefulMarkerAndIndex } from '../common/statefulMarkerContainer';
import { rawPartAsThinkingData } from '../common/thinkingDataContainer';
import { createResponsesStreamDumper } from './responsesApiDebugDump';

export function getResponsesApiCompactionThreshold(configService: IConfigurationService, expService: IExperimentationService, endpoint: IChatEndpoint): number | undefined {
	const contextManagementEnabled = configService.getExperimentBasedConfig(ConfigKey.ResponsesApiContextManagementEnabled, expService) && !modelsWithoutResponsesContextManagement.has(endpoint.family);
	if (!contextManagementEnabled) {
		return undefined;
	}

	return endpoint.modelMaxPromptTokens > 0
		? Math.floor(endpoint.modelMaxPromptTokens * 0.9)
		: 50000;
}

export function getVerbosityForModelSyncBasedOnExp(configService: IConfigurationService, expService: IExperimentationService, endpoint: IChatEndpoint): 'low' | 'medium' | 'high' | undefined {
	return getVerbosityForModelSync(endpoint, configService.getExperimentBasedConfig(ConfigKey.EnableGpt56Verbosity, expService));
}

export function createResponsesRequestBody(accessor: ServicesAccessor, options: ICreateEndpointBodyOptions, model: string, endpoint: IChatEndpoint): IEndpointBody {
	const configService = accessor.get(IConfigurationService);
	const expService = accessor.get(IExperimentationService);
	const verbosity = getVerbosityForModelSyncBasedOnExp(configService, expService, endpoint);
	const compactThreshold = getResponsesApiCompactionThreshold(configService, expService, endpoint);

	const webSocketStatefulMarker = resolveWebSocketStatefulMarker(accessor, options, model);
	const ignoreStatefulMarker = !!options.ignoreStatefulMarker || !!options.useWebSocket;
	const modeChanged = !!options.modeChanged;

	const toolSearchEnabled = !!endpoint.supportsToolSearch
		&& !!options.requestOptions?.tools?.some(t => t.function.name === CUSTOM_TOOL_SEARCH_NAME);
	const isAllowedConversationAgent = options.location === ChatLocation.Agent || options.location === ChatLocation.MessagesProxy;
	const isSubagent = options.telemetryProperties?.subType?.startsWith('subagent') ?? false;
	const shouldDeferTools = toolSearchEnabled && isAllowedConversationAgent && !isSubagent;
	const toolDeferralService = shouldDeferTools ? accessor.get(IToolDeferralService) : undefined;

	type ResponsesFunctionTool = OpenAI.Responses.FunctionTool & OpenAiResponsesFunctionTool;
	const functionTools: ResponsesFunctionTool[] = [];
	if (options.requestOptions?.tools) {
		for (const tool of options.requestOptions.tools) {
			if (!tool.function.name || tool.function.name.length === 0) {
				continue;
			}
			if (tool.function.name === CUSTOM_TOOL_SEARCH_NAME) {
				continue;
			}
			const isDeferred = shouldDeferTools && !toolDeferralService!.isNonDeferredTool(tool.function.name);
			if (isDeferred) {
				continue;
			}
			functionTools.push({
				...tool.function,
				type: 'function',
				strict: false,
				parameters: (tool.function.parameters || {}) as Record<string, unknown>,
			});
		}
	}

	const finalTools: Array<ResponsesFunctionTool | OpenAiToolSearchTool | ClientToolSearchTool> = [...functionTools];
	if (shouldDeferTools) {
		finalTools.unshift({
			type: 'tool_search',
			execution: 'client',
			description: 'Search for relevant tools by describing what you need. Returns tool definitions for tools matching your query.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Natural language description of what tool capability you are looking for.',
					},
				},
				required: ['query'],
			},
		} as ClientToolSearchTool);
	}

	const toolsMap = options.requestOptions?.tools
		? new Map(options.requestOptions.tools.map(t => [t.function.name, t]))
		: undefined;
	const shouldLoadToolFromToolSearch = shouldDeferTools ? (name: string) => !toolDeferralService!.isNonDeferredTool(name) : undefined;
	const promptCacheBreakpointsEnabled = configService.getExperimentBasedConfig(ConfigKey.ResponsesApiPromptCacheBreakpointEnabled, expService);
	const modelSupportsCacheBreakpoints = modelSupportCacheBreakPoints(endpoint);
	const supportsCacheBreakpoints = promptCacheBreakpointsEnabled && modelSupportsCacheBreakpoints;
	const body: IEndpointBody = {
		model,
		...rawMessagesToResponseAPI(model, options.messages, ignoreStatefulMarker, webSocketStatefulMarker, {
			toolsMap,
			shouldLoadToolFromToolSearch,
			modeChanged,
			supportsCacheBreakpoints,
		}),
		stream: true,
		tools: finalTools.length > 0 ? finalTools : undefined,
		max_output_tokens: options.postOptions.max_tokens,
		tool_choice: typeof options.postOptions.tool_choice === 'object'
			? { type: 'function', name: options.postOptions.tool_choice.function.name }
			: options.postOptions.tool_choice,
		top_logprobs: options.postOptions.logprobs ? 3 : undefined,
		store: false,
		text: verbosity ? { verbosity } : undefined,
		prompt_cache_options: modelSupportsCacheBreakpoints ? { mode: supportsCacheBreakpoints ? 'explicit' : 'implicit' } : undefined,
	};

	if (compactThreshold !== undefined) {
		body.context_management = [{
			'type': openAIContextManagementCompactionType,
			'compact_threshold': compactThreshold
		}];
	}

	body.truncation = configService.getConfig(ConfigKey.Advanced.UseResponsesApiTruncation) ?
		'auto' :
		'disabled';
	const effortFromSetting = configService.getConfig(ConfigKey.Advanced.ReasoningEffortOverride);
	const effort = endpoint.supportsReasoningEffort?.length
		? (effortFromSetting || options.modelCapabilities?.reasoningEffort || 'medium')
		: undefined;
	const summary: string | undefined = undefined;
	if (effort || summary) {
		body.reasoning = {
			...(effort ? { effort } : {}),
			...(summary ? { summary } : {})
		};
	}

	body.include = ['reasoning.encrypted_content'];

	const promptCacheKeyEnabled = configService.getExperimentBasedConfig(ConfigKey.ResponsesApiPromptCacheKeyEnabled, expService);
	if (promptCacheKeyEnabled && options.conversationId) {
		body.prompt_cache_key = `${options.conversationId}:${endpoint.family}`;
	}

	return body;
}

export function getResponsesApiCompactionThresholdFromBody(body: Pick<IEndpointBody, 'context_management'>): number | undefined {
	const contextManagement = body.context_management;
	if (!Array.isArray(contextManagement)) {
		return undefined;
	}

	for (const item of contextManagement) {
		if (item.type === openAIContextManagementCompactionType && typeof item.compact_threshold === 'number') {
			return item.compact_threshold;
		}
	}

	return undefined;
}

interface ResponseInputAssistantTextContentPart {
	type: 'output_text';
	text: string;
}

interface ResponseInputAssistantMessageWithPhase {
	type: 'message';
	role: 'assistant';
	content: ResponseInputAssistantTextContentPart[];
	phase?: string;
}

interface ResponseOutputItemWithPhase {
	phase?: string;
}


interface ClientToolSearchTool {
	type: 'tool_search';
	execution: 'client';
	description: string;
	parameters: Record<string, unknown>;
}

interface ResponsesToolSearchCall {
	type: 'tool_search_call';
	id: string;
	execution: 'client';
	call_id: string | null;
	status: string;
	arguments?: Record<string, unknown>;
}

interface ResponsesToolSearchCallInput {
	type: 'tool_search_call';
	execution: 'client';
	call_id: string;
	status: string;
	arguments: Record<string, unknown>;
}

interface ResponsesToolSearchOutputInput {
	type: 'tool_search_output';
	execution: 'client';
	call_id: string;
	status: string;
	tools: ToolSearchLoadedTool[];
}

interface ToolSearchLoadedTool {
	type: 'function';
	name: string;
	description: string;
	defer_loading: true;
	parameters: object;
	strict: false;
}

interface LatestCompactionOutput {
	readonly item: OpenAIContextManagementResponse;
	readonly outputIndex: number;
}

type CompactionResponseOutputItem = OpenAI.Responses.ResponseOutputItem & OpenAIContextManagementResponse;

interface CompactionItemInChunk {
	readonly item: OpenAIContextManagementResponse;
	readonly outputIndex: number | undefined;
}

interface ResponseStreamEventWithOutputItem {
	readonly item: unknown;
	readonly output_index: number;
}

interface ResponseStreamEventWithResponseOutput {
	readonly response: {
		readonly output: OpenAI.Responses.ResponseOutputItem[];
	};
}

function resolveWebSocketStatefulMarker(accessor: ServicesAccessor, options: ICreateEndpointBodyOptions, modelId: string): string | undefined {
	if (options.ignoreStatefulMarker || !options.useWebSocket || !options.conversationId) {
		return undefined;
	}
	const wsManager = accessor.get(IChatWebSocketManager);
	const connectionKey = { conversationId: options.conversationId, modelId, connectionId: options.webSocketConnectionId };
	const connSummarizedAt = wsManager.getSummarizedAtRoundId(connectionKey);
	if (options.summarizedAtRoundId !== connSummarizedAt) {
		return undefined;
	}
	return wsManager.getStatefulMarker(connectionKey);
}

interface RawMessagesToResponseAPIOptions {
	readonly toolsMap?: Map<string, OpenAiFunctionTool>;
	readonly shouldLoadToolFromToolSearch?: (name: string) => boolean;
	readonly modeChanged?: boolean;
	readonly supportsCacheBreakpoints?: boolean;
}

function rawMessagesToResponseAPI(modelId: string, messages: readonly Raw.ChatMessage[], ignoreStatefulMarker: boolean, webSocketStatefulMarker: string | undefined, options: RawMessagesToResponseAPIOptions = {}): { input: OpenAI.Responses.ResponseInputItem[]; previous_response_id?: string } {
	const { toolsMap, shouldLoadToolFromToolSearch, modeChanged = false, supportsCacheBreakpoints = false } = options;
	const latestCompactionMessageIndex = getLatestCompactionMessageIndex(messages);
	const latestCompactionMessage = latestCompactionMessageIndex !== undefined ? createCompactionRoundTripMessage(messages[latestCompactionMessageIndex]) : undefined;

	let previousResponseId: string | undefined;
	let markerIndex: number | undefined;

	if (webSocketStatefulMarker) {
		markerIndex = getIndexOfStatefulMarker(webSocketStatefulMarker, messages);
		if (markerIndex !== undefined) {
			previousResponseId = webSocketStatefulMarker;
		}
	} else if (!ignoreStatefulMarker) {
		const statefulMarkerAndIndex = getStatefulMarkerAndIndex(modelId, messages);
		if (statefulMarkerAndIndex) {
			previousResponseId = statefulMarkerAndIndex.statefulMarker;
			markerIndex = statefulMarkerAndIndex.index;
		}
	}

	if (modeChanged) {
		previousResponseId = undefined;
		markerIndex = undefined;
	}

	const toolSearchCallIds = new Set<string>();
	const toolSearchLoadedTools = new Set<string>();
	const willSliceHistory = markerIndex !== undefined || latestCompactionMessageIndex !== undefined;
	if (willSliceHistory) {
		for (const message of messages) {
			if (message.role === Raw.ChatRole.Assistant && message.toolCalls) {
				for (const toolCall of message.toolCalls) {
					if (toolCall.function.name === CUSTOM_TOOL_SEARCH_NAME) {
						toolSearchCallIds.add(toolCall.id);
					}
				}
			} else if (message.role === Raw.ChatRole.Tool && message.toolCallId && toolSearchCallIds.has(message.toolCallId) && toolsMap) {
				const resultText = message.content
					.filter(c => c.type === Raw.ChatCompletionContentPartKind.Text)
					.map(c => c.text)
					.join('');
				for (const t of buildToolSearchOutputTools(resultText, toolsMap, shouldLoadToolFromToolSearch)) {
					toolSearchLoadedTools.add(t.name);
				}
			}
		}
	}

	if (markerIndex !== undefined) {
		messages = messages.slice(markerIndex + 1);
		if (latestCompactionMessageIndex !== undefined) {
			if (latestCompactionMessageIndex > markerIndex) {
				messages = messages.slice(latestCompactionMessageIndex - (markerIndex + 1));
			} else if (latestCompactionMessage) {
				messages = [latestCompactionMessage, ...messages];
			}
		}
	} else if (latestCompactionMessageIndex !== undefined) {
		messages = messages.slice(latestCompactionMessageIndex);
	}

	const input: OpenAI.Responses.ResponseInputItem[] = [];
	for (const message of messages) {
		switch (message.role) {
			case Raw.ChatRole.Assistant:
				if (message.content.length) {
					input.push(...extractCompactionData(message.content));
					input.push(...extractThinkingData(message.content));
					const asstContent = message.content.map(rawContentToResponsesAssistantContent).filter(isDefined);
					if (asstContent.length) {
						const assistantMessage: ResponseInputAssistantMessageWithPhase = {
							role: 'assistant',
							content: asstContent,
							type: 'message',
							phase: extractPhaseData(message.content),
						};
						input.push(assistantMessage as OpenAI.Responses.ResponseInputItem);
					}
				}
				if (message.toolCalls) {
					for (const toolCall of message.toolCalls) {
						if (toolCall.function.name === CUSTOM_TOOL_SEARCH_NAME) {
							toolSearchCallIds.add(toolCall.id);
							let parsedArgs: Record<string, unknown> = {};
							try { parsedArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch { }
							input.push({
								type: 'tool_search_call',
								execution: 'client',
								call_id: toolCall.id,
								status: 'completed',
								arguments: parsedArgs,
							} satisfies ResponsesToolSearchCallInput as unknown as OpenAI.Responses.ResponseInputItem);
						} else {
							const namespace = toolSearchLoadedTools.has(toolCall.function.name) ? toolCall.function.name : undefined;
							input.push({ type: 'function_call', name: toolCall.function.name, arguments: toolCall.function.arguments, call_id: toolCall.id, ...(namespace ? { namespace } : {}) });
						}
					}
				}
				break;
			case Raw.ChatRole.Tool:
				if (message.toolCallId) {
					if (toolSearchCallIds.has(message.toolCallId)) {
						const resultText = message.content
							.filter(c => c.type === Raw.ChatCompletionContentPartKind.Text)
							.map(c => c.text)
							.join('');
						const loadedTools = toolsMap ? buildToolSearchOutputTools(resultText, toolsMap, shouldLoadToolFromToolSearch) : [];
						for (const t of loadedTools) {
							toolSearchLoadedTools.add(t.name);
						}
						input.push({
							type: 'tool_search_output',
							execution: 'client',
							call_id: message.toolCallId,
							status: 'completed',
							tools: loadedTools,
						} satisfies ResponsesToolSearchOutputInput as unknown as OpenAI.Responses.ResponseInputItem);
					} else {
						const asText = message.content
							.filter(c => c.type === Raw.ChatCompletionContentPartKind.Text)
							.map(c => c.text)
							.join('');
						const asImages = message.content
							.filter(c => c.type === Raw.ChatCompletionContentPartKind.Image)
							.map((c): OpenAI.Responses.ResponseInputImage => ({
								type: 'input_image',
								detail: c.imageUrl.detail || 'auto',
								image_url: c.imageUrl.url,
							}));
						const asFiles = message.content
							.filter((c): c is RawDocumentContentPart => c.type === Raw.ChatCompletionContentPartKind.Document)
							.map(rawDocumentToResponsesInputFile)
							.filter(isDefined);
						applyPromptCacheBreakpointsToToolMedia(message.content, asImages, asFiles, supportsCacheBreakpoints);

						input.push({ type: 'function_call_output', call_id: message.toolCallId, output: asText });
						if (asImages.length) {
							input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Image associated with the above tool call:' }, ...asImages] });
						}
						if (asFiles.length) {
							input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PDF associated with the above tool call:' }, ...asFiles] });
						}
					}
				}
				break;
			case Raw.ChatRole.User:
				input.push({ type: 'message', role: 'user', content: rawContentToResponsesContentList(message.content, supportsCacheBreakpoints) });
				break;
			case Raw.ChatRole.System:
				input.push({ type: 'message', role: 'system', content: rawContentToResponsesContentList(message.content, supportsCacheBreakpoints) });
				break;
		}
	}

	return { input, previous_response_id: previousResponseId };
}

function buildToolSearchOutputTools(resultText: string, toolsMap: Map<string, OpenAiFunctionTool>, shouldLoadToolFromToolSearch: ((name: string) => boolean) | undefined): ToolSearchLoadedTool[] {
	let toolNames: unknown;
	try { toolNames = JSON.parse(resultText); } catch { return []; }
	if (!Array.isArray(toolNames)) { return []; }

	return toolNames
		.filter((name): name is string => typeof name === 'string' && name !== CUSTOM_TOOL_SEARCH_NAME && toolsMap.has(name) && shouldLoadToolFromToolSearch?.(name) === true)
		.map(name => {
			const tool = toolsMap.get(name)!;
			return {
				type: 'function' as const,
				name: tool.function.name,
				description: tool.function.description || '',
				defer_loading: true as const,
				parameters: tool.function.parameters || { type: 'object', properties: {} },
				strict: false as const,
			};
		});
}

function createCompactionRoundTripMessage(message: Raw.ChatMessage): Raw.ChatMessage | undefined {
	if (message.role !== Raw.ChatRole.Assistant) {
		return undefined;
	}

	const content = message.content.filter(part => part.type === Raw.ChatCompletionContentPartKind.Opaque && rawPartAsCompactionData(part));
	if (!content.length) {
		return undefined;
	}

	return {
		role: Raw.ChatRole.Assistant,
		content,
	};
}

function getLatestCompactionMessageIndex(messages: readonly Raw.ChatMessage[]): number | undefined {
	for (let idx = messages.length - 1; idx >= 0; idx--) {
		const message = messages[idx];
		for (const part of message.content) {
			if (part.type === Raw.ChatCompletionContentPartKind.Opaque && rawPartAsCompactionData(part)) {
				return idx;
			}
		}
	}

	return undefined;
}

type RawDocumentContentPart = Extract<Raw.ChatCompletionContentPart, { type: Raw.ChatCompletionContentPartKind.Document }>;

function rawDocumentToResponsesInputFile(part: RawDocumentContentPart): OpenAI.Responses.ResponseInputFile | undefined {
	if (part.documentData.mediaType !== 'application/pdf') {
		return undefined;
	}

	return {
		type: 'input_file',
		filename: 'document.pdf',
		file_data: `data:${part.documentData.mediaType};base64,${part.documentData.data}`,
	};
}

function rawContentToResponsesContent(part: Raw.ChatCompletionContentPart): OpenAI.Responses.ResponseInputContent | undefined {
	switch (part.type) {
		case Raw.ChatCompletionContentPartKind.Text:
			return { type: 'input_text', text: part.text };
		case Raw.ChatCompletionContentPartKind.Image:
			return { type: 'input_image', detail: part.imageUrl.detail || 'auto', image_url: part.imageUrl.url };
		case Raw.ChatCompletionContentPartKind.Document:
			return rawDocumentToResponsesInputFile(part);
		case Raw.ChatCompletionContentPartKind.Opaque: {
			const maybeCast = part.value as OpenAI.Responses.ResponseInputContent;
			if (maybeCast.type === 'input_text' || maybeCast.type === 'input_image' || maybeCast.type === 'input_file') {
				return maybeCast;
			}
		}
	}
}

function rawContentToResponsesAssistantContent(part: Raw.ChatCompletionContentPart): Pick<OpenAI.Responses.ResponseOutputText, 'type' | 'text'> | undefined {
	switch (part.type) {
		case Raw.ChatCompletionContentPartKind.Text:
			if (part.text.trim()) {
				return { type: 'output_text', text: part.text };
			}
	}
}

interface ResponsesPromptCacheBreakpoint {
	readonly mode: 'explicit';
}

type ResponsesCacheableContent = OpenAI.Responses.ResponseInputContent & {
	prompt_cache_breakpoint?: ResponsesPromptCacheBreakpoint;
};

const promptCacheBreakpoint: ResponsesPromptCacheBreakpoint = { mode: 'explicit' };

function rawContentToResponsesContentList(parts: readonly Raw.ChatCompletionContentPart[], supportsCacheBreakpoints: boolean): OpenAI.Responses.ResponseInputContent[] {
	const content: ResponsesCacheableContent[] = [];
	let target: ResponsesCacheableContent | undefined;
	for (const part of parts) {
		if (part.type === Raw.ChatCompletionContentPartKind.CacheBreakpoint) {
			if (supportsCacheBreakpoints && target) {
				target.prompt_cache_breakpoint = promptCacheBreakpoint;
			}
			continue;
		}

		const converted = rawContentToResponsesContent(part);
		if (converted) {
			target = converted;
			content.push(target);
		} else {
			target = undefined;
		}
	}
	return content;
}

function applyPromptCacheBreakpointsToToolMedia(
	parts: readonly Raw.ChatCompletionContentPart[],
	images: OpenAI.Responses.ResponseInputImage[],
	files: OpenAI.Responses.ResponseInputFile[],
	supportsCacheBreakpoints: boolean,
): void {
	if (!supportsCacheBreakpoints) {
		return;
	}

	let imageIndex = 0;
	let fileIndex = 0;
	let target: ResponsesCacheableContent | undefined;
	for (const part of parts) {
		switch (part.type) {
			case Raw.ChatCompletionContentPartKind.Image:
				target = images[imageIndex++];
				break;
			case Raw.ChatCompletionContentPartKind.Document:
				target = part.documentData.mediaType === 'application/pdf' ? files[fileIndex++] : undefined;
				break;
			case Raw.ChatCompletionContentPartKind.CacheBreakpoint:
				if (target) {
					target.prompt_cache_breakpoint = promptCacheBreakpoint;
				}
				break;
			default:
				target = undefined;
		}
	}
}
function isResponsesReasoningId(id: string | undefined): boolean {
	return typeof id === 'string' && id.startsWith('rs');
}

function extractThinkingData(content: Raw.ChatCompletionContentPart[]): OpenAI.Responses.ResponseReasoningItem[] {
	return coalesce(content.map(part => {
		if (part.type === Raw.ChatCompletionContentPartKind.Opaque) {
			const thinkingData = rawPartAsThinkingData(part);
			if (thinkingData && thinkingData.encrypted && isResponsesReasoningId(thinkingData.id)) {
				return {
					type: 'reasoning',
					id: thinkingData.id,
					summary: [],
					encrypted_content: thinkingData.encrypted,
				} satisfies OpenAI.Responses.ResponseReasoningItem;
			}
		}
	}));
}

function extractPhaseData(content: Raw.ChatCompletionContentPart[]): string | undefined {
	for (const part of content) {
		if (part.type === Raw.ChatCompletionContentPartKind.Opaque) {
			const phase = rawPartAsPhaseData(part);
			if (phase) {
				return phase;
			}
		}
	}
	return undefined;
}

function extractCompactionData(content: Raw.ChatCompletionContentPart[]): OpenAI.Responses.ResponseInputItem[] {
	return coalesce(content.map(part => {
		if (part.type === Raw.ChatCompletionContentPartKind.Opaque) {
			const compaction = rawPartAsCompactionData(part);
			if (compaction) {
				return {
					type: openAIContextManagementCompactionType,
					id: compaction.id,
					encrypted_content: compaction.encrypted_content,
				} as unknown as OpenAI.Responses.ResponseInputItem;
			}
		}
	}));
}

export function responseApiInputToRawMessagesForLogging(body: OpenAI.Responses.ResponseCreateParams): Raw.ChatMessage[] {
	const messages: Raw.ChatMessage[] = [];
	const pendingFunctionCalls: Raw.ChatMessageToolCall[] = [];

	const flushPendingFunctionCalls = () => {
		if (pendingFunctionCalls.length > 0) {
			messages.push({
				role: Raw.ChatRole.Assistant,
				content: [],
				toolCalls: pendingFunctionCalls.splice(0)
			});
		}
	};

	if (body.instructions) {
		messages.push({
			role: Raw.ChatRole.System,
			content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: body.instructions }]
		});
	}

	const inputItems = typeof body.input === 'string' ? [{ role: 'user' as const, content: body.input, type: 'message' as const }] : (body.input ?? []);

	for (const item of inputItems) {
		if ('role' in item) {
			switch (item.role) {
				case 'user':
					flushPendingFunctionCalls();
					messages.push({
						role: Raw.ChatRole.User,
						content: ensureContentArray(item.content).map(responseContentToRawContent).filter(isDefined)
					});
					break;
				case 'system':
				case 'developer':
					flushPendingFunctionCalls();
					messages.push({
						role: Raw.ChatRole.System,
						content: ensureContentArray(item.content).map(responseContentToRawContent).filter(isDefined)
					});
					break;
				case 'assistant':
					flushPendingFunctionCalls();
					if (isResponseOutputMessage(item)) {
						messages.push({
							role: Raw.ChatRole.Assistant,
							content: item.content.map(responseOutputToRawContent).filter(isDefined)
						});
					} else if (isResponseInputItemMessage(item)) {
						messages.push({
							role: Raw.ChatRole.Assistant,
							content: ensureContentArray(item.content).map(responseContentToRawContent).filter(isDefined)
						});
					}
					break;
			}
		} else if ('type' in item) {
			switch (item.type) {
				case 'function_call':
					pendingFunctionCalls.push({
						id: item.call_id,
						type: 'function',
						function: {
							name: item.name,
							arguments: item.arguments
						}
					});
					break;
				case 'function_call_output': {
					flushPendingFunctionCalls();
					const content = responseFunctionOutputToRawContents(item.output);
					messages.push({
						role: Raw.ChatRole.Tool,
						content,
						toolCallId: item.call_id
					});
					break;
				}
				case 'reasoning':
					flushPendingFunctionCalls();
					messages.push({
						role: Raw.ChatRole.Assistant,
						content: [{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: `Reasoning summary: ${item.summary.map(s => s.text).join('\n\n')}`
						}]
					});
					break;
				default: {
					const tsItem = item as unknown as ResponsesToolSearchCallInput | ResponsesToolSearchOutputInput;
					if (tsItem.type === 'tool_search_call') {
						pendingFunctionCalls.push({
							id: tsItem.call_id,
							type: 'function',
							function: {
								name: CUSTOM_TOOL_SEARCH_NAME,
								arguments: JSON.stringify(tsItem.arguments ?? {}),
							}
						});
					} else if (tsItem.type === 'tool_search_output') {
						flushPendingFunctionCalls();
						const toolNames = tsItem.tools.map(t => t.name);
						messages.push({
							role: Raw.ChatRole.Tool,
							content: [{
								type: Raw.ChatCompletionContentPartKind.Text,
								text: JSON.stringify(toolNames),
							}],
							toolCallId: tsItem.call_id,
						});
					}
					break;
				}
			}
		}
	}

	if (pendingFunctionCalls.length > 0) {
		messages.push({
			role: Raw.ChatRole.Assistant,
			content: [],
			toolCalls: pendingFunctionCalls.splice(0)
		});
	}

	return messages;
}

function isResponseOutputMessage(item: OpenAI.Responses.ResponseInputItem): item is OpenAI.Responses.ResponseOutputMessage {
	return 'role' in item && item.role === 'assistant' && 'type' in item && item.type === 'message' && 'content' in item && Array.isArray(item.content);
}

function isResponseInputItemMessage(item: OpenAI.Responses.ResponseInputItem): item is OpenAI.Responses.ResponseInputItem.Message {
	return 'role' in item && item.role === 'assistant' && (!('type' in item) || item.type !== 'message');
}

function ensureContentArray(content: string | OpenAI.Responses.ResponseInputMessageContentList): OpenAI.Responses.ResponseInputMessageContentList {
	if (typeof content === 'string') {
		return [{ type: 'input_text', text: content }];
	}
	return content;
}

function responseContentToRawContent(part: OpenAI.Responses.ResponseInputContent | OpenAI.Responses.ResponseFunctionCallOutputItem): Raw.ChatCompletionContentPart | undefined {
	switch (part.type) {
		case 'input_text':
			return { type: Raw.ChatCompletionContentPartKind.Text, text: part.text };
		case 'input_image':
			return {
				type: Raw.ChatCompletionContentPartKind.Image,
				imageUrl: {
					url: part.image_url || '',
					detail: part.detail === 'auto' ?
						undefined :
						(part.detail ?? undefined)
				}
			};
		case 'input_file':
			return {
				type: Raw.ChatCompletionContentPartKind.Opaque,
				value: `[File Input - Filename: ${part.filename || 'unknown'}]`
			};
	}
}

function responseOutputToRawContent(part: OpenAI.Responses.ResponseOutputText | OpenAI.Responses.ResponseOutputRefusal): Raw.ChatCompletionContentPart | undefined {
	switch (part.type) {
		case 'output_text':
			return { type: Raw.ChatCompletionContentPartKind.Text, text: part.text };
		case 'refusal':
			return { type: Raw.ChatCompletionContentPartKind.Text, text: `[Refusal: ${part.refusal}]` };
	}
}

function responseFunctionOutputToRawContents(output: string | OpenAI.Responses.ResponseFunctionCallOutputItemList): Raw.ChatCompletionContentPart[] {
	if (typeof output === 'string') {
		return [{ type: Raw.ChatCompletionContentPartKind.Text, text: output }];
	}
	return coalesce(output.map(responseContentToRawContent));
}

function isCompactionItem(value: unknown): value is OpenAIContextManagementResponse {
	return typeof value === 'object' && value !== null && 'type' in value && String(value.type) === openAIContextManagementCompactionType;
}

function hasOutputItem(chunk: OpenAI.Responses.ResponseStreamEvent): chunk is OpenAI.Responses.ResponseStreamEvent & ResponseStreamEventWithOutputItem {
	return 'item' in chunk && 'output_index' in chunk && typeof chunk.output_index === 'number';
}

function hasResponseOutput(chunk: OpenAI.Responses.ResponseStreamEvent): chunk is OpenAI.Responses.ResponseStreamEvent & ResponseStreamEventWithResponseOutput {
	return 'response' in chunk && Array.isArray(chunk.response.output);
}

function getOutputItemIndex(chunk: ResponseStreamEventWithOutputItem): number {
	return chunk.output_index;
}

function isCompactionOutputItem(item: OpenAI.Responses.ResponseOutputItem): item is CompactionResponseOutputItem {
	return isCompactionItem(item);
}

function getLatestCompactionOutput(output: OpenAI.Responses.ResponseOutputItem[], preferredOutputIndex: number | undefined): LatestCompactionOutput | undefined {
	let latestCompactionOutput: LatestCompactionOutput | undefined;
	for (let idx = output.length - 1; idx >= 0; idx--) {
		const item = output[idx];
		if (isCompactionOutputItem(item)) {
			latestCompactionOutput = { item, outputIndex: idx };
			break;
		}
	}

	if (preferredOutputIndex !== undefined) {
		const preferredItem = output[preferredOutputIndex];
		if (preferredItem && isCompactionOutputItem(preferredItem) && (!latestCompactionOutput || preferredOutputIndex >= latestCompactionOutput.outputIndex)) {
			return { item: preferredItem, outputIndex: preferredOutputIndex };
		}
	}

	return latestCompactionOutput;
}

function keepLatestCompactionOutput(output: OpenAI.Responses.ResponseOutputItem[], preferredOutputIndex: number | undefined): OpenAI.Responses.ResponseOutputItem[] {
	const latestCompactionOutput = getLatestCompactionOutput(output, preferredOutputIndex);
	if (!latestCompactionOutput) {
		return output;
	}

	return output.filter((item, idx) => !isCompactionOutputItem(item) || idx === latestCompactionOutput.outputIndex);
}

export async function processResponseFromChatEndpoint(instantiationService: IInstantiationService, telemetryService: ITelemetryService, logService: ILogService, response: Response, expectedNumChoices: number, finishCallback: FinishedCallback, telemetryData: TelemetryData, compactionThreshold?: number): Promise<AsyncIterableObject<ChatCompletion>> {
	return new AsyncIterableObject<ChatCompletion>(async feed => {
		const requestId = response.headers.get('X-Request-ID') ?? generateUuid();
		const ghRequestId = response.headers.get('x-github-request-id') ?? '';
		const { serverExperiments } = getRequestId(response.headers);
		const processor = instantiationService.createInstance(OpenAIResponsesProcessor, telemetryData, telemetryService, requestId, ghRequestId, serverExperiments, compactionThreshold);
		const dumper = createResponsesStreamDumper(requestId, logService);
		const parser = new SSEParser((ev) => {
			try {
				logService.trace(`SSE: ${ev.data}`);
				if (ev.data === '[DONE]') {
					return;
				}
				const parsedData = JSON.parse(ev.data);
				const responseStreamEvent: OpenAI.Responses.ResponseStreamEvent = { type: ev.type, ...parsedData };
				dumper.logEvent(responseStreamEvent);
				const completion = processor.push(responseStreamEvent, finishCallback);
				if (completion) {
					sendCompletionOutputTelemetry(telemetryService, logService, completion, telemetryData);
					feed.emitOne(completion);
				}
			} catch (e) {
				feed.reject(e);
			}
		});

		for await (const chunk of response.body) {
			parser.feed(chunk);
		}
	}, async () => {
		await response.body.destroy();
	});
}

export function sendCompletionOutputTelemetry(telemetryService: ITelemetryService, logService: ILogService, completion: ChatCompletion, telemetryData: TelemetryData): void {
	const telemetryMessage = rawMessageToCAPI(completion.message);
	let telemetryDataWithUsage = telemetryData;
	if (completion.usage) {
		telemetryDataWithUsage = telemetryData.extendedBy({}, {
			promptTokens: completion.usage.prompt_tokens,
			completionTokens: completion.usage.completion_tokens,
			totalTokens: completion.usage.total_tokens,
			...(completion.usage.prompt_tokens_details && { cachedTokens: completion.usage.prompt_tokens_details.cached_tokens }),
			...(completion.usage.completion_tokens_details && {
				reasoningTokens: completion.usage.completion_tokens_details.reasoning_tokens,
				acceptedPredictionTokens: completion.usage.completion_tokens_details.accepted_prediction_tokens,
				rejectedPredictionTokens: completion.usage.completion_tokens_details.rejected_prediction_tokens,
			}),
		});
	}
	sendEngineMessagesTelemetry(telemetryService, [telemetryMessage], telemetryDataWithUsage, true, logService);
}

interface CapiResponsesTextDeltaEvent extends Omit<OpenAI.Responses.ResponseTextDeltaEvent, 'logprobs'> {
	logprobs: Array<OpenAI.Responses.ResponseTextDeltaEvent.Logprob> | undefined;
}

interface CapiResponseCompletedEvent extends OpenAI.Responses.ResponseCompletedEvent {
	dardcor_usage?: {
		total_nano_aiu: number;
	};
}

interface CapiResponseTerminalEvent {
	response: OpenAI.Responses.Response & {
		content_filters?: CapiContentFilterEntry[] | null;
	};
}

interface CapiContentFilterEntry {
	source_type?: 'prompt' | 'completion' | string;
	blocked?: boolean;
	content_filter_raw?: Array<{ action?: string; label?: string; result?: unknown }>;
	content_filter_results?: Record<string, { filtered?: boolean; severity?: string; detected?: boolean } | undefined>;
}

function extractFilterReasonFromContentFilters(filters: CapiContentFilterEntry[] | null | undefined): FilterReason | undefined {
	if (!filters) {
		return undefined;
	}
	const blocked = filters.filter(f => f.blocked);
	const completion = blocked.find(f => f.source_type === 'completion') ?? blocked[0];
	if (!completion) {
		return undefined;
	}
	const blockingRule = completion.content_filter_raw?.find(r => r.action === 'BLOCK' && r.result === true);
	const label = blockingRule?.label?.toLowerCase() ?? '';
	if (label.includes('copyright')) {
		return FilterReason.Copyright;
	}
	if (label.includes('selfharm') || label.includes('self_harm')) {
		return FilterReason.SelfHarm;
	}
	if (label.includes('sexual')) {
		return FilterReason.Sexual;
	}
	if (label.includes('violence')) {
		return FilterReason.Violence;
	}
	if (label.includes('hate')) {
		return FilterReason.Hate;
	}
	const results = completion.content_filter_results ?? {};
	if (results.hate?.filtered) { return FilterReason.Hate; }
	if (results.self_harm?.filtered) { return FilterReason.SelfHarm; }
	if (results.sexual?.filtered) { return FilterReason.Sexual; }
	if (results.violence?.filtered) { return FilterReason.Violence; }
	if (results.protected_material_text?.filtered || results.protected_material_code?.filtered) {
		return FilterReason.Copyright;
	}
	if (completion.source_type === 'prompt') {
		return FilterReason.Prompt;
	}
	return undefined;
}

function mapResponsesApiError(err: OpenAI.Responses.ResponseError | null | undefined): APIErrorResponse | undefined {
	if (!err) {
		return undefined;
	}
	return {
		code: 0,
		message: err.message ?? '',
		metadata: { code: err.code },
	};
}

export class OpenAIResponsesProcessor {
	private textAccumulator: string = '';
	private hasReceivedReasoningSummary = false;
	private sawCompactionMessage = false;
	private latestCompactionOutputIndex: number | undefined;
	private latestCompactionItem: OpenAIContextManagementResponse | undefined;
	private lastTextDeltaOutputIndex: number | undefined;
	private readonly toolCallInfo = new Map<number, { name: string; callId: string; arguments: string }>();

	constructor(
		private readonly telemetryData: TelemetryData,
		private readonly telemetryService: ITelemetryService,
		private readonly requestId: string,
		private readonly ghRequestId: string,
		private readonly serverExperiments: string,
		private readonly compactionThreshold: number | undefined,
		@ILogService private readonly logService: ILogService,
	) { }

	private getCompactionItemsInChunk(chunk: OpenAI.Responses.ResponseStreamEvent): CompactionItemInChunk[] {
		const compactionItems: CompactionItemInChunk[] = [];

		if (hasOutputItem(chunk) && isCompactionItem(chunk.item)) {
			const outputIndex = getOutputItemIndex(chunk);
			compactionItems.push({ item: chunk.item, outputIndex });
		}

		if (hasResponseOutput(chunk)) {
			for (let idx = 0; idx < chunk.response.output.length; idx++) {
				const item = chunk.response.output[idx];
				if (isCompactionItem(item)) {
					compactionItems.push({ item, outputIndex: idx });
				}
			}
		}

		return compactionItems;
	}

	private captureCompactionItem(item: OpenAIContextManagementResponse, outputIndex: number | undefined, onProgress: (delta: IResponseDelta) => undefined): void {
		if (outputIndex !== undefined && this.latestCompactionOutputIndex !== undefined && outputIndex < this.latestCompactionOutputIndex) {
			return;
		}

		const previousCompactionItem = this.latestCompactionItem;
		this.sawCompactionMessage = true;
		this.latestCompactionOutputIndex = outputIndex ?? this.latestCompactionOutputIndex;
		this.latestCompactionItem = item;

		if (previousCompactionItem?.id === item.id && previousCompactionItem.encrypted_content === item.encrypted_content) {
			return;
		}

		onProgress({
			text: '',
			contextManagement: {
				type: openAIContextManagementCompactionType,
				id: item.id,
				encrypted_content: item.encrypted_content,
			}
		});
	}

	public push(chunk: OpenAI.Responses.ResponseStreamEvent, _onProgress: FinishedCallback): ChatCompletion | undefined {
		const onProgress = (delta: IResponseDelta): undefined => {
			this.textAccumulator += delta.text;
			_onProgress(this.textAccumulator, 0, delta);
		};
		const compactionItems = this.getCompactionItemsInChunk(chunk);
		if (chunk.type !== 'response.completed') {
			for (const { item, outputIndex } of compactionItems) {
				this.captureCompactionItem(item, outputIndex, onProgress);
			}
		}

		switch (chunk.type) {
			case 'error':
				onProgress({ text: '', dardcorErrors: [{ agent: 'openai', code: chunk.code || 'unknown', message: chunk.message, type: 'error', identifier: chunk.param || undefined }] });
				return this.buildTerminalCompletion(
					{ output: [] } as unknown as CapiResponseTerminalEvent['response'],
					FinishedCompletionReason.ServerError,
					{ error: mapResponsesApiError({ code: chunk.code, message: chunk.message } as OpenAI.Responses.ResponseError) }
				);
			case 'response.output_text.delta': {
				const capiChunk: CapiResponsesTextDeltaEvent = chunk;
				if (this.lastTextDeltaOutputIndex !== undefined && capiChunk.output_index !== this.lastTextDeltaOutputIndex) {
					onProgress({ text: '\n\n' });
				}
				this.lastTextDeltaOutputIndex = capiChunk.output_index;
				const haystack = new Lazy(() => new TextEncoder().encode(capiChunk.delta));
				return onProgress({
					text: capiChunk.delta,
					logprobs: capiChunk.logprobs && {
						content: capiChunk.logprobs.map(lp => ({
							...mapLogProp(haystack, lp),
							top_logprobs: lp.top_logprobs?.map(l => mapLogProp(haystack, l)) || []
						}))
					},
				});
			}
			case 'response.output_item.added':
				if (chunk.item.type === 'function_call') {
					this.toolCallInfo.set(chunk.output_index, { name: chunk.item.name, callId: chunk.item.call_id, arguments: '' });
					onProgress({
						text: '',
						beginToolCalls: [{ name: chunk.item.name, id: chunk.item.call_id }]
					});
				} else if (chunk.item.type.toString() === 'tool_search_call') {
					const tsItem = chunk.item as unknown as ResponsesToolSearchCall;
					if (tsItem.execution === 'client' && tsItem.call_id) {
						this.toolCallInfo.set(chunk.output_index, { name: CUSTOM_TOOL_SEARCH_NAME, callId: tsItem.call_id, arguments: '' });
						onProgress({
							text: '',
							beginToolCalls: [{ name: CUSTOM_TOOL_SEARCH_NAME, id: tsItem.call_id }]
						});
					}
				}
				return;
			case 'response.function_call_arguments.delta': {
				const info = this.toolCallInfo.get(chunk.output_index);
				if (info) {
					info.arguments += chunk.delta;
					onProgress({
						text: '',
						dardcorToolCallStreamUpdates: [{
							id: info.callId,
							name: info.name,
							arguments: info.arguments,
						}],
					});
				}
				return;
			}
			case 'response.output_item.done':
				if (chunk.item.type === 'function_call') {
					this.toolCallInfo.delete(chunk.output_index);
					onProgress({
						text: '',
						dardcorToolCalls: [{
							id: chunk.item.call_id,
							name: chunk.item.name,
							arguments: chunk.item.arguments,
						}],
						phase: (chunk.item as ResponseOutputItemWithPhase).phase
					});
				} else if (chunk.item.type.toString() === 'tool_search_call') {
					const tsCall = chunk.item as unknown as ResponsesToolSearchCall;
					if (tsCall.execution === 'client' && tsCall.call_id) {
						this.toolCallInfo.delete(chunk.output_index);
						onProgress({
							text: '',
							dardcorToolCalls: [{
								id: tsCall.call_id,
								name: CUSTOM_TOOL_SEARCH_NAME,
								arguments: JSON.stringify(tsCall.arguments ?? {}),
							}],
						});
					}
				} else if (chunk.item.type === 'reasoning') {
					onProgress({
						text: '',
						thinking: chunk.item.encrypted_content ? {
							id: chunk.item.id,
							text: this.hasReceivedReasoningSummary ?
								undefined :
								chunk.item.summary.map(s => s.text),
							encrypted: chunk.item.encrypted_content,
						} : undefined
					});
				} else if (chunk.item.type === 'message') {
					onProgress({
						text: '',
						phase: (chunk.item as ResponseOutputItemWithPhase).phase
					});
				}
				return;
			case 'response.reasoning_summary_text.delta':
				this.hasReceivedReasoningSummary = true;
				return onProgress({
					text: '',
					thinking: {
						id: chunk.item_id,
						text: chunk.delta,
					}
				});
			case 'response.reasoning_summary_part.done':
				this.hasReceivedReasoningSummary = true;
				return onProgress({
					text: '',
					thinking: {
						id: chunk.item_id
					}
				});
			case 'response.completed': {
				const capiChunk = chunk as CapiResponseCompletedEvent;
				const normalizedOutput = keepLatestCompactionOutput(capiChunk.response.output, this.latestCompactionOutputIndex);
				const latestCompactionOutput = getLatestCompactionOutput(normalizedOutput, this.latestCompactionOutputIndex);
				const latestCompactionItem = latestCompactionOutput?.item;
				const previousCompactionItem = this.latestCompactionItem;
				if (latestCompactionItem) {
					this.sawCompactionMessage = true;
					this.latestCompactionOutputIndex = latestCompactionOutput.outputIndex;
				}

				const shouldEmitResolvedCompaction = latestCompactionItem && (
					!previousCompactionItem ||
					previousCompactionItem.id !== latestCompactionItem.id ||
					previousCompactionItem.encrypted_content !== latestCompactionItem.encrypted_content
				);
				if (latestCompactionItem) {
					this.latestCompactionItem = latestCompactionItem;
				}
				if (this.compactionThreshold !== undefined && this.sawCompactionMessage) {
					const promptTokens = chunk.response.usage?.input_tokens ?? 0;
					const totalTokens = chunk.response.usage?.total_tokens ?? 0;
					sendResponsesApiCompactionTelemetry(this.telemetryService, {
						outcome: 'compaction_returned',
						headerRequestId: this.requestId,
						gitHubRequestId: this.ghRequestId,
						model: chunk.response.model,
					}, {
						compactThreshold: this.compactionThreshold,
						promptTokens,
						totalTokens,
					});
					this.logService.debug(`[responsesAPI_compaction] Compaction enabled. headerRequestId=${this.requestId}`);
				} else if (this.compactionThreshold !== undefined && (chunk.response.usage?.input_tokens ?? 0) >= this.compactionThreshold) {
					const promptTokens = chunk.response.usage?.input_tokens ?? 0;
					const totalTokens = chunk.response.usage?.total_tokens ?? 0;
					sendResponsesApiCompactionTelemetry(this.telemetryService, {
						outcome: 'threshold_met_no_compaction',
						headerRequestId: this.requestId,
						gitHubRequestId: this.ghRequestId,
						model: chunk.response.model,
					}, {
						compactThreshold: this.compactionThreshold,
						promptTokens,
						totalTokens,
					});
					this.logService.debug(`[responsesAPI_compaction] Compaction enabled but context not compacted after threshold was met. headerRequestId=${this.requestId}, gitHubRequestId=${this.ghRequestId}, promptTokens=${promptTokens}, totalTokens=${totalTokens}`);
				}
				onProgress({
					text: '',
					statefulMarker: chunk.response.id,
					contextManagement: shouldEmitResolvedCompaction ? latestCompactionItem : undefined,
				});
				return {
					blockFinished: true,
					choiceIndex: 0,
					model: chunk.response.model,
					tokens: [],
					telemetryData: this.telemetryData,
					requestId: { headerRequestId: this.requestId, gitHubRequestId: this.ghRequestId, completionId: chunk.response.id, created: chunk.response.created_at, deploymentId: '', serverExperiments: this.serverExperiments },
					usage: {
						prompt_tokens: chunk.response.usage?.input_tokens ?? 0,
						completion_tokens: chunk.response.usage?.output_tokens ?? 0,
						total_tokens: chunk.response.usage?.total_tokens ?? 0,
						prompt_tokens_details: {
							cached_tokens: chunk.response.usage?.input_tokens_details?.cached_tokens ?? 0,
						},
						completion_tokens_details: {
							reasoning_tokens: chunk.response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
							accepted_prediction_tokens: 0,
							rejected_prediction_tokens: 0,
						},
						dardcor_usage: capiChunk.dardcor_usage?.total_nano_aiu !== undefined ? capiChunk.dardcor_usage : undefined,
					},
					finishReason: FinishedCompletionReason.Stop,
					message: {
						role: Raw.ChatRole.Assistant,
						content: normalizedOutput.map((item): Raw.ChatCompletionContentPart | undefined => {
							if (item.type === 'message') {
								return { type: Raw.ChatCompletionContentPartKind.Text, text: item.content.map(c => c.type === 'output_text' ? c.text : c.refusal).join('') };
							} else if (item.type === 'image_generation_call' && item.result) {
								return { type: Raw.ChatCompletionContentPartKind.Image, imageUrl: { url: item.result } };
							}
						}).filter(isDefined),
					}
				};
			}
			case 'response.incomplete': {
				const incomplete = chunk.response as CapiResponseTerminalEvent['response'];
				const reason = incomplete.incomplete_details?.reason;
				let finishReason: FinishedCompletionReason;
				let filterReason: FilterReason | undefined;
				if (reason === 'max_output_tokens') {
					finishReason = FinishedCompletionReason.Length;
				} else if (reason === 'content_filter') {
					finishReason = FinishedCompletionReason.ContentFilter;
					filterReason = extractFilterReasonFromContentFilters(incomplete.content_filters);
				} else {
					finishReason = FinishedCompletionReason.ServerError;
				}
				return this.buildTerminalCompletion(incomplete, finishReason, {
					filterReason,
					error: mapResponsesApiError(incomplete.error),
				});
			}
			case 'response.failed': {
				const failed = chunk.response as CapiResponseTerminalEvent['response'];
				return this.buildTerminalCompletion(failed, FinishedCompletionReason.ServerError, {
					error: mapResponsesApiError(failed.error),
				});
			}
		}
	}

	private buildTerminalCompletion(
		response: CapiResponseTerminalEvent['response'],
		finishReason: FinishedCompletionReason,
		opts: { filterReason?: FilterReason; error?: APIErrorResponse } = {}
	): ChatCompletion {
		const output = response.output ?? [];
		return {
			blockFinished: true,
			choiceIndex: 0,
			model: response.model,
			tokens: [],
			telemetryData: this.telemetryData,
			requestId: {
				headerRequestId: this.requestId,
				gitHubRequestId: this.ghRequestId,
				completionId: response.id,
				created: response.created_at,
				deploymentId: '',
				serverExperiments: this.serverExperiments,
			},
			usage: response.usage ? {
				prompt_tokens: response.usage.input_tokens ?? 0,
				completion_tokens: response.usage.output_tokens ?? 0,
				total_tokens: response.usage.total_tokens ?? 0,
				prompt_tokens_details: {
					cached_tokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
				},
				completion_tokens_details: {
					reasoning_tokens: response.usage.output_tokens_details?.reasoning_tokens ?? 0,
					accepted_prediction_tokens: 0,
					rejected_prediction_tokens: 0,
				},
			} : undefined,
			finishReason,
			filterReason: opts.filterReason,
			error: opts.error,
			message: {
				role: Raw.ChatRole.Assistant,
				content: output.map((item): Raw.ChatCompletionContentPart | undefined => {
					if (item.type === 'message') {
						return { type: Raw.ChatCompletionContentPartKind.Text, text: item.content.map(c => c.type === 'output_text' ? c.text : c.refusal).join('') };
					} else if (item.type === 'image_generation_call' && item.result) {
						return { type: Raw.ChatCompletionContentPartKind.Image, imageUrl: { url: item.result } };
					}
				}).filter(isDefined),
			},
		};
	}
}

function mapLogProp(text: Lazy<Uint8Array>, lp: OpenAI.Responses.ResponseTextDeltaEvent.Logprob.TopLogprob): TokenLogProb {
	let bytes: number[] = [];
	if (lp.token) {
		const needle = new TextEncoder().encode(lp.token);
		const haystack = text.value;
		const idx = binaryIndexOf(haystack, needle);
		if (idx !== -1) {
			bytes = [idx, idx + needle.length];
		}
	}

	return {
		token: lp.token!,
		bytes,
		logprob: lp.logprob!,
	};
}
