/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type Anthropic from '@anthropic-ai/sdk';
import { generateUuid } from '../../../../base/common/uuid.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IDardcorRouterModel, IDardcorRouterModelPriceTier } from '../../common/dardcorRouterModel.js';

export interface IDardcorRouterRequestOptions {
	readonly headers?: Readonly<Record<string, string>>;
	readonly signal?: AbortSignal;
}

export interface IDardcorUtilityChatMessage {
	readonly role: 'system' | 'user' | 'assistant';
	readonly content: string;
}

export interface IDardcorUtilityChatCompletionRequest {
	readonly messages: readonly IDardcorUtilityChatMessage[];
	readonly temperature?: number;
	readonly maxTokens?: number;
}

export interface IDardcorRouterErrorEnvelope extends Anthropic.ErrorResponse { }

export const DARDCOR_ROUTER_ERROR_STATUS_STREAMING = 520;

export class DardcorRouterApiError extends Error {
	constructor(
		readonly status: number,
		readonly envelope: IDardcorRouterErrorEnvelope,
		message?: string,
	) {
		super(message ?? envelope.error.message);
		this.name = 'DardcorRouterApiError';
	}
}

export type FetchFunction = typeof globalThis.fetch;

export const IDardcorRouterService = createDecorator<IDardcorRouterService>('dardcorRouterService');

export interface IDardcorRouterService {
	readonly _serviceBrand: undefined;
	messages(request: Anthropic.MessageCreateParamsStreaming, options?: IDardcorRouterRequestOptions): AsyncGenerator<Anthropic.MessageStreamEvent>;
	messages(request: Anthropic.MessageCreateParamsNonStreaming, options?: IDardcorRouterRequestOptions): Promise<Anthropic.Message>;
	countTokens(request: Anthropic.MessageCountTokensParams, options?: IDardcorRouterRequestOptions): Promise<Anthropic.MessageTokensCount>;
	models(options?: IDardcorRouterRequestOptions): Promise<IDardcorRouterModel[]>;
	responses(body: string, options?: IDardcorRouterRequestOptions): Promise<Response>;
	utilityChatCompletion(request: IDardcorUtilityChatCompletionRequest, options?: IDardcorRouterRequestOptions): Promise<string>;
}

const DEFAULT_ROUTER_PORT = 25128;
const DEFAULT_ROUTER_KEY = 'sk-dardcor-local-key';
const ROUTER_MODEL_LIST_PATH = '/v1/models';
const UTILITY_DEFAULT_MODEL = 'gpt-4o-mini';
const UTILITY_DEFAULT_TEMPERATURE = 0.1;

function resolveRouterBaseUrl(): string {
	const configuredUrl = process.env.DARDCOR_ROUTER_URL?.trim();
	if (configuredUrl) {
		let parsed: URL;
		try {
			parsed = new URL(configuredUrl);
		} catch {
			throw new Error('DARDCOR_ROUTER_URL must be a valid absolute URL.');
		}
		if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
			throw new Error('DARDCOR_ROUTER_URL must use HTTP(S) and must not contain credentials.');
		}
		parsed.pathname = parsed.pathname.replace(/\/$/, '').replace(/\/v1$/, '');
		parsed.search = '';
		parsed.hash = '';
		return parsed.toString().replace(/\/$/, '');
	}

	const configuredPort = process.env.DARDCOR_PORT;
	const port = configuredPort === undefined || configuredPort.trim() === '' ? DEFAULT_ROUTER_PORT : Number(configuredPort);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('DARDCOR_PORT must be an integer between 1 and 65535.');
	}
	return `http://127.0.0.1:${port}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function finiteNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return undefined;
}

function normalizeRouterModel(value: unknown, index: number): IDardcorRouterModel | undefined {
	const raw = asRecord(value);
	const id = nonEmptyString(raw?.id) ?? (typeof value === 'string' ? nonEmptyString(value) : undefined);
	if (!id || id.toLowerCase() === 'auto' || id.toLowerCase() === 'claude-none') {
		return undefined;
	}

	const ownedBy = nonEmptyString(raw?.owned_by);
	const owner = (nonEmptyString(raw?.vendor) ?? ownedBy ?? id.split('/')[0]).toLowerCase();
	const isAnthropic = owner.includes('anthropic') || /(^|[/:-])claude([/:-]|$)/i.test(id);
	const isOpenAI = owner === 'openai' || /(^|[/:-])(gpt|o[1345])([/-]|$)/i.test(id);
	const vendor = isAnthropic ? 'Anthropic' : isOpenAI ? 'OpenAI' : (ownedBy ?? owner);
	const rawCapabilities = asRecord(raw?.capabilities);
	const rawLimits = asRecord(rawCapabilities?.limits);
	const rawSupports = asRecord(rawCapabilities?.supports);
	const contextWindow = finiteNumber(rawCapabilities?.contextWindow, raw?.context_length, rawLimits?.max_context_window_tokens);
	const maxOutput = finiteNumber(rawCapabilities?.maxOutput, raw?.max_completion_tokens, rawLimits?.max_output_tokens);
	const reasoningEffort = Array.isArray(rawSupports?.reasoning_effort)
		? rawSupports.reasoning_effort.filter((item): item is string => typeof item === 'string')
		: Array.isArray(rawCapabilities?.reasoning_effort)
			? rawCapabilities.reasoning_effort.filter((item): item is string => typeof item === 'string')
			: undefined;
	const supportsMessages = isAnthropic;
	const endpoint = supportsMessages ? '/v1/messages' : '/v1/responses';
	const fallback = index === 0;
	const policy = asRecord(raw?.policy);
	const billing = asRecord(raw?.billing);
	const billingPrices = asRecord(billing?.token_prices);

	return {
		id,
		object: nonEmptyString(raw?.object) ?? 'model',
		name: nonEmptyString(raw?.name) ?? id,
		vendor,
		owned_by: ownedBy,
		model_picker_enabled: raw?.model_picker_enabled !== false,
		is_chat_default: raw?.is_chat_default === true || (raw?.is_chat_default === undefined && fallback),
		is_chat_fallback: raw?.is_chat_fallback === true || (raw?.is_chat_fallback === undefined && fallback),
		model_picker_price_category: nonEmptyString(raw?.model_picker_price_category),
		supported_endpoints: Array.isArray(raw?.supported_endpoints)
			? raw.supported_endpoints.filter((item): item is string => typeof item === 'string')
			: [endpoint, '/chat/completions'],
		preview: raw?.preview === true,
		billing: billing ? {
			is_premium: billing.is_premium === true,
			multiplier: finiteNumber(billing.multiplier),
			restricted_to: Array.isArray(billing.restricted_to) ? billing.restricted_to.filter((item): item is string => typeof item === 'string') : undefined,
			token_prices: billingPrices ? {
				default: asRecord(billingPrices.default) as IDardcorRouterModelPriceTier | undefined,
				long_context: asRecord(billingPrices.long_context) as IDardcorRouterModelPriceTier | undefined,
			} : undefined,
		} : undefined,
		capabilities: {
			contextWindow,
			maxOutput,
			tools: rawCapabilities?.tools === true || rawCapabilities?.tool_calls === true,
			vision: rawCapabilities?.vision === true,
			reasoning: rawCapabilities?.reasoning === true,
			thinkingFormat: nonEmptyString(rawCapabilities?.thinkingFormat),
			reasoning_effort: reasoningEffort,
			limits: {
				max_context_window_tokens: contextWindow,
				max_output_tokens: maxOutput,
				max_prompt_tokens: finiteNumber(rawLimits?.max_prompt_tokens, contextWindow),
			},
			supports: {
				tool_calls: rawSupports?.tool_calls === true || rawCapabilities?.tools === true,
				vision: rawSupports?.vision === true || rawCapabilities?.vision === true,
				reasoning_effort: reasoningEffort,
				adaptive_thinking: rawSupports?.adaptive_thinking === true,
			},
		},
		context_length: contextWindow,
		max_completion_tokens: maxOutput,
		policy: policy ? { state: nonEmptyString(policy.state), terms: nonEmptyString(policy.terms) } : undefined,
	};
}

export class DardcorRouterService implements IDardcorRouterService {
	declare readonly _serviceBrand: undefined;
	private readonly _fetch: FetchFunction;

	constructor(
		fetchFn: FetchFunction | undefined,
		@ILogService private readonly _logService: ILogService,
	) {
		this._fetch = fetchFn ?? globalThis.fetch;
	}

	async models(options?: IDardcorRouterRequestOptions): Promise<IDardcorRouterModel[]> {
		const response = await this._request(ROUTER_MODEL_LIST_PATH, { method: 'GET' }, options);
		const payload = await response.json() as { data?: unknown };
		if (!Array.isArray(payload?.data)) {
			throw new Error('Dardcor Router returned an invalid model catalog: expected a data array.');
		}
		const seen = new Set<string>();
		const models: IDardcorRouterModel[] = [];
		for (const value of payload.data) {
			const model = normalizeRouterModel(value, models.length);
			if (!model || seen.has(model.id)) {
				continue;
			}
			seen.add(model.id);
			models.push(model);
		}
		return models;
	}

	async responses(body: string, options?: IDardcorRouterRequestOptions): Promise<Response> {
		let model = '<unknown>';
		try {
			model = nonEmptyString(asRecord(JSON.parse(body))?.model) ?? '<none>';
		} catch {
		}
		this._logService.debug(`[DardcorRouterService] POST /v1/responses model=${model}`);
		return this._request('/v1/responses', { method: 'POST', body }, options);
	}

	async utilityChatCompletion(request: IDardcorUtilityChatCompletionRequest, options?: IDardcorRouterRequestOptions): Promise<string> {
		const models = await this.models(options);
		const selected = models.find(model => model.id === UTILITY_DEFAULT_MODEL || model.id.endsWith(`/${UTILITY_DEFAULT_MODEL}`))
			?? models.find(model => model.is_chat_fallback)
			?? models.find(model => model.is_chat_default)
			?? models[0];
		if (!selected) {
			throw new Error('Dardcor Router has no connected chat models for background utility requests.');
		}

		const response = await this._request('/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({
				model: selected.id,
				messages: request.messages.map(message => ({ role: message.role, content: message.content })),
				stream: false,
				temperature: request.temperature ?? UTILITY_DEFAULT_TEMPERATURE,
				top_p: 1,
				...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
			}),
		}, options);
		const payload = await response.json() as { choices?: ReadonlyArray<{ message?: { content?: unknown } }> };
		const content = payload.choices?.[0]?.message?.content;
		if (typeof content === 'string' && content.trim()) {
			return content;
		}
		if (Array.isArray(content)) {
			const text = content.map(item => nonEmptyString(asRecord(item)?.text)).filter((item): item is string => !!item).join('');
			if (text) {
				return text;
			}
		}
		throw new Error('Dardcor Router chat completion returned no text content.');
	}

	async countTokens(request: Anthropic.MessageCountTokensParams, options?: IDardcorRouterRequestOptions): Promise<Anthropic.MessageTokensCount> {
		const response = await this._request('/v1/messages/count_tokens', {
			method: 'POST',
			body: JSON.stringify(request),
		}, options);
		const payload = await response.json() as { input_tokens?: unknown };
		if (typeof payload.input_tokens !== 'number' || !Number.isFinite(payload.input_tokens)) {
			throw new Error('Dardcor Router returned an invalid token-count response.');
		}
		return payload as Anthropic.MessageTokensCount;
	}

	messages(
		request: Anthropic.MessageCreateParamsStreaming,
		options?: IDardcorRouterRequestOptions,
	): AsyncGenerator<Anthropic.MessageStreamEvent>;
	messages(
		request: Anthropic.MessageCreateParamsNonStreaming,
		options?: IDardcorRouterRequestOptions,
	): Promise<Anthropic.Message>;
	messages(
		request: Anthropic.MessageCreateParams,
		options?: IDardcorRouterRequestOptions,
	): AsyncGenerator<Anthropic.MessageStreamEvent> | Promise<Anthropic.Message> {
		if (request.stream) {
			return this._messagesStreaming(request, options);
		}
		return this._messagesNonStreaming(request, options);
	}

	private async *_messagesStreaming(request: Anthropic.MessageCreateParams, options?: IDardcorRouterRequestOptions): AsyncGenerator<Anthropic.MessageStreamEvent> {
		const response = await this._sendMessagesRequest(request, true, options);
		if (!response.body) {
			throw new Error('Dardcor Router returned a streaming response without a body.');
		}
		yield* this._readSSE(response.body);
	}

	private async _messagesNonStreaming(request: Anthropic.MessageCreateParams, options?: IDardcorRouterRequestOptions): Promise<Anthropic.Message> {
		const response = await this._sendMessagesRequest(request, false, options);
		return await response.json() as Anthropic.Message;
	}

	private async _sendMessagesRequest(request: Anthropic.MessageCreateParams, stream: boolean, options?: IDardcorRouterRequestOptions): Promise<Response> {
		const { system, ...rest } = request;
		const body = JSON.stringify({
			...rest,
			stream,
			...(system === undefined ? {} : { system: typeof system === 'string' ? [{ type: 'text', text: system }] : system }),
		});
		this._logService.debug(`[DardcorRouterService] POST /v1/messages model=${request.model} stream=${stream}`);
		return this._request('/v1/messages', {
			method: 'POST',
			body,
			headers: { 'anthropic-version': '2023-06-01', 'x-api-key': process.env.DARDCOR_API_KEY || DEFAULT_ROUTER_KEY },
		}, options);
	}

	private async _request(path: string, init: RequestInit, options?: IDardcorRouterRequestOptions): Promise<Response> {
		const baseUrl = resolveRouterBaseUrl();
		const url = `${baseUrl}${path}`;
		const requestId = generateUuid();
		const headers = new Headers(options?.headers);
		for (const [key, value] of new Headers(init.headers)) {
			headers.set(key, value);
		}
		headers.set('Authorization', `Bearer ${process.env.DARDCOR_API_KEY || DEFAULT_ROUTER_KEY}`);
		headers.set('X-Request-Id', requestId);
		if (init.body !== undefined && !headers.has('Content-Type')) {
			headers.set('Content-Type', 'application/json');
		}

		let response: Response;
		try {
			response = await this._fetch(url, { ...init, headers, signal: options?.signal });
		} catch (error) {
			this._logService.error(`[DardcorRouterService] Request failed: ${path}`, error);
			throw error;
		}

		if (!response.ok) {
			const bodyText = (await response.text().catch(() => '')).slice(0, 8192);
			const envelope = buildRouterErrorEnvelope(response.status, response.statusText, bodyText);
			throw new DardcorRouterApiError(response.status, envelope, `Dardcor Router ${path} failed: ${response.status} ${response.statusText} — ${envelope.error.message}`);
		}
		return response;
	}

	private async *_readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<Anthropic.MessageStreamEvent> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let sawMessageStop = false;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r?\n/);
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					const event = this._parseDataLine(line);
					if (event) {
						yield event;
						if (event.type === 'message_stop') {
							sawMessageStop = true;
							return;
						}
					}
				}
			}
			buffer += decoder.decode();
			if (buffer.trim()) {
				const event = this._parseDataLine(buffer.trimEnd());
				if (event) {
					yield event;
					sawMessageStop = event.type === 'message_stop';
				}
			}
			if (!sawMessageStop) {
				throw new DardcorRouterApiError(DARDCOR_ROUTER_ERROR_STATUS_STREAMING, buildRouterErrorEnvelope(502, 'Incomplete stream', 'Dardcor Router ended the Anthropic stream before message_stop.'));
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
			}
			reader.releaseLock();
		}
	}

	private _parseDataLine(line: string): Anthropic.MessageStreamEvent | undefined {
		if (!line.startsWith('data:')) {
			return undefined;
		}
		const data = line.slice(5).trim();
		if (!data || data === '[DONE]') {
			return undefined;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			this._logService.warn('[DardcorRouterService] Could not parse SSE data frame.');
			return undefined;
		}
		const record = asRecord(parsed);
		const type = nonEmptyString(record?.type);
		if (!record || !type) {
			return undefined;
		}
		if (type === 'error') {
			const rawError = asRecord(record.error);
			const errorMessage = nonEmptyString(rawError?.message) ?? nonEmptyString(record.error) ?? 'Unknown Dardcor Router streaming error';
			const envelope: IDardcorRouterErrorEnvelope = {
				type: 'error',
				error: {
					type: (nonEmptyString(rawError?.type) as any) ?? 'api_error',
					message: errorMessage,
				},
				request_id: nonEmptyString(record.request_id) ?? null,
			};
			throw new DardcorRouterApiError(DARDCOR_ROUTER_ERROR_STATUS_STREAMING, envelope);
		}
		if (!KNOWN_ANTHROPIC_STREAM_EVENTS.has(type)) {
			return undefined;
		}
		return parsed as Anthropic.MessageStreamEvent;
	}
}

function buildRouterErrorEnvelope(status: number, statusText: string, bodyText: string): IDardcorRouterErrorEnvelope {
	try {
		const parsed = JSON.parse(bodyText) as unknown;
		const record = asRecord(parsed);
		const rawError = asRecord(record?.error);
		if (record?.type === 'error' && nonEmptyString(rawError?.type) && nonEmptyString(rawError?.message)) {
			return parsed as IDardcorRouterErrorEnvelope;
		}
		if (rawError && nonEmptyString(rawError.message)) {
			return {
				type: 'error',
				error: { type: (nonEmptyString(rawError.type) as any) ?? 'api_error', message: String(rawError.message) },
				request_id: nonEmptyString(record?.request_id) ?? null,
			};
		}
	} catch {
	}
	return {
		type: 'error',
		error: { type: 'api_error', message: bodyText || `${status} ${statusText}` },
		request_id: null,
	};
}

const KNOWN_ANTHROPIC_STREAM_EVENTS = new Set([
	'message_start', 'message_delta', 'message_stop',
	'content_block_start', 'content_block_delta', 'content_block_stop',
]);
