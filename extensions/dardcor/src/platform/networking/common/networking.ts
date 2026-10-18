/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestMetadata } from '@vscode/copilot-api';
import { Raw } from '@vscode/prompt-tsx';
import type { CancellationToken } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { ITokenizer, TokenizerType } from '../../../util/common/tokenizer';
import { AsyncIterableObject } from '../../../util/dardcor/base/common/async';
import { CancellationError } from '../../../util/dardcor/base/common/errors';
import { ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { Source } from '../../chat/common/chatMLFetcher';
import type { ChatLocation, ChatResponse } from '../../chat/common/commonTypes';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { CustomModel, EndpointEditToolName } from '../../endpoint/common/endpointProvider';
import { ILogService } from '../../log/common/logService';
import { ITelemetryService, TelemetryProperties } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { AnthropicMessagesTool, ContextManagement } from './anthropic';
import { FinishedCallback, OpenAiFunctionTool, OpenAiResponsesFunctionTool, OpenAiToolSearchTool, OptionalChatRequestParams, Prediction } from './fetch';
import { FetcherId, FetchOptions, IAbortController, IFetcherService, PaginationOptions, Response } from './fetcherService';
import { ChatCompletion, OpenAIContextManagement, RawMessageConversionCallback, rawMessageToCAPI } from './openai';

export interface IFetcher {
	getUserAgentLibrary(): string;
	fetch(url: string, options: FetchOptions): Promise<Response>;
	disconnectAll(): Promise<unknown>;
	makeAbortController(): IAbortController;
	isAbortError(e: any): boolean;
	isInternetDisconnectedError(e: any): boolean;
	isFetcherError(err: any): boolean;
	isNetworkProcessCrashedError(err: any): boolean;
	getUserMessageForFetcherError(err: any): string;
	fetchWithPagination<T>(baseUrl: string, options: PaginationOptions<T>): Promise<T[]>;
}

export const userAgentLibraryHeader = 'X-VSCode-User-Agent-Library-Version';

export type ReqHeaders = { [key: string]: string };
export interface HeaderContributor {
	contributeHeaderValues(headers: ReqHeaders): void;
}

const requestTimeoutMs = 30 * 1000;


export interface IEndpointBody {
	tools?: (OpenAiFunctionTool | OpenAiResponsesFunctionTool | AnthropicMessagesTool | OpenAiToolSearchTool)[];
	model?: string;
	previous_response_id?: string;
	max_tokens?: number;
	max_output_tokens?: number;
	max_completion_tokens?: number;
	temperature?: number;
	top_p?: number;
	stream?: boolean;
	context_management?: ContextManagement | OpenAIContextManagement[];
	prediction?: Prediction;
	messages?: any[];
	n?: number;
	reasoning?: { effort?: string; summary?: string };
	tool_choice?: OptionalChatRequestParams['tool_choice'] | { type: 'function'; name: string } | string;
	top_logprobs?: number;
	intent?: boolean;
	intent_threshold?: number;
	state?: 'enabled';
	snippy?: { enabled: boolean };
	stream_options?: { include_usage?: boolean };
	prompt?: string;
	reasoning_effort?: string;
	dimensions?: number;
	embed?: boolean;
	qos?: any;
	content?: string;
	path?: string;
	local_hashes?: string[];
	language_id?: number;
	query?: string;
	scopingQuery?: string;
	limit?: number;
	similarity?: number;
	scoping_query?: string;

	input?: readonly any[];
	truncation?: 'auto' | 'disabled';
	prompt_cache_key?: string;
	prompt_cache_options?: { mode: 'implicit' | 'explicit' };
	include?: ['reasoning.encrypted_content'];
	store?: boolean;
	text?: {
		verbosity?: 'low' | 'medium' | 'high';
	};

	thinking?: {
		type: 'enabled' | 'disabled' | 'adaptive';
		budget_tokens?: number;
	};
	output_config?: {
		effort?: string;
	};

	thinking_budget?: number;
}

export interface IEndpointFetchOptions {
	suppressIntegrationId?: boolean;
}

export interface IEndpoint {
	readonly urlOrRequestMetadata: string | RequestMetadata;
	getExtraHeaders?(location?: ChatLocation, interactionTypeOverride?: InteractionTypeOverride): Record<string, string>;
	getEndpointFetchOptions?(): IEndpointFetchOptions;
	interceptBody?(body: IEndpointBody | undefined): void;
	acquireTokenizer(): ITokenizer;
	readonly modelMaxPromptTokens: number;
	readonly name: string;
	readonly version: string;
	readonly family: string;
	readonly tokenizer: TokenizerType;
}

export function stringifyUrlOrRequestMetadata(urlOrRequestMetadata: string | RequestMetadata): string {
	if (typeof urlOrRequestMetadata === 'string') {
		return urlOrRequestMetadata;
	}
	return JSON.stringify(urlOrRequestMetadata);
}

export function isCAPIRequestMetadata(urlOrRequestMetadata: string | RequestMetadata): urlOrRequestMetadata is RequestMetadata {
	return typeof urlOrRequestMetadata !== 'string';
}

export function isCAPIEndpoint(endpoint: IEndpoint): boolean {
	return isCAPIRequestMetadata(endpoint.urlOrRequestMetadata);
}

export interface IEmbeddingsEndpoint extends IEndpoint {
	readonly maxBatchSize: number;
}

export interface IModelCapabilityOptions {
	enableThinking?: boolean;
	reasoningEffort?: string;
	enableToolSearch?: boolean;
	enableContextEditing?: boolean;
}

export interface IMakeChatRequestOptions {
	debugName: string;
	messages: Raw.ChatMessage[];
	useWebSocket?: boolean;
	ignoreStatefulMarker?: boolean;
	modeChanged?: boolean;
	finishedCb: FinishedCallback | undefined;
	location: ChatLocation;
	source?: Source;
	conversationId?: string;
	webSocketConnectionId?: string;
	turnId?: string;
	requestOptions?: Omit<OptionalChatRequestParams, 'n'>;
	userInitiatedRequest?: boolean;
	isConversationRequest?: boolean;
	telemetryProperties?: IChatRequestTelemetryProperties;
	enableRetryOnFilter?: boolean;
	enableRetryOnError?: boolean;
	useFetcher?: FetcherId;
	modelCapabilities?: IModelCapabilityOptions;
	summarizedAtRoundId?: string;
	canRetryOnceWithoutRollback?: boolean;
	customMetadata?: Record<string, string | number | boolean | undefined>;
	topLevelTurnId?: string;
	interactionTypeOverride?: InteractionTypeOverride;
}

export type IChatRequestTelemetryProperties = {
	requestId?: string;
	messageId?: string;
	conversationId?: string;
	messageSource?: string;
	associatedRequestId?: string;
	retryAfterError?: string;
	retryAfterErrorGitHubRequestId?: string;
	connectivityTestError?: string;
	connectivityTestErrorGitHubRequestId?: string;
	retryAfterFilterCategory?: string;
	subType?: string;
	parentRequestId?: string;
	parentToolCallId?: string;
	parentHeaderRequestId?: string;
	parentModelCallId?: string;
	turnIndex?: string;
	iterationNumber?: string;
};

export interface ICreateEndpointBodyOptions extends IMakeChatRequestOptions {
	requestId: string;
	postOptions: OptionalChatRequestParams;
}

export interface ITokenPriceTier {
	readonly inputPrice: number;
	readonly outputPrice: number;
	readonly cacheReadTokenPrice: number | undefined;
	readonly cacheWriteTokenPrice: number | undefined;
	readonly contextMax?: number;
}

export interface IChatEndpointTokenPricing {
	readonly default: ITokenPriceTier;
	readonly longContext?: ITokenPriceTier;
}

export interface IChatEndpoint extends IEndpoint {
	readonly maxOutputTokens: number;
	readonly model: string;
	readonly modelProvider: string;
	readonly apiType?: string;
	readonly supportsThinkingContentInHistory?: boolean;
	readonly supportsAdaptiveThinking?: boolean;
	readonly minThinkingBudget?: number;
	readonly maxThinkingBudget?: number;
	readonly supportsReasoningEffort?: string[];
	readonly supportsToolSearch?: boolean;
	readonly supportsContextEditing?: boolean;
	readonly supportsToolCalls: boolean;
	readonly supportsVision: boolean;
	readonly supportsPrediction: boolean;
	readonly supportedEditTools?: readonly EndpointEditToolName[];
	readonly showInModelPicker: boolean;
	readonly isPremium?: boolean;
	readonly degradationReason?: string;
	readonly warningText?: Record<string, string>;
	readonly promo?: { id: string; discountPercent: number; endsAt: string; message: string };
	readonly multiplier?: number;
	readonly restrictedToSkus?: string[];
	readonly tokenPricing?: IChatEndpointTokenPricing;
	readonly priceCategory?: string;
	readonly modelPickerCategory?: string;
	readonly isFallback: boolean;
	readonly customModel?: CustomModel;
	readonly isExtensionContributed?: boolean;
	readonly maxPromptImages?: number;
	readonly ownsAuthorization?: boolean;
	processResponseFromChatEndpoint(
		telemetryService: ITelemetryService,
		logService: ILogService,
		response: Response,
		expectedNumChoices: number,
		finishCallback: FinishedCallback,
		telemetryData: TelemetryData,
		cancellationToken?: CancellationToken,
		location?: ChatLocation,
	): Promise<AsyncIterableObject<ChatCompletion>>;

	makeChatRequest(
		debugName: string,
		messages: Raw.ChatMessage[],
		finishedCb: FinishedCallback | undefined,
		token: CancellationToken,
		location: ChatLocation,
		source?: Source,
		requestOptions?: Omit<OptionalChatRequestParams, 'n'>,
		userInitiatedRequest?: boolean,
		telemetryProperties?: TelemetryProperties,
	): Promise<ChatResponse>;

	makeChatRequest2(options: IMakeChatRequestOptions, token: CancellationToken): Promise<ChatResponse>;

	createRequestBody(options: ICreateEndpointBodyOptions): IEndpointBody;

	cloneWithTokenOverride(modelMaxPromptTokens: number): IChatEndpoint;
}

export function createCapiRequestBody(options: ICreateEndpointBodyOptions, model: string, callback?: RawMessageConversionCallback) {

	const request: IEndpointBody = {
		messages: rawMessageToCAPI(options.messages, callback),
		model,
	};

	if (options.postOptions) {
		Object.assign(request, options.postOptions);
	}

	return request;
}

export interface INetworkRequestOptions {
	readonly requestType: 'GET' | 'POST';
	readonly endpointOrUrl: IEndpoint | string | RequestMetadata;
	readonly secretKey: string | undefined;
	readonly intent: string;
	readonly requestId: string;
	readonly body?: IEndpointBody;
	readonly additionalHeaders?: Record<string, string>;
	readonly cancelToken?: CancellationToken;
	readonly useFetcher?: FetcherId;
	readonly canRetryOnce?: boolean;
	readonly location?: ChatLocation;
	readonly interactionTypeOverride?: InteractionTypeOverride;
}

export type InteractionTypeOverride = 'conversation-subagent' | 'conversation-compaction' | 'conversation-background';

function networkRequest(
	accessor: ServicesAccessor,
	options: INetworkRequestOptions,
): Promise<Response> {
	const fetcher = accessor.get(IFetcherService);
	const telemetryService = accessor.get(ITelemetryService);
	const capiClientService = accessor.get(ICAPIClientService);
	const { requestType, endpointOrUrl, secretKey, intent, requestId, body, additionalHeaders, cancelToken, useFetcher, canRetryOnce = true, location } = options;

	const endpoint = typeof endpointOrUrl === 'string' || 'type' in endpointOrUrl ? {
		modelMaxPromptTokens: 0,
		urlOrRequestMetadata: endpointOrUrl,
		family: '',
		tokenizer: TokenizerType.O200K,
		acquireTokenizer: () => {
			throw new Error('Method not implemented.');
		},
		name: '',
		version: '',
	} satisfies IEndpoint : endpointOrUrl;
	const agentInteractionType = options.interactionTypeOverride ?? intent;

	const headers: ReqHeaders = {
		...(secretKey ? { Authorization: `Bearer ${secretKey}` } : {}),
		'X-Request-Id': requestId,
		'OpenAI-Intent': intent,
		'X-GitHub-Api-Version': '2026-01-09',
		...additionalHeaders,
		...(endpoint.getExtraHeaders ? endpoint.getExtraHeaders(location, options.interactionTypeOverride) : {}),
	};
	headers['X-Interaction-Type'] = agentInteractionType;
	headers['X-Agent-Task-Id'] = requestId;

	if (endpoint.interceptBody) {
		endpoint.interceptBody(body);
	}

	const endpointFetchOptions = endpoint.getEndpointFetchOptions?.();
	const request: FetchOptions = {
		callSite: `network-request-${intent}`,
		method: requestType,
		headers: headers,
		json: body,
		timeout: requestTimeoutMs,
		useFetcher,
		suppressIntegrationId: endpointFetchOptions?.suppressIntegrationId
	};

	if (cancelToken) {
		const abort = fetcher.makeAbortController();
		cancelToken.onCancellationRequested(() => {
			telemetryService.sendGHTelemetryEvent('networking.cancelRequest', {
				headerRequestId: requestId,
			});
			abort.abort();
		});
		request.signal = abort.signal;
	}
	if (!isCAPIRequestMetadata(endpoint.urlOrRequestMetadata)) {
		const requestPromise = fetcher.fetch(endpoint.urlOrRequestMetadata, request).catch(reason => {
			if (canRetryOnce && canRetryOnceNetworkError(reason)) {
				telemetryService.sendGHTelemetryEvent('networking.disconnectAll');
				return fetcher.disconnectAll().then(() => {
					return fetcher.fetch(endpoint.urlOrRequestMetadata as string, request);
				});
			} else if (fetcher.isAbortError(reason)) {
				throw new CancellationError();
			} else {
				throw reason;
			}
		});
		return requestPromise;
	} else {
		return capiClientService.makeRequest(request, endpoint.urlOrRequestMetadata);
	}
}

export function canRetryOnceNetworkError(reason: any) {
	return [
		'ECONNRESET',
		'ETIMEDOUT',
		'ERR_CONNECTION_RESET',
		'ERR_NETWORK_CHANGED',
		'ERR_HTTP2_INVALID_SESSION',
		'ERR_HTTP2_STREAM_CANCEL',
		'ERR_HTTP2_GOAWAY_SESSION',
		'ERR_HTTP2_PROTOCOL_ERROR',
		'ERR_FAILED',
	].includes(reason?.code);
}

export function postRequest(
	accessor: ServicesAccessor,
	options: Omit<INetworkRequestOptions, 'requestType'>,
): Promise<Response> {
	return networkRequest(accessor, { ...options, requestType: 'POST' });
}

export function getRequest(
	accessor: ServicesAccessor,
	options: Omit<INetworkRequestOptions, 'requestType'>,
): Promise<Response> {
	return networkRequest(accessor, { ...options, requestType: 'GET' });
}

export const IHeaderContributors = createServiceIdentifier<HeaderContributors>('headerContributors');

export interface IHeaderContributors {
	readonly _serviceBrand: undefined;
	add(contributor: HeaderContributor): void;
	remove(contributor: HeaderContributor): void;
	contributeHeaders(headers: ReqHeaders): void;
	size(): number;
}

export class HeaderContributors implements IHeaderContributors {
	declare readonly _serviceBrand: undefined;
	private readonly contributors: HeaderContributor[] = [];

	add(contributor: HeaderContributor) {
		this.contributors.push(contributor);
	}

	remove(contributor: HeaderContributor) {
		const index = this.contributors.indexOf(contributor);

		if (index === -1) {
			return;
		}

		this.contributors.splice(index, 1);
	}

	contributeHeaders(headers: ReqHeaders) {
		for (const contributor of this.contributors) {
			contributor.contributeHeaderValues(headers);
		}
	}

	size() {
		return this.contributors.length;
	}
}
