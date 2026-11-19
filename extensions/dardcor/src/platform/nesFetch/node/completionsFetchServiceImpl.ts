/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterUtilsExt } from '../../../util/common/asyncIterableUtils';
import { ErrorUtils } from '../../../util/common/errors';
import { Result } from '../../../util/common/result';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { Codicon } from '../../../util/dardcor/base/common/codicons';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { ThemeIcon } from '../../../util/dardcor/base/common/themables';
import { getRequestId, RequestId } from '../../networking/common/fetch';
import { FetchOptions, IFetcherService, IHeaders, Response } from '../../networking/common/fetcherService';
import { IRequestLogger, LoggedRequestKind } from '../../requestLogger/common/requestLogger';
import { Completion } from '../common/completionsAPI';
import { Completions, ICompletionsFetchService } from '../common/completionsFetchService';
import { ResponseStream } from '../common/responseStream';
import { jsonlStreamToCompletions } from './streamTransformer';
import { getDardcorRouterApiKey, getDardcorRouterBaseUrl } from '../../endpoint/node/dardcorRouter';

export type FetchResponse = {
	status: number;
	statusText: string;
	headers: IHeaders;
	body: AsyncIterable<string>;
	requestId: RequestId;
	response: Response;
};

export interface IFetchRequestParams extends Completions.ModelParams { }

export class CompletionsFetchService implements ICompletionsFetchService {
	readonly _serviceBrand: undefined;

	constructor(
		@IFetcherService private fetcherService: IFetcherService,
		@IRequestLogger private readonly requestLogger: IRequestLogger,
	) {
	}

	public disconnectAll(): Promise<unknown> {
		return this.fetcherService.disconnectAll();
	}

	public async fetch(
		url: string,
		secretKey: string,
		params: IFetchRequestParams,
		requestId: string,
		ct: CancellationToken,
		headerOverrides?: Record<string, string>,
	): Promise<Result<ResponseStream, Completions.CompletionsFetchFailure>> {
		const startTimeMs = Date.now();
		const isRouterChatRequest = this._isDardcorRouterChatEndpoint(url);

		if (ct.isCancellationRequested) {
			const result = Result.error(new Completions.RequestCancelled());
			this._logCompletionsRequest(url, params, requestId, startTimeMs, result);
			return result;
		}

		const options = {
			requestId,
			headers: this.getHeaders(requestId, isRouterChatRequest ? getDardcorRouterApiKey() : secretKey, headerOverrides, isRouterChatRequest),
			body: JSON.stringify(isRouterChatRequest ? toRouterChatCompletionRequest(params) : { ...params, stream: true })
		};

		const fetchResponse = await this._fetchFromUrl(url, options, ct);

		if (fetchResponse.isError()) {
			this._logCompletionsRequest(url, params, requestId, startTimeMs, fetchResponse);
			return fetchResponse;
		}

		if (fetchResponse.val.status === 200) {

			const lines = AsyncIterUtilsExt.splitLines(fetchResponse.val.body);
			const completionsStream = isRouterChatRequest
				? routerChatSseToCompletions(lines)
				: jsonlStreamToCompletions(lines);

			const response = new ResponseStream(fetchResponse.val.response, completionsStream, fetchResponse.val.requestId, fetchResponse.val.headers);

			const result = Result.ok(response);
			this._logCompletionsRequest(url, params, requestId, startTimeMs, result);
			return result;

		} else {
			const error: Completions.CompletionsFetchFailure = new Completions.UnsuccessfulResponse(
				fetchResponse.val.status,
				fetchResponse.val.statusText,
				fetchResponse.val.headers,
				() => collectAsyncIterableToString(fetchResponse.val.body).catch(() => ''),
			);

			const result = Result.error(error);
			this._logCompletionsRequest(url, params, requestId, startTimeMs, result);
			return result;
		}
	}

	protected async _fetchFromUrl(url: string, options: Completions.Internal.FetchOptions, ct: CancellationToken): Promise<Result<FetchResponse, Completions.CompletionsFetchFailure>> {

		const fetchAbortCtl = this.fetcherService.makeAbortController();

		const onCancellationDisposable = ct.onCancellationRequested(() => {
			fetchAbortCtl.abort();
		});

		try {

			const request: FetchOptions = {
				headers: options.headers,
				body: options.body,
				signal: fetchAbortCtl.signal,
				method: 'POST',
				callSite: 'nes-completions',
			};

			const response = await this.fetcherService.fetch(url, request);

			if (response.status !== 200) {
				return Result.error(new Completions.UnsuccessfulResponse(response.status, response.statusText, response.headers, () => response.text().catch(() => '')));
			}

			const body = response.body.pipeThrough(new TextDecoderStream());

			const responseStream = streamWithCleanup(body, onCancellationDisposable);

			return Result.ok({
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
				body: responseStream,
				requestId: getRequestId(response.headers),
				response,
			});

		} catch (reason: unknown) {

			onCancellationDisposable.dispose();

			if (reason instanceof Error && reason.message === 'This operation was aborted') {
				return Result.error(new Completions.RequestCancelled());
			}

			const error = ErrorUtils.fromUnknown(reason);
			return Result.error(new Completions.Unexpected(error));
		}
	}

	private _logCompletionsRequest(
		url: string,
		params: IFetchRequestParams,
		requestId: string,
		startTimeMs: number,
		result: Result<ResponseStream, Completions.CompletionsFetchFailure>,
	): void {
		if (result.isOk()) {
			const responseStream = result.val;
			void responseStream.response.then(aggregated => {
				const aggregationStatus = aggregated.isOk() ? 'success' : 'failed';
				this._emitCompletionsLogEntry(url, params, requestId, startTimeMs, aggregationStatus, aggregated);
			});
		} else {
			const err = result.err;
			if (err instanceof Completions.RequestCancelled) {
				this._emitCompletionsLogEntry(url, params, requestId, startTimeMs, 'cancelled', undefined);
			} else if (err instanceof Completions.UnsuccessfulResponse) {
				this._emitCompletionsLogEntry(url, params, requestId, startTimeMs, 'failed', undefined, `${err.status} ${err.statusText}`);
			} else if (err instanceof Completions.Unexpected) {
				this._emitCompletionsLogEntry(url, params, requestId, startTimeMs, 'failed', undefined, err.error.message);
			}
		}
	}

	private _emitCompletionsLogEntry(
		url: string,
		params: IFetchRequestParams,
		requestId: string,
		startTimeMs: number,
		status: 'success' | 'cancelled' | 'failed',
		aggregatedResponse: Result<Completion, Error> | undefined,
		errorReason?: string,
	): void {
		const durationMs = Date.now() - startTimeMs;
		const lines: string[] = [];

		lines.push(`> 🚨 Note: This log may contain personal information such as the contents of your files. Please review the contents carefully before sharing.`);
		lines.push(`# completions`);
		lines.push(``);

		lines.push(`- [Metadata](#metadata)`);
		lines.push(`- [Prompt](#prompt)`);
		if (params.suffix) {
			lines.push(`- [Suffix](#suffix)`);
		}
		lines.push(`- [Response](#response)`);
		lines.push(``);

		lines.push(`## Metadata`);
		lines.push(`<pre><code>`);
		lines.push(`url              : ${url}`);
		lines.push(`requestId        : ${requestId}`);
		lines.push(`model            : ${params.model ?? '(default)'}`);
		lines.push(`maxTokens        : ${params.max_tokens}`);
		lines.push(`temperature      : ${params.temperature}`);
		lines.push(`top_p            : ${params.top_p}`);
		lines.push(`n                : ${params.n}`);
		lines.push(`duration         : ${durationMs}ms`);
		lines.push(`</code></pre>`);

		lines.push(``);
		lines.push(`## Prompt`);
		lines.push(`~~~`);
		lines.push(params.prompt);
		lines.push(`~~~`);

		if (params.suffix) {
			lines.push(``);
			lines.push(`## Suffix`);
			lines.push(`~~~`);
			lines.push(params.suffix);
			lines.push(`~~~`);
		}

		lines.push(``);
		lines.push(`## Response`);
		if (status === 'cancelled') {
			lines.push(`## CANCELED`);
		} else if (status === 'failed') {
			lines.push(`## FAILED: ${errorReason}`);
		} else if (aggregatedResponse) {
			if (aggregatedResponse.isOk()) {
				const completion = aggregatedResponse.val;
				const text = completion.choices[0]?.text ?? '';
				const finishReason = completion.choices[0]?.finish_reason ?? 'unknown';
				lines.push(`~~~`);
				lines.push(text || '<EMPTY RESPONSE>');
				lines.push(`~~~`);
				lines.push(``);
				lines.push(`<pre><code>`);
				lines.push(`finishReason     : ${finishReason}`);
				if (completion.usage) {
					lines.push(`promptTokens     : ${completion.usage.prompt_tokens}`);
					lines.push(`completionTokens : ${completion.usage.completion_tokens}`);
					lines.push(`totalTokens      : ${completion.usage.total_tokens}`);
				}
				lines.push(`</code></pre>`);
			} else {
				lines.push(`## FAILED: stream error - ${aggregatedResponse.err.message}`);
			}
		}

		const icon: ThemeIcon | undefined = status === 'success' ? undefined : Codicon.error;

		this.requestLogger.addEntry({
			type: LoggedRequestKind.MarkdownContentRequest,
			debugName: 'Completions Request',
			startTimeMs,
			icon,
			markdownContent: lines.join('\n'),
		});
	}

	private getHeaders(
		requestId: string,
		secretKey: string,
		headerOverrides: Record<string, string> = {},
		isRouterChatRequest = false,
	): Record<string, string> {
		if (isRouterChatRequest) {
			return {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${secretKey}`,
				'X-Request-Id': requestId,
				...headerOverrides,
			};
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Authorization: 'Bearer ' + secretKey,
			'X-Request-Id': requestId,
			...headerOverrides,
		};

		return headers;
	}

	private _isDardcorRouterChatEndpoint(url: string): boolean {
		try {
			const normalizedUrl = new URL(url).toString().replace(/\/$/, '');
			return normalizedUrl === `${getDardcorRouterBaseUrl()}/v1/chat/completions`;
		} catch {
			return false;
		}
	}
}

function toRouterChatCompletionRequest(params: IFetchRequestParams): Record<string, unknown> {
	const context = params.extra?.context;
	const contextText = Array.isArray(context)
		? context.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n\n')
		: typeof context === 'string' ? context : '';
	const prefix = typeof params.prompt === 'string' ? params.prompt : '';
	const suffix = typeof params.suffix === 'string' ? params.suffix : '';
	const systemContent = [
		'You provide inline code completions for Dardcor Code.',
		'Return only the code to insert at the cursor. Do not explain your answer, repeat code already present before or after the cursor, or wrap the result in markdown fences.',
		contextText ? `Relevant project context:\n${contextText}` : undefined,
	].filter(Boolean).join('\n\n');

	return {
		model: params.model,
		messages: [
			{ role: 'system', content: systemContent },
			{ role: 'user', content: `Code before cursor:\n${prefix}\n\nCode after cursor:\n${suffix}\n\nReturn only the missing code between these two sections.` },
		],
		max_tokens: params.max_tokens,
		temperature: params.temperature,
		top_p: params.top_p,
		stop: params.stop,
		n: params.n,
		presence_penalty: params.presence_penalty,
		frequency_penalty: params.frequency_penalty,
		stream: true,
	};
}

async function* routerChatSseToCompletions(lines: AsyncIterable<string>): AsyncGenerator<Completion> {
	for await (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) {
			continue;
		}
		const payload = trimmed.slice('data:'.length).trim();
		if (!payload || payload === '[DONE]') {
			continue;
		}

		const chunk = JSON.parse(payload) as {
			error?: { message?: string } | string;
			system_fingerprint?: string;
			choices?: Array<{
				index?: number;
				delta?: { content?: string | Array<{ text?: string }> };
				finish_reason?: string | null;
			}>;
		};
		if (chunk.error) {
			throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message ?? 'Dardcor Router returned a chat completion error.');
		}

		const choices = (chunk.choices ?? []).map(choice => {
			const content = choice.delta?.content;
			const text = typeof content === 'string'
				? content
				: Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
			const finishReason: Completion.FinishReason | null = choice.finish_reason === 'length'
				? Completion.FinishReason.Length
				: choice.finish_reason === 'content_filter'
					? Completion.FinishReason.ContentFilter
					: choice.finish_reason ? Completion.FinishReason.Stop : null;
			return { index: choice.index ?? 0, text, finish_reason: finishReason };
		});
		if (choices.length) {
			yield {
				choices,
				system_fingerprint: chunk.system_fingerprint ?? '',
				object: 'text_completion',
				usage: undefined,
			};
		}
	}
}

async function* streamWithCleanup(
	stream: AsyncIterable<string>,
	cleanupDisposable: IDisposable
): AsyncGenerator<string> {
	try {
		for await (const str of stream) {
			yield str;
		}
	} catch (err: unknown) {
		const error = ErrorUtils.fromUnknown(err);
		throw error;
	} finally {
		cleanupDisposable.dispose();
	}
}

async function collectAsyncIterableToString(iterable: AsyncIterable<string>): Promise<string> {
	const parts: string[] = [];
	for await (const part of iterable) {
		parts.push(part);
	}
	return parts.join('');
}
