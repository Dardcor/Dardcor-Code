/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DardcorAnnotations, StreamDardcorAnnotations } from '../../../../../../platform/completions-core/common/openai/dardcorAnnotations';
import { Completion } from '../../../../../../platform/nesFetch/common/completionsAPI';
import { Completions, ICompletionsFetchService } from '../../../../../../platform/nesFetch/common/completionsFetchService';
import { ResponseStream } from '../../../../../../platform/nesFetch/common/responseStream';
import { RequestId, getRequestId } from '../../../../../../platform/networking/common/fetch';
import { IHeaders } from '../../../../../../platform/networking/common/fetcherService';
import { createServiceIdentifier } from '../../../../../../util/common/services';
import { assertNever } from '../../../../../../util/dardcor/base/common/assert';
import { CancellationToken } from '../../../../../../util/dardcor/base/common/cancellation';
import { StopWatch } from '../../../../../../util/dardcor/base/common/stopwatch';
import { generateUuid } from '../../../../../../util/dardcor/base/common/uuid';
import { IInstantiationService } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { CancellationToken as ICancellationToken } from '../../../types/src';
import { asyncIterableFilter } from '../helpers/iterableHelpers';
import { ICompletionsLogTargetService, Logger } from '../logger';
import { isAbortError, isInterruptedNetworkError } from '../networking';
import { ICompletionsStatusReporter } from '../progress';
import { Prompt } from '../prompt/prompt';
import { MaybeRepoInfo } from '../prompt/repository';
import {
	TelemetryData,
	TelemetryWithExp,
	logEnginePrompt,
	telemetrizePromptLength,
	telemetry,
} from '../telemetry';
import { delay } from '../util/async';
import { ICompletionsRuntimeModeService } from '../util/runtimeMode';
import { getKey } from '../util/unknown';
import { getDardcorRouterApiKey, getDardcorRouterBaseUrl } from '../../../../../../platform/endpoint/node/dardcorRouter';
import {
	APIChoice,
	APIJsonData,
	getMaxSolutionTokens,
	getStops,
	getTemperatureForSamples,
	getTopP,
} from './openai';

const logger = new Logger('fetchCompletions');

export enum DardcorInlineUiKind {
	GhostText = 'ghostText',
	Panel = 'panel',
}

type BaseFetchRequest = {
	prompt: string;
};

type CompletionFetchRequestFields = {
	model: string;
	suffix: string;
	stream: true;
	max_tokens: number;
	n: number;
	temperature: number;
	top_p: number;
	stop: string[];
	logprobs?: number;
	logit_bias?: { [key: string]: number };

};

export type CompletionRequest = BaseFetchRequest &
	CompletionFetchRequestFields & {
		extra: Partial<CompletionRequestExtra>;
	};

export declare interface CompletionRequestExtra {
	language: string;
	trim_by_indentation?: boolean;
	force_indent?: number;
	next_indent?: number;
	test_completions?: string[];
	prompt_tokens: number;
	suffix_tokens: number;
	context?: string[];
}

export type PostOptions = Partial<CompletionFetchRequestFields>;


function getProcessingTime(responseHeaders: IHeaders): number {
	const reqIdStr = responseHeaders.get('openai-processing-ms');
	if (reqIdStr) {
		return parseInt(reqIdStr, 10);
	}
	return 0;
}


export interface RequestDelta {
	text: string;
	index?: number;
	requestId?: RequestId;
	annotations?: DardcorAnnotations;
	getAPIJsonData?: () => APIJsonData;
	finished?: boolean;
	telemetryData?: TelemetryWithExp;
}

export interface SolutionDecision {
	yieldSolution: boolean;
	continueStreaming: boolean;
	finishOffset?: number;
}

type FinishedCallbackResult =
	| Promise<SolutionDecision | number | undefined>
	| SolutionDecision
	| number
	| undefined;

export interface FinishedCallback {
	(text: string, delta: RequestDelta): FinishedCallbackResult;
}

interface InternalFetchParams {
	prompt: Prompt;
	engineModelId: string;
	uiKind: DardcorInlineUiKind;
	ourRequestId: string;
	headers?: CompletionHeaders;
}

export interface CompletionParams extends InternalFetchParams {
	repoInfo: MaybeRepoInfo;
	languageId: string;
	count: number;
	requestLogProbs?: boolean;
	postOptions?: PostOptions;
	extra: Partial<CompletionRequestExtra>;
}

export interface SpeculationFetchParams extends InternalFetchParams {
	speculation: string;
	stops: string[] | null;
}

export const ICompletionsOpenAIFetcherService = createServiceIdentifier<ICompletionsOpenAIFetcherService>('ICompletionsOpenAIFetcherService');
export interface ICompletionsOpenAIFetcherService {
	readonly _serviceBrand: undefined;
	fetchAndStreamCompletions(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancellationToken?: ICancellationToken
	): Promise<CompletionResults | CompletionError>;
}

export abstract class OpenAIFetcher implements ICompletionsOpenAIFetcherService {
	declare _serviceBrand: undefined;
	abstract fetchAndStreamCompletions(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancellationToken?: ICancellationToken
	): Promise<CompletionResults | CompletionError>;
}

export interface CompletionResults {
	type: 'success';
	choices: AsyncIterable<APIChoice>;
	getProcessingTime(): number;
}

export type CompletionError = { type: 'failed'; reason: string } | { type: 'canceled'; reason: string };

export type CompletionHeaders = {
	Host?: string;
	Connection?: string;
};

export function sanitizeRequestOptionTelemetry(
	request: Partial<CompletionRequest>,
	telemetryData: TelemetryWithExp,
	topLevelKeys: string[],
	extraKeys?: (keyof CompletionRequestExtra)[]
): void {
	for (const [key, value] of Object.entries(request)) {
		if (topLevelKeys.includes(key)) {
			continue;
		}

		let valueToLog = value as unknown;

		if (key === 'extra' && extraKeys) {
			const extra = { ...(valueToLog as CompletionRequestExtra) };
			for (const extraKey of extraKeys) {
				delete extra[extraKey];
			}
			valueToLog = extra;
		}

		telemetryData.properties[`request.option.${key}`] = JSON.stringify(valueToLog) ?? 'undefined';
	}
}

export function postProcessChoices(choices: AsyncIterable<APIChoice>) {
	return asyncIterableFilter(choices, choice => choice.completionText.trim().length > 0);
}

export class LiveOpenAIFetcher extends OpenAIFetcher {
	#disabledReason: string | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICompletionsRuntimeModeService private readonly runtimeModeService: ICompletionsRuntimeModeService,
		@ICompletionsLogTargetService private readonly logTargetService: ICompletionsLogTargetService,
		@ICompletionsStatusReporter private readonly statusReporter: ICompletionsStatusReporter,
		@ICompletionsFetchService private readonly fetchService: ICompletionsFetchService,
	) {
		super();
	}

	async fetchAndStreamCompletions(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancel?: ICancellationToken
	): Promise<CompletionResults | CompletionError> {
		if (this.#disabledReason) {
			return { type: 'canceled', reason: this.#disabledReason };
		}
		const endpoint = 'chat/completions';
		const modelId = params.engineModelId;
		if (!modelId) {
			return { type: 'failed', reason: 'Dardcor Router returned no completion-capable models.' };
		}

		const request: CompletionRequest = {
			prompt: params.prompt.prefix,
			suffix: params.prompt.suffix,
			max_tokens: getMaxSolutionTokens(),
			temperature: getTemperatureForSamples(this.runtimeModeService, params.count),
			top_p: getTopP(),
			n: params.count,
			stop: getStops(params.languageId),
			stream: true,
			model: modelId,
			extra: params.extra,
		} satisfies CompletionRequest;

		{

			if (params.requestLogProbs) {
				request.logprobs = 2;
			}

			if (params.postOptions) {
				Object.assign(request, params.postOptions);
			}

			if (params.prompt.context && params.prompt.context.length > 0) {
				request.extra.context = params.prompt.context;
			}

			await delay(0);
			if (cancel?.isCancellationRequested) {
				return { type: 'canceled', reason: 'before fetch request' };
			}
		}

		{
			const prompt = params.prompt;
			const engineModelId = params.engineModelId;
			const ourRequestId = params.ourRequestId;
			const telemetryExp = baseTelemetryData;
			const uiKind = params.uiKind;
			const headers = params.headers;
			const uri = `${getDardcorRouterBaseUrl()}/v1/chat/completions`;

			const telemetryData = telemetryExp.extendedBy(
				{
					endpoint: endpoint,
					engineName: engineModelId,
					uiKind: uiKind,
				},
				telemetrizePromptLength(prompt)
			);

			sanitizeRequestOptionTelemetry(request, telemetryData, ['prompt', 'suffix'], ['context']);

			telemetryData.properties['headerRequestId'] = ourRequestId;

			this.instantiationService.invokeFunction(telemetry, 'request.sent', telemetryData);

			const fullHeaders: Record<string, string> = {
				...headers,
				'X-Request-Id': ourRequestId,
			};

			const requestSw = new StopWatch();
			const cancelToken = cancel ?? CancellationToken.None;
			const res = await this.fetchService.fetch(
				uri,
				getDardcorRouterApiKey(),
				request,
				ourRequestId,
				cancelToken,
				fullHeaders,
			).then(response => {
				if (response.isError() && response.err instanceof Completions.Unexpected && isInterruptedNetworkError(response.err.error)) {
					this.instantiationService.invokeFunction(telemetry, 'networking.disconnectAll');
					return this.fetchService.disconnectAll().then(() => {
						return this.fetchService.fetch(
							uri,
							getDardcorRouterApiKey(),
							request,
							ourRequestId,
							cancelToken,
							fullHeaders,
						);
					});
				} else {
					return response;
				}
			});

			try {

				if (res.isError()) {

					const err = res.err;

					if (err instanceof Completions.RequestCancelled) {
						this.instantiationService.invokeFunction(telemetry,
							'networking.cancelRequest',
							TelemetryData.createAndMarkAsIssued({ headerRequestId: ourRequestId })
						);
						this.instantiationService.invokeFunction(telemetry, 'request.cancel', telemetryData);
						return { type: 'canceled', reason: 'during fetch request' };
					} else if (err instanceof Completions.UnsuccessfulResponse) {
						const modelRequestId = getRequestId(err.headers);
						telemetryData.extendWithRequestId(modelRequestId);
						const totalTimeMs = requestSw.elapsed();
						telemetryData.measurements.totalTimeMs = totalTimeMs;
						telemetryData.properties.status = String(err.status);
						logger.info(
							this.logTargetService,
							`Request ${ourRequestId} at <${uri}> finished with ${err.status} status after ${totalTimeMs}ms`
						);
						logger.debug(this.logTargetService, 'request.response properties', telemetryData.properties);
						logger.debug(this.logTargetService, 'request.response measurements', telemetryData.measurements);
						logger.debug(this.logTargetService, 'prompt:', prompt);
						this.instantiationService.invokeFunction(telemetry, 'request.response', telemetryData);

						return this.handleError(this.statusReporter, telemetryData, {
							status: err.status,
							text: err.text,
							headers: err.headers,
						});
					} else if (err instanceof Completions.Unexpected) {

						const error = err.error;

						if (isAbortError(error)) {
							this.instantiationService.invokeFunction(telemetry, 'request.cancel', telemetryData);
							throw error;
						}
						this.statusReporter.setWarning(getKey(error, 'message') ?? '');
						const warningTelemetry = telemetryData.extendedBy({ error: 'Network exception' });
						this.instantiationService.invokeFunction(telemetry, 'request.shownWarning', warningTelemetry);

						telemetryData.properties.message = String(getKey(error, 'name') ?? '');
						telemetryData.properties.code = String(getKey(error, 'code') ?? '');
						telemetryData.properties.errno = String(getKey(error, 'errno') ?? '');
						telemetryData.properties.type = String(getKey(error, 'type') ?? '');

						const totalTimeMs = requestSw.elapsed();
						telemetryData.measurements.totalTimeMs = totalTimeMs;

						logger.info(
							this.logTargetService,
							`Request ${ourRequestId} at <${uri}> rejected with ${String(error)} after ${totalTimeMs}ms`
						);
						logger.debug(this.logTargetService, 'request.error properties', telemetryData.properties);
						logger.debug(this.logTargetService, 'request.error measurements', telemetryData.measurements);

						this.instantiationService.invokeFunction(telemetry, 'request.error', telemetryData);

						throw error;
					} else {
						assertNever(err);
					}
				}

				const responseStream = res.val;

				{
					const modelRequestId = responseStream.requestId;
					telemetryData.extendWithRequestId(modelRequestId);

					const totalTimeMs = requestSw.elapsed();
					telemetryData.measurements.totalTimeMs = totalTimeMs;

					const responseStatus = 200;
					logger.info(
						this.logTargetService,
						`Request ${ourRequestId} at <${uri}> finished with ${responseStatus} status after ${totalTimeMs}ms`
					);
					telemetryData.properties.status = String(responseStatus);
					logger.debug(this.logTargetService, 'request.response properties', telemetryData.properties);
					logger.debug(this.logTargetService, 'request.response measurements', telemetryData.measurements);

					logger.debug(this.logTargetService, 'prompt:', prompt);

					this.instantiationService.invokeFunction(telemetry, 'request.response', telemetryData);

				}

				if (cancel?.isCancellationRequested) {
					try {
						await responseStream.destroy();
					} catch (e) {
						this.instantiationService.invokeFunction(acc => logger.exception(acc, e, `Error destroying stream`));
					}
					return { type: 'canceled', reason: 'after fetch request' };
				}

				const choices = LiveOpenAIFetcher.convertStreamToApiChoices(responseStream, finishedCb, baseTelemetryData, cancel);

				return {
					type: 'success',
					choices: postProcessChoices(choices),
					getProcessingTime: () => getProcessingTime(responseStream.headers),
				};

			} finally {
				this.instantiationService.invokeFunction(logEnginePrompt, prompt, telemetryData);
			}
		}
	}

	public static async *convertStreamToApiChoices(resp: ResponseStream, finishedCb: FinishedCallback, baseTelemetryData: TelemetryWithExp, cancel?: CancellationToken): AsyncIterable<APIChoice> {

		const createAPIChoice = (
			choiceIndex: number,
			completionText: string,
			finishReason: string,
			accumulator: CompletionAccumulator,
			blockFinished: boolean
		): APIChoice => ({
			choiceIndex,
			completionText,
			requestId: resp.requestId,
			finishReason,
			tokens: accumulator.chunks,
			numTokens: accumulator.chunks.length,
			blockFinished,
			telemetryData: baseTelemetryData,
			clientCompletionId: generateUuid(),
			meanLogProb: undefined,
			meanAlternativeLogProb: undefined,
			dardcorAnnotations: accumulator.annotations.current,
		});

		const completions: { accumulator: CompletionAccumulator; isFinished: boolean; yielded: boolean }[] = [];

		try {
			for await (const chunk of resp.stream) {
				if (cancel?.isCancellationRequested) {
					return;
				}

				for (let i = 0; i < chunk.choices.length; i++) {
					const chunkIdx = chunk.choices[i].index;
					let completion = completions[chunkIdx];
					if (completion === undefined) {
						completion = { accumulator: new CompletionAccumulator(), isFinished: false, yielded: false };
						completions[chunkIdx] = completion;
					} else if (completion.isFinished) {
						continue;
					}
					const choice = chunk.choices[i];
					completion.accumulator.append(choice);

					const hasFinishReason = !!(chunk.choices[i].finish_reason);

					const chunkText = choice.text ?? '';
					const hasNewLine = chunkText.indexOf('\n') > -1;

					let solutionDecision: SolutionDecision | number | undefined;
					if (hasFinishReason || hasNewLine) {
						solutionDecision = await finishedCb(completion.accumulator.responseSoFar, {
							index: chunkIdx,
							text: completion.accumulator.responseSoFar,
							finished: hasFinishReason,
							requestId: resp.requestId,
							telemetryData: baseTelemetryData,
							annotations: completion.accumulator.annotations,
							getAPIJsonData: () => ({
								text: completion.accumulator.responseSoFar,
								tokens: completion.accumulator.chunks,
								finish_reason: completion.accumulator.finishReason ?? 'stop',
								dardcor_annotations: completion.accumulator.annotations.current,
							} satisfies APIJsonData),
						} satisfies RequestDelta);

						if (cancel?.isCancellationRequested) {
							return;
						}
					}

					if (hasFinishReason) {
						if (solutionDecision === undefined || typeof solutionDecision !== 'object') {
							solutionDecision = { yieldSolution: true, continueStreaming: false };
						} else {
							solutionDecision.yieldSolution = true;
							solutionDecision.continueStreaming = false;
						}
					}

					if (solutionDecision !== undefined &&
						(typeof solutionDecision === 'number' || solutionDecision.yieldSolution)
					) {
						const isFinished = hasFinishReason || typeof solutionDecision === 'number' || (solutionDecision !== undefined && !solutionDecision.continueStreaming);
						completion.isFinished = isFinished;

						const finishReason = chunk.choices[i].finish_reason;
						if (finishReason) {
							completion.accumulator.finishReason = finishReason;
						}

						const finishOffset = typeof solutionDecision === 'number'
							? solutionDecision
							: (solutionDecision && solutionDecision.finishOffset !== undefined
								? solutionDecision.finishOffset
								: undefined);
						const completionText = finishOffset === undefined
							? completion.accumulator.responseSoFar
							: completion.accumulator.responseSoFar.slice(0, finishOffset);

						if (!completion.yielded) {
							completion.yielded = true;
							const apiChoice = createAPIChoice(
								chunkIdx,
								completionText,
								completion.accumulator.finishReason ?? 'stop',
								completion.accumulator,
								finishOffset !== undefined,
							);
							yield apiChoice;
						}

						if (cancel?.isCancellationRequested) {
							return;
						}
					}
				}
			}

			for (const [chunkIdx, completion] of completions.entries()) {
				if (!completion.isFinished) {
					await finishedCb(completion.accumulator.responseSoFar, {
						index: chunkIdx,
						text: completion.accumulator.responseSoFar,
						finished: true,
						requestId: resp.requestId,
						telemetryData: baseTelemetryData,
						annotations: completion.accumulator.annotations,
						getAPIJsonData: () => ({
							text: completion.accumulator.responseSoFar,
							tokens: completion.accumulator.chunks,
							finish_reason: completion.accumulator.finishReason ?? 'stop',
							dardcor_annotations: completion.accumulator.annotations.current,
						} satisfies APIJsonData),
					} satisfies RequestDelta);

					if (cancel?.isCancellationRequested) {
						return;
					}

					if (completion.yielded) {
						continue;
					}
					completion.yielded = true;

					const apiChoice = createAPIChoice(
						chunkIdx,
						completion.accumulator.responseSoFar,
						completion.accumulator.finishReason ?? 'stop',
						completion.accumulator,
						false
					);
					yield apiChoice;

					if (cancel?.isCancellationRequested) {
						return;
					}
				}
			}
		} finally {
			try {
				await resp.destroy();
			} catch {
			}
		}
	}

	async handleError(
		statusReporter: ICompletionsStatusReporter,
		telemetryData: TelemetryData,
		response: { status: number; text(): Promise<string>; headers: IHeaders },
	): Promise<CompletionError> {
		const text = await response.text();
		if (response.status === 402) {
			const message = text || 'Dardcor Router rejected the inline-completion request (HTTP 402).';
			statusReporter.setWarning(message);
			logger.warn(this.logTargetService, message);
			return { type: 'failed', reason: message };
		}
		if (isClientError(response)) {
			const message = `Dardcor Router returned an HTTP ${response.status} error${text ? `: ${text}` : '.'}`;
			logger.error(this.logTargetService, message);
			statusReporter.setWarning(message);
			telemetryData.properties.error = message;
		} else {
			statusReporter.setWarning(`Last response was a ${response.status} error`);
			telemetryData.properties.error = `Response status was ${response.status}`;
		}
		telemetryData.properties.status = String(response.status);
		this.instantiationService.invokeFunction(telemetry, 'request.shownWarning', telemetryData);
		if (response.status === 401 || response.status === 403) {
			return { type: 'failed', reason: `Dardcor Router rejected the configured API key (HTTP ${response.status}).` };
		}
		if (response.status === 429) {
			const rateLimitSeconds = 10;
			setTimeout(() => {
				this.#disabledReason = undefined;
			}, rateLimitSeconds * 1000);
			this.#disabledReason = 'rate limited';
			logger.warn(this.logTargetService, `Rate limited by server. Denying completions for the next ${rateLimitSeconds} seconds.`);
			return { type: 'failed', reason: this.#disabledReason };
		}
		if (response.status === 499) {
			logger.info(this.logTargetService, 'Cancelled by server');
			return { type: 'failed', reason: 'canceled by server' };
		}
		logger.error(this.logTargetService, 'Unhandled status from server:', response.status, text);
		return { type: 'failed', reason: `unhandled status from server: ${response.status} ${text}` };
	}
}

function isClientError(response: { status: number }): boolean {
	return response.status >= 400 && response.status < 500;
}

class CompletionAccumulator {

	private _chunks: string[] = [];
	private _responseSoFar: string = '';

	private _finishReason: string | null = null;

	public readonly annotations: DardcorAnnotations = new StreamDardcorAnnotations();

	public get responseSoFar(): string {
		return this._responseSoFar;
	}

	public get chunks(): readonly string[] {
		return this._chunks;
	}

	public set finishReason(value: string) {
		this._finishReason = value;
	}
	public get finishReason(): string | null {
		return this._finishReason;
	}

	public append(choice: Completion.Choice): void {
		const chunk = choice.text;
		if (chunk) {
			this._chunks.push(chunk);
			this._responseSoFar = this._responseSoFar + chunk;
		}

		if (choice.dardcor_annotations) {
			this.annotations.update(choice.dardcor_annotations);
		}
	}
}
