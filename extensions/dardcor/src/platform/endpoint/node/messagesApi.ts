/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContentBlockParam, DocumentBlockParam, ImageBlockParam, MessageParam, RedactedThinkingBlockParam, TextBlockParam, ThinkingBlockParam, ToolReferenceBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources';
import { Raw } from '@vscode/prompt-tsx';
import { Response } from '../../../platform/networking/common/fetcherService';
import { AsyncIterableObject } from '../../../util/dardcor/base/common/async';
import { SSEParser } from '../../../util/dardcor/base/common/sseParser';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { IInstantiationService, ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatLocation } from '../../chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { ILogService } from '../../log/common/logService';
import { AnthropicMessagesTool, ContextManagementResponse, CUSTOM_TOOL_SEARCH_NAME, getContextManagementFromConfig, isAnthropicContextEditingEnabled, isExtendedCacheTtlEnabled, isExtendedCacheTtlMessagesEnabled } from '../../networking/common/anthropic';
import { FinishedCallback, getRequestId, IIPCodeCitation, IResponseDelta } from '../../networking/common/fetch';
import { IChatEndpoint, ICreateEndpointBodyOptions, IEndpointBody } from '../../networking/common/networking';
import { ChatCompletion, FinishedCompletionReason, rawMessageToCAPI } from '../../networking/common/openai';
import { IToolDeferralService } from '../../networking/common/toolDeferralService';
import { sendEngineMessagesTelemetry } from '../../networking/node/chatStream';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';

export function buildToolInputSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> & { type: 'object' } {
	if (!schema) {
		return { type: 'object', properties: {} };
	}
	const { $schema: _, ...rest } = schema;
	return { type: 'object', properties: {}, ...rest };
}

function sanitizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/gu, '_');
}

function createAnthropicToolCallIdMapper(messages: readonly Raw.ChatMessage[]): (id: string) => string {
	const validIdPattern = /^[a-zA-Z0-9_-]+$/u;
	const usedIds = new Set<string>();

	for (const message of messages) {
		if (message.role === Raw.ChatRole.Assistant) {
			for (const toolCall of message.toolCalls ?? []) {
				if (validIdPattern.test(toolCall.id)) {
					usedIds.add(toolCall.id);
				}
			}
		} else if (message.role === Raw.ChatRole.Tool && validIdPattern.test(message.toolCallId)) {
			usedIds.add(message.toolCallId);
		}
	}

	const mappedIds = new Map<string, string>();
	return id => {
		const existingId = mappedIds.get(id);
		if (existingId !== undefined) {
			return existingId;
		}

		if (validIdPattern.test(id)) {
			mappedIds.set(id, id);
			usedIds.add(id);
			return id;
		}

		const baseId = sanitizeToolCallId(id) || 'tool_call';
		let mappedId = baseId;
		let suffix = 1;
		while (usedIds.has(mappedId)) {
			mappedId = `${baseId}_${suffix++}`;
		}

		mappedIds.set(id, mappedId);
		usedIds.add(mappedId);
		return mappedId;
	};
}

interface AnthropicIPCodeCitation {
	id: number;
	start_offset: number;
	end_offset: number;
	details: Record<string, unknown>;
	citations: {
		snippet: string;
		url: string;
		ip_type?: string;
		license: string;
	};
}

interface AnthropicStreamEvent {
	type: string;
	message?: {
		id: string;
		type: string;
		role: string;
		content: ContentBlockParam[];
		model: string;
		stop_reason: string | null;
		stop_sequence: string | null;
		usage: {
			input_tokens: number;
			output_tokens: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation?: {
				ephemeral_1h_input_tokens?: number;
				ephemeral_5m_input_tokens?: number;
			};
			output_tokens_details?: {
				thinking_tokens?: number;
			};
		};
	};
	index?: number;
	content_block?: ContentBlockParam | ThinkingBlockParam | RedactedThinkingBlockParam;
	delta?: {
		type: string;
		text?: string;
		partial_json?: string;
		thinking?: string;
		signature?: string;
		stop_reason?: string;
		stop_sequence?: string;
		stop_details?: {
			category?: string;
			explanation?: string;
			type?: string;
		};
	};
	dardcor_annotations?: {
		IPCodeCitations?: AnthropicIPCodeCitation[];
	};
	usage?: {
		output_tokens: number;
		input_tokens?: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation?: {
			ephemeral_1h_input_tokens?: number;
			ephemeral_5m_input_tokens?: number;
		};
		output_tokens_details?: {
			thinking_tokens?: number;
		};
	};
	dardcor_usage?: {
		total_nano_aiu: number;
	};
	context_management?: ContextManagementResponse;
}

export function createMessagesRequestBody(accessor: ServicesAccessor, options: ICreateEndpointBodyOptions, model: string, endpoint: IChatEndpoint): IEndpointBody {
	const configurationService = accessor.get(IConfigurationService);
	const experimentationService = accessor.get(IExperimentationService);
	const toolDeferralService = accessor.get(IToolDeferralService);

	const toolSearchEnabled = !!endpoint.supportsToolSearch
		&& !!options.requestOptions?.tools?.some(t => t.function.name === CUSTOM_TOOL_SEARCH_NAME);

	const nonDeferredTools: AnthropicMessagesTool[] = [];
	const deferredTools: AnthropicMessagesTool[] = [];
	if (options.requestOptions?.tools) {
		for (const tool of options.requestOptions.tools) {
			if (!tool.function.name || tool.function.name.length === 0) {
				continue;
			}
			const isDeferred = options.modelCapabilities?.enableToolSearch && toolSearchEnabled && !toolDeferralService.isNonDeferredTool(tool.function.name);
			const anthropicTool: AnthropicMessagesTool = {
				name: tool.function.name,
				description: tool.function.description || '',
				input_schema: buildToolInputSchema(tool.function.parameters as Record<string, unknown> | undefined),
				...(isDeferred ? { defer_loading: true } : {}),
			};
			(isDeferred ? deferredTools : nonDeferredTools).push(anthropicTool);
		}
	}

	const finalTools: AnthropicMessagesTool[] = [...nonDeferredTools, ...deferredTools];

	const reasoningEffort = options.modelCapabilities?.reasoningEffort;
	let thinkingConfig: { type: 'enabled' | 'adaptive'; budget_tokens?: number; display?: 'summarized' } | undefined;
	if (options.modelCapabilities?.enableThinking) {
		const hardcodedBudget = 16000;
		if (endpoint.supportsAdaptiveThinking) {
			thinkingConfig = { type: 'adaptive', display: 'summarized' };
		} else if (endpoint.maxThinkingBudget && endpoint.minThinkingBudget) {
			const maxTokens = options.postOptions.max_tokens ?? 1024;
			const minBudget = endpoint.minThinkingBudget ?? 1024;
			const normalizedBudget = hardcodedBudget < minBudget ? minBudget : hardcodedBudget;
			const maxBudget = endpoint.maxThinkingBudget ?? 32000;
			const thinkingBudget = Math.min(maxBudget, maxTokens - 1, normalizedBudget);
			if (thinkingBudget) {
				thinkingConfig = { type: 'enabled', budget_tokens: thinkingBudget };
			}
		}
	}

	const thinkingEnabled = !!thinkingConfig;
	let effort: string | undefined;
	if (thinkingConfig) {
		const declaredLevels = endpoint.supportsReasoningEffort?.length ? endpoint.supportsReasoningEffort : undefined;
		const explicitlyUnsupported = endpoint.supportsReasoningEffort !== undefined && endpoint.supportsReasoningEffort.length === 0;
		const defaultEffort = declaredLevels
			? (declaredLevels.includes('medium') ? 'medium' : declaredLevels[Math.floor((declaredLevels.length - 1) / 2)])
			: !explicitlyUnsupported && endpoint.supportsAdaptiveThinking ? 'high' : undefined;
		if (defaultEffort !== undefined) {
			const candidateEffort = configurationService.getConfig(ConfigKey.Advanced.ReasoningEffortOverride)
				?? reasoningEffort
				?? defaultEffort;
			if (typeof candidateEffort === 'string' && candidateEffort.length > 0 && (!declaredLevels || declaredLevels.includes(candidateEffort))) {
				effort = candidateEffort;
			}
		}
	}

	const contextManagement = options.modelCapabilities?.enableContextEditing && isAnthropicContextEditingEnabled(endpoint, configurationService, experimentationService)
		? getContextManagementFromConfig(configurationService, experimentationService, thinkingEnabled)
		: undefined;

	const logService = accessor.get(ILogService);
	const telemetryService = accessor.get(ITelemetryService);
	const validToolNames = finalTools.length > 0 ? new Set(finalTools.map(t => t.name)) : undefined;
	const messagesResult = rawMessagesToMessagesAPI(options.messages, toolSearchEnabled ? validToolNames : undefined);

	const isSubagent = options.interactionTypeOverride === 'conversation-subagent';
	const useExtendedCacheTtl = isExtendedCacheTtlEnabled(endpoint, configurationService, experimentationService, options.location, isSubagent);
	const cacheTtl = useExtendedCacheTtl ? '1h' : undefined;
	const useExtendedCacheTtlMessages = isExtendedCacheTtlMessagesEnabled(useExtendedCacheTtl, configurationService, experimentationService);
	const messageCacheTtl = useExtendedCacheTtlMessages ? '1h' : undefined;

	clearAllCacheControl(messagesResult);
	addMessagesApiCacheControl(messagesResult, messageCacheTtl);
	addToolsAndSystemCacheControl(finalTools, messagesResult, cacheTtl);

	const lastMessage = messagesResult.messages.at(-1);
	if (lastMessage && lastMessage.role === 'assistant') {
		logService.warn(`[messagesAPI] Trailing assistant message detected — appending synthetic user message to prevent prefill error. Total messages: ${messagesResult.messages.length}`);

		telemetryService.sendMSFTTelemetryEvent('messagesApi.trailingAssistantGuard',
			{ model, location: ChatLocation.toString(options.location) },
			{ messageCount: messagesResult.messages.length }
		);

		messagesResult.messages.push({
			role: 'user',
			content: [{ type: 'text', text: 'Please continue.' }],
		});
	}

	return {
		model,
		...messagesResult,
		stream: options.requestOptions?.stream ?? true,
		tools: finalTools.length > 0 ? finalTools : undefined,
		max_tokens: options.postOptions.max_tokens,
		thinking: thinkingConfig,
		...(effort ? { output_config: { effort } } : {}),
		...(contextManagement ? { context_management: contextManagement } : {}),
	};
}

export function rawMessagesToMessagesAPI(messages: readonly Raw.ChatMessage[], validToolNames?: Set<string>): { messages: MessageParam[]; system?: TextBlockParam[] } {
	const unmergedMessages: MessageParam[] = [];
	const systemBlocks: TextBlockParam[] = [];
	const toolCallIdToName = new Map<string, string>();
	const mapToolCallId = createAnthropicToolCallIdMapper(messages);

	for (const message of messages) {
		switch (message.role) {
			case Raw.ChatRole.System: {
				systemBlocks.push(...rawContentToAnthropicContent(message.content).filter((c): c is TextBlockParam => c.type === 'text'));
				break;
			}
			case Raw.ChatRole.User: {
				const content = rawContentToAnthropicContent(message.content);
				if (content.length > 0) {
					unmergedMessages.push({
						role: 'user',
						content,
					});
				}
				break;
			}
			case Raw.ChatRole.Assistant: {
				const content = rawContentToAnthropicContent(message.content);
				if (message.toolCalls) {
					for (const toolCall of message.toolCalls) {
						let parsedInput: Record<string, unknown> = {};
						try {
							parsedInput = JSON.parse(toolCall.function.arguments);
						} catch {
						}
						content.push({
							type: 'tool_use',
							id: mapToolCallId(toolCall.id),
							name: toolCall.function.name,
							input: parsedInput,
						});
						toolCallIdToName.set(toolCall.id, toolCall.function.name);
					}
				}

				if (content.length > 0) {
					unmergedMessages.push({
						role: 'assistant',
						content,
					});
				}
				break;
			}
			case Raw.ChatRole.Tool: {
				if (message.toolCallId) {
					const toolContent = rawContentToAnthropicContent(message.content);
					let hasCacheControl = false;
					for (const block of toolContent) {
						if (contentBlockSupportsCacheControl(block) && block.cache_control) {
							hasCacheControl = true;
							delete block.cache_control;
						}
					}

					const isCustomToolSearch = validToolNames && toolCallIdToName.get(message.toolCallId) === CUSTOM_TOOL_SEARCH_NAME;
					const toolReferenceContent = isCustomToolSearch
						? tryParseToolReferences(toolContent, validToolNames)
						: undefined;

					const validContent = toolReferenceContent
						?? toolContent.filter((c): c is TextBlockParam | ImageBlockParam | DocumentBlockParam =>
							(c.type === 'text' || c.type === 'image' || c.type === 'document') && !(c.type === 'text' && c.text.trim() === '')
						);

					const toolResultBlock: ToolResultBlockParam = {
						type: 'tool_result',
						tool_use_id: mapToolCallId(message.toolCallId),
						content: validContent.length > 0 ? validContent : undefined,
					};
					if (hasCacheControl) {
						toolResultBlock.cache_control = { type: 'ephemeral' };
					}
					unmergedMessages.push({
						role: 'user',
						content: [toolResultBlock],
					});
				}
				break;
			}
		}
	}

	const mergedMessages: MessageParam[] = [];
	for (const message of unmergedMessages) {
		const lastMessage = mergedMessages[mergedMessages.length - 1];
		if (lastMessage && lastMessage.role === message.role) {
			const prevContent = Array.isArray(lastMessage.content) ? lastMessage.content : [{ type: 'text' as const, text: lastMessage.content }];
			const newContent = Array.isArray(message.content) ? message.content : [{ type: 'text' as const, text: message.content }];
			lastMessage.content = lastMessage.role === 'assistant'
				? mergeAssistantContent(prevContent, newContent)
				: [...prevContent, ...newContent];
		} else {
			mergedMessages.push(message);
		}
	}

	return {
		messages: mergedMessages,
		...(systemBlocks.length ? { system: systemBlocks } : {}),
	};
}

function isThinkingBlock(block: ContentBlockParam): boolean {
	return block.type === 'thinking' || block.type === 'redacted_thinking';
}

function mergeAssistantContent(prevContent: ContentBlockParam[], newContent: ContentBlockParam[]): ContentBlockParam[] {
	const hasToolUse = (blocks: ContentBlockParam[]) => blocks.some(block => block.type === 'tool_use');
	const thinkingSource = hasToolUse(newContent) ? newContent : hasToolUse(prevContent) ? prevContent : undefined;

	return [
		...(thinkingSource?.filter(isThinkingBlock) ?? []),
		...prevContent.filter(block => !isThinkingBlock(block)),
		...newContent.filter(block => !isThinkingBlock(block)),
	];
}

function tryParseToolReferences(content: ContentBlockParam[], validToolNames?: Set<string>): ToolReferenceBlockParam[] | undefined {
	if (content.length !== 1 || content[0].type !== 'text') {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content[0].text);
	} catch {
		return undefined;
	}

	if (!Array.isArray(parsed)) {
		return undefined;
	}

	return parsed
		.filter((name): name is string => typeof name === 'string' && (!validToolNames || validToolNames.has(name)))
		.map((name): ToolReferenceBlockParam => ({ type: 'tool_reference', tool_name: name }));
}

function rawContentToAnthropicContent(content: readonly Raw.ChatCompletionContentPart[]): ContentBlockParam[] {
	const convertedContent: ContentBlockParam[] = [];
	let pendingCacheControl = false;

	for (const part of content) {
		switch (part.type) {
			case Raw.ChatCompletionContentPartKind.Text:
				if (part.text.trim()) {
					convertedContent.push({ type: 'text', text: part.text });
				}
				break;
			case Raw.ChatCompletionContentPartKind.Image: {
				const url = part.imageUrl.url;
				const match = url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
				if (match) {
					convertedContent.push({
						type: 'image',
						source: {
							type: 'base64',
							media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
							data: match[2],
						}
					});
				} else if (url.startsWith('https://')) {
					convertedContent.push({
						type: 'image',
						source: {
							type: 'url',
							url,
						}
					});
				}
				break;
			}
			case Raw.ChatCompletionContentPartKind.CacheBreakpoint: {
				const previousBlock = convertedContent.at(-1);
				if (previousBlock && contentBlockSupportsCacheControl(previousBlock)) {
					previousBlock.cache_control = { type: 'ephemeral' };
				} else {
					pendingCacheControl = true;
				}
				break;
			}
			case Raw.ChatCompletionContentPartKind.Document: {
				if (part.documentData.mediaType === 'application/pdf') {
					convertedContent.push({
						type: 'document',
						source: {
							type: 'base64',
							media_type: 'application/pdf',
							data: part.documentData.data,
						}
					} satisfies DocumentBlockParam);
				}
				break;
			}
			case Raw.ChatCompletionContentPartKind.Opaque: {
				if (part.value && typeof part.value === 'object' && 'type' in part.value) {
					const opaqueValue = part.value as { type: string; thinking?: { id: string; text?: string | string[]; encrypted?: string; redacted?: boolean } };
					if (opaqueValue.type === 'thinking' && opaqueValue.thinking) {
						const thinkingText = Array.isArray(opaqueValue.thinking.text)
							? opaqueValue.thinking.text.join('')
							: opaqueValue.thinking.text;
						if (opaqueValue.thinking.redacted && opaqueValue.thinking.encrypted) {
							convertedContent.push({
								type: 'redacted_thinking',
								data: opaqueValue.thinking.encrypted,
							});
						} else if (opaqueValue.thinking.encrypted) {
							convertedContent.push({
								type: 'thinking',
								thinking: thinkingText || '',
								signature: opaqueValue.thinking.encrypted,
							});
						}
					}
				}
				break;
			}
		}

		if (pendingCacheControl && convertedContent.length > 0) {
			const lastBlock = convertedContent.at(-1)!;
			if (contentBlockSupportsCacheControl(lastBlock)) {
				lastBlock.cache_control = { type: 'ephemeral' };
				pendingCacheControl = false;
			}
		}
	}

	return convertedContent;
}

function contentBlockSupportsCacheControl(block: ContentBlockParam): block is Exclude<ContentBlockParam, ThinkingBlockParam | RedactedThinkingBlockParam> {
	return block.type !== 'thinking' && block.type !== 'redacted_thinking';
}

export function clearAllCacheControl(
	messagesResult: { messages: MessageParam[]; system?: TextBlockParam[] },
): void {
	if (messagesResult.system) {
		for (const block of messagesResult.system) {
			delete block.cache_control;
		}
	}
	for (const msg of messagesResult.messages) {
		if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (typeof block === 'object' && 'cache_control' in block) {
					delete (block as { cache_control?: unknown }).cache_control;
				}
			}
		}
	}
}

export function addToolsAndSystemCacheControl(
	tools: AnthropicMessagesTool[],
	messagesResult: { messages: MessageParam[]; system?: TextBlockParam[] },
	cacheTtl?: '1h',
): void {
	const cacheControl = cacheTtl
		? { type: 'ephemeral' as const, ttl: cacheTtl }
		: { type: 'ephemeral' as const };

	for (let i = tools.length - 1; i >= 0; i--) {
		if (!tools[i].defer_loading) {
			tools[i].cache_control = cacheControl;
			break;
		}
	}

	const lastSystemBlock = messagesResult.system?.at(-1);
	if (lastSystemBlock && !lastSystemBlock.cache_control) {
		lastSystemBlock.cache_control = cacheControl;
	}
}

export function addMessagesApiCacheControl(
	messagesResult: { messages: MessageParam[]; system?: TextBlockParam[] },
	cacheTtl?: '1h',
): void {
	const messages = messagesResult.messages;
	let marked = 0;
	for (let i = messages.length - 1; i >= 0 && marked < 2; i--) {
		const msg = messages[i];
		if (Array.isArray(msg.content) && msg.content.some(b => typeof b === 'object' && contentBlockSupportsCacheControl(b))) {
			markLastCacheableBlock(msg, cacheTtl);
			marked++;
		}
	}
}

function markLastCacheableBlock(msg: MessageParam, cacheTtl?: '1h'): void {
	if (!Array.isArray(msg.content)) {
		return;
	}
	for (let j = msg.content.length - 1; j >= 0; j--) {
		const block = msg.content[j];
		if (typeof block === 'object' && contentBlockSupportsCacheControl(block)) {
			block.cache_control = cacheTtl ? { type: 'ephemeral', ttl: cacheTtl } : { type: 'ephemeral' };
			return;
		}
	}
}

export async function processResponseFromMessagesEndpoint(
	instantiationService: IInstantiationService,
	telemetryService: ITelemetryService,
	logService: ILogService,
	response: Response,
	finishCallback: FinishedCallback,
	telemetryData: TelemetryData
): Promise<AsyncIterableObject<ChatCompletion>> {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('text/event-stream')) {
		return processNonStreamingResponseFromMessagesEndpoint(telemetryService, logService, response, finishCallback, telemetryData);
	}
	return new AsyncIterableObject<ChatCompletion>(async feed => {
		const requestId = response.headers.get('X-Request-ID') ?? generateUuid();
		const ghRequestId = response.headers.get('x-github-request-id') ?? '';
		const { serverExperiments } = getRequestId(response.headers);
		const processor = instantiationService.createInstance(AnthropicMessagesProcessor, telemetryData, requestId, ghRequestId, serverExperiments);
		const parser = new SSEParser((ev) => {
			try {
				logService.trace(`[messagesAPI]SSE: ${ev.data}`);
				const trimmed = ev.data?.trim();
				if (!trimmed || trimmed === '[DONE]') {
					return;
				}

				const parsed = JSON.parse(trimmed) as Partial<AnthropicStreamEvent>;
				const type = parsed.type ?? ev.type;
				if (!type) {
					return;
				}
				const completion = processor.push({ ...parsed, type } as AnthropicStreamEvent, finishCallback);
				if (completion) {
					logService.info(`[messagesAPI] message ${completion.choiceIndex} returned. finish reason: [${completion.finishReason}]`);

					const dataToSendToTelemetry = telemetryData.extendedBy({
						completionChoiceFinishReason: completion.finishReason,
						headerRequestId: completion.requestId.headerRequestId
					});
					telemetryService.sendGHTelemetryEvent('completion.finishReason', dataToSendToTelemetry.properties, dataToSendToTelemetry.measurements);

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

interface AnthropicCompletionState {
	readonly model: string;
	readonly messageId: string;
	readonly stopReason: string | null | undefined;
	readonly textContent: string;
	readonly toolCalls: readonly { id: string; name: string; arguments: string }[];
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheCreationTokens: number;
	readonly cacheCreation1hTokens: number | undefined;
	readonly cacheCreation5mTokens: number | undefined;
	readonly cacheReadTokens: number;
	readonly thinkingTokens: number | undefined;
	readonly requestId: string;
	readonly ghRequestId: string;
	readonly serverExperiments: string;
	readonly telemetryData: TelemetryData;
	readonly dardcorUsage?: { total_nano_aiu: number };
}

function mapStopReason(stopReason: string | null | undefined): FinishedCompletionReason {
	switch (stopReason) {
		case 'refusal':
			return FinishedCompletionReason.ClientDone;
		case 'max_tokens':
		case 'model_context_window_exceeded':
			return FinishedCompletionReason.Length;
		default:
			return FinishedCompletionReason.Stop;
	}
}

function buildAnthropicCompletion(state: AnthropicCompletionState, logService: ILogService): ChatCompletion {
	const computedPromptTokens = state.inputTokens + state.cacheCreationTokens + state.cacheReadTokens;
	if (computedPromptTokens < state.cacheReadTokens) {
		logService.warn(`[messagesAPI] Token count inconsistency: computed prompt_tokens (${computedPromptTokens}) < cached_tokens (${state.cacheReadTokens}). Raw values: inputTokens=${state.inputTokens}, cacheCreationTokens=${state.cacheCreationTokens}, cacheReadTokens=${state.cacheReadTokens}`);
	}

	return {
		blockFinished: true,
		choiceIndex: 0,
		model: state.model,
		tokens: [],
		telemetryData: state.telemetryData,
		requestId: {
			headerRequestId: state.requestId,
			gitHubRequestId: state.ghRequestId,
			completionId: state.messageId,
			created: Date.now(),
			deploymentId: '',
			serverExperiments: state.serverExperiments,
		},
		usage: {
			prompt_tokens: computedPromptTokens,
			completion_tokens: state.outputTokens,
			total_tokens: computedPromptTokens + state.outputTokens,
			prompt_tokens_details: {
				cached_tokens: state.cacheReadTokens,
				cache_creation_input_tokens: state.cacheCreationTokens,
				...(state.cacheCreation1hTokens !== undefined || state.cacheCreation5mTokens !== undefined
					? {
						anthropic_cache_creation: {
							...(state.cacheCreation1hTokens !== undefined ? { ephemeral_1h_input_tokens: state.cacheCreation1hTokens } : {}),
							...(state.cacheCreation5mTokens !== undefined ? { ephemeral_5m_input_tokens: state.cacheCreation5mTokens } : {}),
						},
					}
					: {}),
			},
			completion_tokens_details: {
				reasoning_tokens: state.thinkingTokens ?? 0,
				accepted_prediction_tokens: 0,
				rejected_prediction_tokens: 0,
			},
			dardcor_usage: state.dardcorUsage,
		},
		finishReason: mapStopReason(state.stopReason),
		message: {
			role: Raw.ChatRole.Assistant,
			content: state.textContent ? [{
				type: Raw.ChatCompletionContentPartKind.Text,
				text: state.textContent
			}] : [],
			...(state.toolCalls.length > 0 ? {
				toolCalls: state.toolCalls.map(tc => ({
					id: tc.id,
					type: 'function' as const,
					function: {
						name: tc.name,
						arguments: tc.arguments
					}
				}))
			} : {})
		}
	};
}

type AnthropicNonStreamingResponse =
	| {
		type: 'message';
		id: string;
		role: string;
		content: readonly (
			| { type: 'text'; text: string }
			| { type: 'tool_use'; id: string; name: string; input: unknown }
			| { type: 'thinking'; thinking: string; signature: string }
			| { type: 'redacted_thinking'; data: string }
		)[];
		model: string;
		stop_reason: string | null;
		usage: {
			input_tokens: number;
			output_tokens: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation?: {
				ephemeral_1h_input_tokens?: number;
				ephemeral_5m_input_tokens?: number;
			};
			output_tokens_details?: {
				thinking_tokens?: number;
			};
		};
	}
	| {
		type: 'error';
		error: { type?: string; message?: string };
	};

export async function processNonStreamingResponseFromMessagesEndpoint(
	telemetryService: ITelemetryService,
	logService: ILogService,
	response: Response,
	finishCallback: FinishedCallback,
	telemetryData: TelemetryData
): Promise<AsyncIterableObject<ChatCompletion>> {
	return new AsyncIterableObject<ChatCompletion>(async feed => {
		const { headerRequestId, serverExperiments } = getRequestId(response.headers);
		const requestId = headerRequestId || generateUuid();
		const ghRequestId = response.headers.get('x-github-request-id') ?? '';

		const bodyText = await response.text();

		let parsed: AnthropicNonStreamingResponse;
		try {
			parsed = JSON.parse(bodyText);
		} catch (e) {
			feed.reject(new Error(`Failed to parse non-streaming Anthropic response: ${e instanceof Error ? e.message : String(e)}`));
			return;
		}

		if (parsed.type === 'error') {
			feed.reject(new Error(`Anthropic API error: ${parsed.error?.message ?? 'Unknown error'}`));
			return;
		}

		let textContent = '';
		const toolCalls: { id: string; name: string; arguments: string }[] = [];
		for (const block of parsed.content ?? []) {
			switch (block.type) {
				case 'text':
					textContent += block.text;
					break;
				case 'tool_use':
					toolCalls.push({
						id: block.id,
						name: block.name,
						arguments: JSON.stringify(block.input),
					});
					break;
				case 'thinking':
				case 'redacted_thinking':
					break;
				default: {
					const unknownType = (block as { type: string }).type;
					logService.warn(`[messagesAPI] non-streaming: unknown content_block type '${unknownType}' for model ${parsed.model}`);
					telemetryService.sendMSFTTelemetryEvent('messagesApi.unknownContentBlock', {
						requestId,
						model: parsed.model,
						blockType: unknownType,
					});
					break;
				}
			}
		}

		const delta: IResponseDelta = {
			text: textContent,
			...(toolCalls.length > 0 ? {
				dardcorToolCalls: toolCalls.map(tc => ({
					id: tc.id,
					name: tc.name,
					arguments: tc.arguments,
				})),
			} : {}),
		};
		await finishCallback(textContent, 0, delta);

		if (parsed.stop_reason === 'refusal') {
			logService.warn(`[messagesAPI] non-streaming: Refusal received for model ${parsed.model}`);

			telemetryService.sendMSFTTelemetryEvent('messagesApi.refusal',
				{
					requestId,
					model: parsed.model,
					category: 'unknown',
				}
			);
		}

		const usage = parsed.usage;
		const completion = buildAnthropicCompletion({
			model: parsed.model,
			messageId: parsed.id,
			stopReason: parsed.stop_reason,
			textContent,
			toolCalls,
			inputTokens: usage?.input_tokens ?? 0,
			outputTokens: usage?.output_tokens ?? 0,
			cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
			cacheCreation1hTokens: usage?.cache_creation?.ephemeral_1h_input_tokens,
			cacheCreation5mTokens: usage?.cache_creation?.ephemeral_5m_input_tokens,
			cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
			thinkingTokens: usage?.output_tokens_details?.thinking_tokens,
			requestId,
			ghRequestId,
			serverExperiments,
			telemetryData,
		}, logService);

		logService.info(`[messagesAPI] non-streaming message returned. finish reason: [${completion.finishReason}]`);

		const dataToSendToTelemetry = telemetryData.extendedBy({
			completionChoiceFinishReason: completion.finishReason,
			headerRequestId: completion.requestId.headerRequestId
		});
		telemetryService.sendGHTelemetryEvent('completion.finishReason', dataToSendToTelemetry.properties, dataToSendToTelemetry.measurements);

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

		feed.emitOne(completion);
	}, async () => {
		await response.body.destroy();
	});
}

export class AnthropicMessagesProcessor {
	private textAccumulator: string = '';
	private toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map();
	private thinkingAccumulator: Map<number, { thinking: string; signature: string }> = new Map();
	private completedToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
	private messageId: string = '';
	private model: string = '';
	private inputTokens: number = 0;
	private outputTokens: number = 0;
	private cacheCreationTokens: number = 0;
	private cacheCreation1hTokens: number | undefined;
	private cacheCreation5mTokens: number | undefined;
	private cacheReadTokens: number = 0;
	private thinkingTokens: number | undefined;
	private dardcorUsage?: { total_nano_aiu: number };
	private contextManagementResponse?: ContextManagementResponse;
	private stopReason: string | undefined;
	private stopDetails?: { category?: string; explanation?: string; type?: string };

	constructor(
		private readonly telemetryData: TelemetryData,
		private readonly requestId: string,
		private readonly ghRequestId: string,
		private readonly serverExperiments: string,
		@ILogService private readonly logService: ILogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) { }

	private extractIPCodeCitations(annotations?: { IPCodeCitations?: AnthropicIPCodeCitation[] }): IIPCodeCitation[] {
		if (!annotations?.IPCodeCitations?.length) {
			return [];
		}

		const seenUrls = new Set<string>();
		const citations: IIPCodeCitation[] = [];

		for (const citation of annotations.IPCodeCitations) {
			const citationDetails = citation.citations;
			if (!citationDetails) {
				continue;
			}

			const { url, license, snippet } = citationDetails;

			if (typeof url !== 'string' || url.trim() === '') {
				continue;
			}

			if (typeof license !== 'string' || license.trim() === '') {
				continue;
			}

			if (typeof snippet !== 'string' || snippet.trim() === '') {
				continue;
			}

			if (!seenUrls.has(url)) {
				seenUrls.add(url);
				citations.push({
					citations: {
						url,
						license,
						snippet,
					}
				});
			}
		}

		if (citations.length > 0) {
			this.logService.trace(`[messagesAPI] IP code citations found: ${citations.length} unique citations`);
		}

		return citations;
	}

	public push(chunk: AnthropicStreamEvent, _onProgress: FinishedCallback): ChatCompletion | undefined {
		const onProgress = (delta: IResponseDelta): undefined => {
			this.textAccumulator += delta.text;
			_onProgress(this.textAccumulator, 0, delta);
		};

		switch (chunk.type) {
			case 'message_start':
				if (chunk.message) {
					this.messageId = chunk.message.id;
					this.model = chunk.message.model;
					this.inputTokens = chunk.message.usage.input_tokens ?? 0;
					this.outputTokens = chunk.message.usage.output_tokens ?? 0;
					this.cacheCreationTokens = chunk.message.usage.cache_creation_input_tokens ?? 0;
					this.cacheCreation1hTokens = chunk.message.usage.cache_creation?.ephemeral_1h_input_tokens ?? this.cacheCreation1hTokens;
					this.cacheCreation5mTokens = chunk.message.usage.cache_creation?.ephemeral_5m_input_tokens ?? this.cacheCreation5mTokens;
					this.cacheReadTokens = chunk.message.usage.cache_read_input_tokens ?? 0;
					this.thinkingTokens = chunk.message.usage.output_tokens_details?.thinking_tokens ?? this.thinkingTokens;
				}
				return;
			case 'content_block_start':
				if (chunk.content_block?.type === 'tool_use' && chunk.index !== undefined) {
					const toolCallId = chunk.content_block.id || generateUuid();
					this.toolCallAccumulator.set(chunk.index, {
						id: toolCallId,
						name: chunk.content_block.name || '',
						arguments: '',
					});
					if (this.textAccumulator.length) {
						onProgress({ text: ' ' });
					}
					onProgress({
						text: '',
						beginToolCalls: [{ name: chunk.content_block.name || '', id: toolCallId }]
					});
				} else if (chunk.content_block?.type === 'thinking' && chunk.index !== undefined) {
					this.thinkingAccumulator.set(chunk.index, {
						thinking: '',
						signature: '',
					});
				} else if (chunk.content_block?.type === 'redacted_thinking' && chunk.index !== undefined) {
					const data = (chunk.content_block as { type: 'redacted_thinking'; data: string }).data;
					onProgress({
						text: '',
						thinking: {
							id: `thinking_${chunk.index}`,
							encrypted: data,
							redacted: true,
						}
					});
				}
				return;
			case 'content_block_delta':
				if (chunk.delta) {
					if (chunk.delta.type === 'text_delta' && chunk.delta.text) {
						const ipCitations = this.extractIPCodeCitations(chunk.dardcor_annotations);
						if (ipCitations.length > 0) {
							return onProgress({ text: chunk.delta.text, ipCitations });
						}
						return onProgress({ text: chunk.delta.text });
					} else if (chunk.delta.type === 'thinking_delta' && chunk.delta.thinking && chunk.index !== undefined) {
						const thinking = this.thinkingAccumulator.get(chunk.index);
						if (thinking) {
							thinking.thinking += chunk.delta.thinking;
						}
						return onProgress({
							text: '',
							thinking: {
								id: `thinking_${chunk.index}`,
								text: chunk.delta.thinking,
							}
						});
					} else if (chunk.delta.type === 'signature_delta' && chunk.delta.signature && chunk.index !== undefined) {
						const thinking = this.thinkingAccumulator.get(chunk.index);
						if (thinking) {
							thinking.signature += chunk.delta.signature;
						}
					} else if (chunk.delta.type === 'input_json_delta' && chunk.delta.partial_json && chunk.index !== undefined) {
						const toolCall = this.toolCallAccumulator.get(chunk.index);
						if (toolCall) {
							toolCall.arguments += chunk.delta.partial_json;
							onProgress({
								text: '',
								dardcorToolCallStreamUpdates: [{
									id: toolCall.id,
									name: toolCall.name,
									arguments: toolCall.arguments,
								}],
							});
						}
					}
				}
				return;
			case 'content_block_stop':
				if (chunk.index !== undefined) {
					const toolCall = this.toolCallAccumulator.get(chunk.index);
					if (toolCall) {
						this.completedToolCalls.push(toolCall);
						onProgress({
							text: '',
							dardcorToolCalls: [{
								id: toolCall.id,
								name: toolCall.name,
								arguments: toolCall.arguments,
							}],
						});
						this.toolCallAccumulator.delete(chunk.index);
					}
					const thinking = this.thinkingAccumulator.get(chunk.index);
					if (thinking && thinking.signature) {
						onProgress({
							text: '',
							thinking: {
								id: `thinking_${chunk.index}`,
								encrypted: thinking.signature,
							}
						});
						this.thinkingAccumulator.delete(chunk.index);
					}
				}
				return;
			case 'message_delta':
				if (chunk.usage) {
					this.outputTokens = chunk.usage.output_tokens;
					this.inputTokens = chunk.usage.input_tokens ?? this.inputTokens;
					this.cacheCreationTokens = chunk.usage.cache_creation_input_tokens ?? this.cacheCreationTokens;
					this.cacheCreation1hTokens = chunk.usage.cache_creation?.ephemeral_1h_input_tokens ?? this.cacheCreation1hTokens;
					this.cacheCreation5mTokens = chunk.usage.cache_creation?.ephemeral_5m_input_tokens ?? this.cacheCreation5mTokens;
					this.cacheReadTokens = chunk.usage.cache_read_input_tokens ?? this.cacheReadTokens;
					this.thinkingTokens = chunk.usage.output_tokens_details?.thinking_tokens ?? this.thinkingTokens;
				}
				if (chunk.dardcor_usage && typeof chunk.dardcor_usage.total_nano_aiu === 'number') {
					this.dardcorUsage = chunk.dardcor_usage;
				}
				if (chunk.context_management) {
					this.contextManagementResponse = chunk.context_management;
					return onProgress({
						text: '',
						contextManagement: chunk.context_management
					});
				}
				if (chunk.delta?.stop_reason) {
					this.stopReason = chunk.delta.stop_reason;
				}
				if (chunk.delta?.stop_details) {
					this.stopDetails = chunk.delta.stop_details;
				}
				return;
			case 'message_stop': {
				if (this.contextManagementResponse) {
					const totalClearedTokens = this.contextManagementResponse.applied_edits.reduce(
						(sum, edit) => sum + (edit.cleared_input_tokens || 0),
						0
					);
					const totalClearedToolUses = this.contextManagementResponse.applied_edits.reduce(
						(sum, edit) => sum + (edit.cleared_tool_uses || 0),
						0
					);
					const totalClearedThinkingTurns = this.contextManagementResponse.applied_edits.reduce(
						(sum, edit) => sum + (edit.cleared_thinking_turns || 0),
						0
					);
					this.logService.trace(`[messagesAPI] Anthropic context editing applied: cleared ${totalClearedTokens} tokens, ${totalClearedToolUses} tool uses.`);

					this.telemetryService.sendMSFTTelemetryEvent('contextEditingApplied',
						{
							requestId: this.requestId,
							interactionId: this.requestId,
							model: this.model,
						},
						{
							clearedTokens: totalClearedTokens,
							clearedToolUses: totalClearedToolUses,
							clearedThinkingTurns: totalClearedThinkingTurns,
						}
					);
				}
				if (this.stopReason === 'refusal') {
					const category = this.stopDetails?.category ?? 'unknown';
					this.logService.warn(`[messagesAPI] Refusal received: category='${category}' for model ${this.model}`);

					this.telemetryService.sendMSFTTelemetryEvent('messagesApi.refusal',
						{
							requestId: this.requestId,
							model: this.model,
							category,
						}
					);
				}

				return buildAnthropicCompletion({
					model: this.model,
					messageId: this.messageId,
					stopReason: this.stopReason,
					textContent: this.textAccumulator,
					toolCalls: this.completedToolCalls,
					inputTokens: this.inputTokens,
					outputTokens: this.outputTokens,
					cacheCreationTokens: this.cacheCreationTokens,
					cacheCreation1hTokens: this.cacheCreation1hTokens,
					cacheCreation5mTokens: this.cacheCreation5mTokens,
					cacheReadTokens: this.cacheReadTokens,
					thinkingTokens: this.thinkingTokens,
					requestId: this.requestId,
					ghRequestId: this.ghRequestId,
					serverExperiments: this.serverExperiments,
					telemetryData: this.telemetryData,
					dardcorUsage: this.dardcorUsage,
				}, this.logService);
			}
			case 'error': {
				const errorMessage = (chunk as unknown as { error?: { message?: string } }).error?.message || 'Unknown error';
				return onProgress({
					text: '',
					dardcorErrors: [{
						agent: 'anthropic',
						code: 'unknown',
						message: errorMessage,
						type: 'error',
						identifier: undefined
					}]
				});
			}
		}
	}
}


