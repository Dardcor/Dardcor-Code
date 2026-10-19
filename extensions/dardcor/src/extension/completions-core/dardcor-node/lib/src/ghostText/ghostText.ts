/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { DardcorNamedAnnotationList } from '../../../../../../platform/completions-core/common/openai/dardcorAnnotations';
import { ILogService, ILogger } from '../../../../../../platform/log/common/logService';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry';
import { createSha256Hash } from '../../../../../../util/common/crypto';
import { generateUuid } from '../../../../../../util/dardcor/base/common/uuid';
import { IInstantiationService, ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { LlmNESTelemetryBuilder } from '../../../../../inlineEdits/node/nextEditProviderTelemetry';
import { isInlineSuggestionFromTextAfterCursor } from '../../../../../xtab/common/inlineSuggestion';
import { GhostTextLogContext } from '../../../../common/ghostTextContext';
import { ensureTokenizersLoaded } from '../../../prompt/src/tokenization';
import { CancellationTokenSource, CancellationToken as ICancellationToken } from '../../../types/src';
import { ICompletionsNotifierService } from '../completionNotifier';
import { CompletionState } from '../completionState';
import { BlockMode, ConfigKey, getConfig } from '../config';
import { ICompletionsFeaturesService } from '../experiments/featuresService';
import { ICompletionsLogTargetService } from '../logger';
import { isAbortError } from '../networking';
import { EngineRequestInfo, getEngineRequestInfo } from '../openai/config';
import {
	FinishedCallback
} from '../openai/fetch';
import { APIChoice } from '../openai/openai';
import { ICompletionsStatusReporter } from '../progress';
import { ICompletionsContextProviderBridgeService } from '../prompt/components/contextProviderBridge';
import { ICompletionsContextProviderService } from '../prompt/contextProviderStatistics';
import {
	contextIndentation,
} from '../prompt/parseBlock';
import { ExtractPromptOptions, Prompt, PromptResponse, PromptResponsePresent, extractPrompt, trimLastLine } from '../prompt/prompt';
import { ComputationStatus, extractRepoInfoInBackground } from '../prompt/repository';
import { checkSuffix, postProcessChoiceInContext } from '../suggestions/suggestions';
import {
	TelemetryData,
	TelemetryMeasurements,
	TelemetryProperties,
	TelemetryWithExp,
	now,
	telemetrizePromptLength,
	telemetry,
} from '../telemetry';
import { IPosition, LocationFactory, TextDocumentContents } from '../textDocument';
import { delay } from '../util/async';
import { ICompletionsAsyncManagerService } from './asyncCompletions';
import { BlockTrimmer } from './blockTrimmer';
import { ICompletionsCacheService } from './completionsCache';
import { CompletionsFromNetwork, makeGhostAPIChoice } from './completionsFromNetwork';
import { ICompletionsCurrentGhostText } from './current';
import { getGhostTextStrategy } from './ghostTextStrategy';
import { RequestContext } from './requestContext';
import { ResultType } from './resultType';
import {
	GhostTextResultWithTelemetry,
	mkBasicResultTelemetry,
	mkCanceledResultTelemetry,
	resultTypeToString,
} from './telemetry';

export interface GhostCompletion {
	completionIndex: number;
	completionText: string;
	displayText: string;
	displayNeedsWsOffset: boolean;
}

export interface CompletionResult {
	completion: GhostCompletion;
	telemetry: TelemetryWithExp;
	isMiddleOfTheLine: boolean;
	suffixCoverage: number;
	dardcorAnnotations?: DardcorNamedAnnotationList;
	clientCompletionId: string;
}

export type GetGhostTextOptions = ExtractPromptOptions & {
	isCycling: boolean;
	promptOnly: boolean;
	isSpeculative: boolean;
	opportunityId?: string;
	debounceMs?: number;
};

const defaultOptions: GetGhostTextOptions = {
	isCycling: false,
	promptOnly: false,
	isSpeculative: false,
};

function getRemainingDebounceMs(accessor: ServicesAccessor, opts: GetGhostTextOptions, telemetry: TelemetryWithExp): number {
	const featuresService = accessor.get(ICompletionsFeaturesService);
	const debounce =
		getConfig<number | undefined>(accessor, ConfigKey.CompletionsDebounce) ??
		featuresService.completionsDebounce(telemetry) ??
		opts.debounceMs;
	if (debounce === undefined) { return 0; }
	const elapsed = now() - telemetry.issuedTime;
	return Math.max(0, debounce - elapsed);
}

function isCompletionRequestCancelled(
	currentGhostText: ICompletionsCurrentGhostText,
	requestId: string,
	cancellationToken?: ICancellationToken
): boolean {
	return cancellationToken?.isCancellationRequested || requestId !== currentGhostText.currentRequestId;
}

export class GhostTextComputer {

	constructor(
		@IInstantiationService public readonly instantiationService: IInstantiationService,
		@ITelemetryService public readonly telemetryService: ITelemetryService,
		@ICompletionsNotifierService public readonly notifierService: ICompletionsNotifierService,
		@ICompletionsContextProviderBridgeService public readonly contextProviderBridge: ICompletionsContextProviderBridgeService,
		@ICompletionsCurrentGhostText public readonly currentGhostText: ICompletionsCurrentGhostText,
		@ICompletionsContextProviderService public readonly contextproviderStatistics: ICompletionsContextProviderService,
		@ICompletionsAsyncManagerService public readonly asyncCompletionManager: ICompletionsAsyncManagerService,
		@ICompletionsFeaturesService public readonly completionsFeaturesService: ICompletionsFeaturesService,
		@ICompletionsLogTargetService public readonly logTarget: ICompletionsLogTargetService,
		@ICompletionsStatusReporter public readonly statusReporter: ICompletionsStatusReporter,
		@ILogService public readonly logService: ILogService,
	) {
	}

	public async getGhostText(
		completionState: CompletionState,
		token: ICancellationToken | undefined,
		options: Partial<GetGhostTextOptions>,
		logContext: GhostTextLogContext,
		telemetryBuilder: LlmNESTelemetryBuilder,
		parentLogger: ILogger,
	): Promise<GhostTextResultWithTelemetry<[CompletionResult[], ResultType]>> {
		const id = generateUuid();
		telemetryBuilder.setHeaderRequestId(id);
		const logger = parentLogger.createSubLogger(['GhostTextComputer#getGhostText']);
		this.currentGhostText.currentRequestId = id;
		const telemetryData = await this.instantiationService.invokeFunction(createTelemetryWithExp, completionState.textDocument, id, options);
		await ensureTokenizersLoaded().catch(() => { });
		try {
			this.contextProviderBridge.schedule(
				completionState,
				id,
				options?.opportunityId ?? '',
				telemetryData,
				token,
				options
			);
			this.notifierService.notifyRequest(completionState, id, telemetryData, token, options);
			const result = await this.getGhostTextWithoutAbortHandling(completionState, id, telemetryData, token, options, logContext, telemetryBuilder, logger);
			const statistics = this.contextproviderStatistics.getStatisticsForCompletion(id);
			const opportunityId = options?.opportunityId ?? 'unknown';
			for (const [providerId, statistic] of statistics.getAllUsageStatistics()) {
				this.telemetryService.sendMSFTTelemetryEvent(
					'context-provider.completion-stats',
					{
						requestId: id,
						opportunityId,
						providerId,
						resolution: statistic.resolution,
						usage: statistic.usage,
						usageDetails: JSON.stringify(statistic.usageDetails),
					},
					{
					}
				);
			}
			return result;
		} catch (e) {
			if (isAbortError(e)) {
				return {
					type: 'canceled',
					reason: 'aborted at unknown location',
					telemetryData: mkCanceledResultTelemetry(telemetryData, {
						cancelledNetworkRequest: true,
					}),
				};
			}
			throw e;
		}
	}

	private async getGhostTextWithoutAbortHandling(
		completionState: CompletionState,
		ourRequestId: string,
		preIssuedTelemetryDataWithExp: TelemetryWithExp,
		cancellationToken: ICancellationToken | undefined,
		options: Partial<GetGhostTextOptions>,
		logContext: GhostTextLogContext,
		telemetryBuilder: LlmNESTelemetryBuilder,
		parentLogger: ILogger,
	): Promise<GhostTextResultWithTelemetry<[CompletionResult[], ResultType]>> {
		const logger = parentLogger.createSubLogger(['GhostTextComputer#getGhostTextWithoutAbortHandling']);
		let start = preIssuedTelemetryDataWithExp.issuedTime;
		const performanceMetrics: [string, number][] = [];
		function recordPerformance(name: string) {
			const next = now();
			performanceMetrics.push([name, next - start]);
			start = next;
		}
		recordPerformance('telemetry');
		if (isCompletionRequestCancelled(this.currentGhostText, ourRequestId, cancellationToken)) {
			return {
				type: 'abortedBeforeIssued',
				reason: 'cancelled before extractPrompt',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		const inlineSuggestion = isInlineSuggestion(completionState.textDocument, completionState.position);
		if (inlineSuggestion === undefined) {
			logger.debug('Completions do not trigger in the middle of the line');
			return {
				type: 'abortedBeforeIssued',
				reason: 'Invalid middle of the line',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		const engineInfo = this.instantiationService.invokeFunction(getEngineRequestInfo, preIssuedTelemetryDataWithExp);
		const ghostTextOptions = { ...defaultOptions, ...options, tokenizer: engineInfo.tokenizer };
		const prompt = await this.instantiationService.invokeFunction(extractPrompt,
			ourRequestId,
			completionState,
			preIssuedTelemetryDataWithExp,
			undefined,
			ghostTextOptions,
		);
		recordPerformance('prompt');

		logContext.setPrompt(PromptResponse.toString(prompt));

		if (prompt.type === 'dardcorContentExclusion') {
			logger.debug('Dardcor not available, due to content exclusion');
			return {
				type: 'abortedBeforeIssued',
				reason: 'Dardcor not available due to content exclusion',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		if (prompt.type === 'contextTooShort') {
			logger.debug('Breaking, not enough context');
			return {
				type: 'abortedBeforeIssued',
				reason: 'Not enough context',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		if (prompt.type === 'promptError') {
			logger.debug('Error while building the prompt');
			return {
				type: 'abortedBeforeIssued',
				reason: 'Error while building the prompt',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		if (ghostTextOptions.promptOnly) {
			return { type: 'promptOnly', reason: 'Breaking, promptOnly set to true', prompt: prompt };
		}

		if (prompt.type === 'promptCancelled') {
			logger.debug('Cancelled during extractPrompt');
			return {
				type: 'abortedBeforeIssued',
				reason: 'Cancelled during extractPrompt',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		if (prompt.type === 'promptTimeout') {
			logger.debug('Timeout during extractPrompt');
			return {
				type: 'abortedBeforeIssued',
				reason: 'Timeout',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		if (prompt.prompt.prefix.length === 0 && prompt.prompt.suffix.length === 0) {
			logger.debug('Error empty prompt');
			return {
				type: 'abortedBeforeIssued',
				reason: 'Empty prompt',
				telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
			};
		}

		const debounce = this.instantiationService.invokeFunction(getRemainingDebounceMs, ghostTextOptions, preIssuedTelemetryDataWithExp);
		if (debounce > 0) {
			logger.debug(`Debouncing ghost text request for ${debounce}ms`);
			await delay(debounce);
			if (isCompletionRequestCancelled(this.currentGhostText, ourRequestId, cancellationToken)) {
				return {
					type: 'abortedBeforeIssued',
					reason: 'cancelled after debounce',
					telemetryData: mkBasicResultTelemetry(preIssuedTelemetryDataWithExp),
				};
			}
		}

		return this.statusReporter.withProgress(async () => {
			const [prefix] = trimLastLine(
				completionState.textDocument.getText(
					LocationFactory.range(LocationFactory.position(0, 0), completionState.position)
				)
			);
			logger.trace(`Starting ghost text computation, prefix length: ${prefix.length}`);

			const hasAcceptedCurrentCompletion = this.currentGhostText.hasAcceptedCurrentCompletion(prefix, prompt.prompt.suffix);
			logger.trace(`hasAcceptedCurrentCompletion: ${hasAcceptedCurrentCompletion}`);
			const originalPrompt = prompt.prompt;
			const ghostTextStrategy = await this.instantiationService.invokeFunction(getGhostTextStrategy,
				completionState,
				prefix,
				prompt,
				inlineSuggestion,
				hasAcceptedCurrentCompletion,
				preIssuedTelemetryDataWithExp
			);
			recordPerformance('strategy');
			logger.trace(`Ghost text strategy: blockMode=${ghostTextStrategy.blockMode}, requestMultiline=${ghostTextStrategy.requestMultiline}, stop=${ghostTextStrategy.stop}, maxTokens=${ghostTextStrategy.maxTokens}`);

			let choices = this.instantiationService.invokeFunction(getLocalInlineSuggestion, prefix, originalPrompt, ghostTextStrategy.requestMultiline);
			logger.trace(`Local cache lookup: ${choices ? `found ${choices[0].length} choices` : 'no cached choices'}`);
			recordPerformance('cache');
			const repoInfo = this.instantiationService.invokeFunction(extractRepoInfoInBackground, completionState.textDocument.uri);
			const requestContext: RequestContext = {
				blockMode: ghostTextStrategy.blockMode,
				languageId: completionState.textDocument.detectedLanguageId,
				repoInfo: repoInfo,
				engineModelId: engineInfo.modelId,
				ourRequestId,
				prefix,
				prompt: prompt.prompt,
				multiline: ghostTextStrategy.requestMultiline,
				indentation: contextIndentation(completionState.textDocument, completionState.position),
				isCycling: ghostTextOptions.isCycling,
				headers: engineInfo.headers,
				stop: ghostTextStrategy.stop,
				maxTokens: ghostTextStrategy.maxTokens,
				afterAccept: hasAcceptedCurrentCompletion,
			};
			const telemetryData = this.instantiationService.invokeFunction(telemetryIssued,
				completionState.textDocument,
				requestContext,
				completionState.position,
				prompt,
				preIssuedTelemetryDataWithExp,
				engineInfo,
				ghostTextOptions
			);

			if (
				choices === undefined &&
				!ghostTextOptions.isCycling &&
				this.asyncCompletionManager.shouldWaitForAsyncCompletions(prefix, prompt.prompt)
			) {
				logger.trace('No cached choices, waiting for async completions from in-flight request');
				const choice = await this.asyncCompletionManager.getFirstMatchingRequestWithTimeout(
					ourRequestId,
					prefix,
					prompt.prompt,
					ghostTextOptions.isSpeculative,
					telemetryData
				);
				recordPerformance('asyncWait');
				if (choice) {
					logger.trace('Received choice from async completion');
					const forceSingleLine = !ghostTextStrategy.requestMultiline;
					const trimmedChoice = makeGhostAPIChoice(choice[0], { forceSingleLine });
					choices = [[trimmedChoice], ResultType.Async];
				} else {
					logger.trace('No matching async completion found within timeout');
				}
				if (isCompletionRequestCancelled(this.currentGhostText, ourRequestId, cancellationToken)) {
					logger.debug('Cancelled before requesting a new completion');
					return {
						type: 'abortedBeforeIssued',
						reason: 'Cancelled after waiting for async completion',
						telemetryData: mkBasicResultTelemetry(telemetryData),
					};
				}
			} else {
				logger.trace('Skipping wait for async completions');
			}

			const isMoreMultiline =
				ghostTextStrategy.blockMode === BlockMode.MoreMultiline &&
				BlockTrimmer.isSupported(completionState.textDocument.detectedLanguageId);
			if (choices !== undefined) {
				logger.trace(`Post-processing ${choices[0].length} cached choices, isMoreMultiline=${isMoreMultiline}`);
				choices[0] = choices[0]
					.map(c =>
						this.instantiationService.invokeFunction(postProcessChoiceInContext,
							completionState.textDocument,
							completionState.position,
							c,
							isMoreMultiline,
							logger,
						)
					)
					.filter(c => c !== undefined);
			}

			if (choices && (choices[1] === ResultType.Cache || choices[1] === ResultType.TypingAsSuggested)) {
				telemetryBuilder.setIsFromCache();
				logContext.markAsFromCache();
			}

			if (choices !== undefined && choices[0].length === 0) {
				logger.trace(`Found empty inline suggestions locally via ${resultTypeToString(choices[1])}`);
				return {
					type: 'empty',
					reason: 'cached results empty after post-processing',
					telemetryData: mkBasicResultTelemetry(telemetryData),
				};
			}
			if (
				choices !== undefined &&
				choices[0].length > 0 &&
				(!ghostTextOptions.isCycling || choices[0].length > 1)
			) {
				logger.trace(`Found inline suggestions locally via ${resultTypeToString(choices[1])}`);
			} else {
				logger.trace(`Going to network, isCycling=${ghostTextOptions.isCycling}`);
				const completionsFromNetwork = this.instantiationService.createInstance(CompletionsFromNetwork);
				if (ghostTextOptions.isCycling) {
					logger.trace('Fetching all completions for cycling request');
					const networkChoices = await completionsFromNetwork.getAllCompletionsFromNetwork(
						requestContext,
						telemetryData,
						cancellationToken,
						ghostTextStrategy.finishedCb,
						telemetryBuilder,
					);

					if (networkChoices.type === 'success') {
						logger.trace(`Cycling network request returned ${networkChoices.value[0].length} choices`);
						const resultChoices = choices?.[0] ?? [];
						networkChoices.value[0].forEach(c => {
							if (resultChoices.findIndex(v => v.completionText.trim() === c.completionText.trim()) !== -1) {
								return;
							}
							resultChoices.push(c);
						});
						logger.trace(`After deduplication: ${resultChoices.length} unique choices`);
						choices = [resultChoices, ResultType.Cycling];
					} else {
						if (choices === undefined) {
							return networkChoices;
						}
					}
				} else {
					logger.trace('Initiating network request for completions');
					const finishedCb: FinishedCallback = (text, delta) => {
						this.asyncCompletionManager.updateCompletion(ourRequestId, text);
						return ghostTextStrategy.finishedCb(text, delta);
					};

					const asyncCancellationTokenSource = new CancellationTokenSource();
					const requestPromise = completionsFromNetwork.getCompletionsFromNetwork(
						requestContext,
						telemetryData,
						asyncCancellationTokenSource.token,
						finishedCb,
						telemetryBuilder,
					);
					void this.asyncCompletionManager.queueCompletionRequest(
						ourRequestId,
						prefix,
						prompt.prompt,
						asyncCancellationTokenSource,
						requestPromise
					);
					const c = await this.asyncCompletionManager.getFirstMatchingRequest(ourRequestId, prefix, prompt.prompt, ghostTextOptions.isSpeculative);
					if (c === undefined) {
						logger.trace('Network request returned no results');
						return {
							type: 'empty',
							reason: 'received no results from async completions',
							telemetryData: mkBasicResultTelemetry(telemetryData),
						};
					}
					logger.trace('Received completion from network request');
					choices = [[c[0]], ResultType.Async];
				}
				recordPerformance('network');
			}
			if (choices === undefined) {
				return {
					type: 'failed',
					reason: 'internal error: choices should be defined after network call',
					telemetryData: mkBasicResultTelemetry(telemetryData),
				};
			}
			const [choicesArray, resultType] = choices;
			logger.trace(`Final choices: ${choicesArray.length} from ${resultTypeToString(resultType)}`);

			const postProcessedChoicesArray = choicesArray
				.map(c =>
					this.instantiationService.invokeFunction(postProcessChoiceInContext,
						completionState.textDocument,
						completionState.position,
						c,
						isMoreMultiline,
						logger
					)
				)
				.filter(c => c !== undefined);
			logger.trace(`Post-processed to ${postProcessedChoicesArray.length} choices`);

			const completionsDelay =
				this.instantiationService.invokeFunction((getConfig<number>), ConfigKey.CompletionsDelay) ??
				this.completionsFeaturesService.completionsDelay(preIssuedTelemetryDataWithExp);
			const elapsed = now() - preIssuedTelemetryDataWithExp.issuedTime;
			const remainingDelay = Math.max(completionsDelay - elapsed, 0);
			if (resultType !== ResultType.TypingAsSuggested && !ghostTextOptions.isCycling && remainingDelay > 0) {
				logger.debug(`Waiting ${remainingDelay}ms before returning completion`);
				await delay(remainingDelay);
				if (isCompletionRequestCancelled(this.currentGhostText, ourRequestId, cancellationToken)) {
					logger.debug('Cancelled after completions delay');
					return {
						type: 'canceled',
						reason: 'after completions delay',
						telemetryData: mkCanceledResultTelemetry(telemetryData),
					};
				}
			}

			const results: CompletionResult[] = [];
			for (const choice of postProcessedChoicesArray) {
				const choiceTelemetryData = telemetryWithAddData(
					completionState.textDocument,
					requestContext,
					choice,
					telemetryData
				);

				const suffixCoverage = inlineSuggestion
					? checkSuffix(completionState.textDocument, completionState.position, choice)
					: 0;

				const ghostCompletion = adjustLeadingWhitespace(
					choice.choiceIndex,
					choice.completionText,
					prompt.trailingWs
				);
				const res: CompletionResult = {
					completion: ghostCompletion,
					telemetry: choiceTelemetryData,
					isMiddleOfTheLine: inlineSuggestion,
					suffixCoverage,
					dardcorAnnotations: choice.dardcorAnnotations,
					clientCompletionId: choice.clientCompletionId,
				};
				results.push(res);
			}

			telemetryData.properties.clientCompletionId = results[0]?.clientCompletionId;
			telemetryData.measurements.foundOffset = results?.[0]?.telemetry?.measurements?.foundOffset ?? -1;
			logger.debug(`Produced ${results.length} results from ${resultTypeToString(resultType)} at ${telemetryData.measurements.foundOffset} offset`);

			if (isCompletionRequestCancelled(this.currentGhostText, ourRequestId, cancellationToken)) {
				return {
					type: 'canceled',
					reason: 'after post processing completions',
					telemetryData: mkCanceledResultTelemetry(telemetryData),
				};
			}

			if (!ghostTextOptions.isSpeculative) {
				logger.trace('Updating current ghost text as request is not speculative');
				this.currentGhostText.setGhostText(prefix, prompt.prompt.suffix, postProcessedChoicesArray, resultType);
			}

			telemetryBuilder.setHeaderRequestId(postProcessedChoicesArray[0]?.requestId.headerRequestId ?? ourRequestId);

			recordPerformance('complete');
			logger.trace(`Ghost text computation complete, returning ${results.length} results`);

			return {
				type: 'success',
				value: [results, resultType],
				telemetryData: mkBasicResultTelemetry(telemetryData),
				telemetryBlob: telemetryData,
				resultType,
				performanceMetrics,
			};
		});
	}
}

export async function getGhostText(
	accessor: ServicesAccessor,
	completionState: CompletionState,
	token: ICancellationToken | undefined,
	options: Partial<GetGhostTextOptions>,
	logContext: GhostTextLogContext,
	telemetryBuilder: LlmNESTelemetryBuilder,
	logger: ILogger,
): Promise<GhostTextResultWithTelemetry<[CompletionResult[], ResultType]>> {
	const instaService = accessor.get(IInstantiationService);
	const ghostTextComputer = instaService.createInstance(GhostTextComputer);
	return ghostTextComputer.getGhostText(completionState, token, options, logContext, telemetryBuilder, logger);
}

function getLocalInlineSuggestion(
	accessor: ServicesAccessor,
	prefix: string,
	prompt: Prompt,
	requestMultiline: boolean
): [APIChoice[], ResultType] | undefined {
	const currentGhostText = accessor.get(ICompletionsCurrentGhostText);
	const choicesTyping = currentGhostText.getCompletionsForUserTyping(prefix, prompt.suffix);
	const choicesCache = getCompletionsFromCache(accessor, prefix, prompt.suffix, requestMultiline);

	if (choicesTyping && choicesTyping.length > 0) {
		const choicesCacheDeduped = (choicesCache ?? []).filter(
			c => !choicesTyping.some(t => t.completionText === c.completionText)
		);
		return [choicesTyping.concat(choicesCacheDeduped), ResultType.TypingAsSuggested];
	}

	if (choicesCache && choicesCache.length > 0) {
		return [choicesCache, ResultType.Cache];
	}
}

function isInlineSuggestion(document: TextDocumentContents, position: IPosition) {
	const line = document.lineAt(position);
	const textAfterCursor = line.text.substring(position.character);
	return isInlineSuggestionFromTextAfterCursor(textAfterCursor);
}

export class ForceMultiLine {
	static readonly default = new ForceMultiLine();

	constructor(readonly requestMultilineOverride = false) { }
}

function adjustLeadingWhitespace(index: number, text: string, ws: string): GhostCompletion {
	if (ws.length > 0) {
		if (text.startsWith(ws)) {
			return {
				completionIndex: index,
				completionText: text,
				displayText: text.substring(ws.length),
				displayNeedsWsOffset: false,
			};
		} else {
			const textLeftWs = text.substring(0, text.length - text.trimStart().length);
			if (ws.startsWith(textLeftWs)) {
				return {
					completionIndex: index,
					completionText: text,
					displayText: text.trimStart(),
					displayNeedsWsOffset: true,
				};
			} else {
				return { completionIndex: index, completionText: text, displayText: text, displayNeedsWsOffset: false };
			}
		}
	} else {
		return { completionIndex: index, completionText: text, displayText: text, displayNeedsWsOffset: false };
	}
}

function getCompletionsFromCache(
	accessor: ServicesAccessor,
	prefix: string,
	suffix: string,
	multiline: boolean
): APIChoice[] | undefined {
	const logger = accessor.get(ILogService).createSubLogger(['getCompletionsFromCache']);
	const choices = accessor.get(ICompletionsCacheService).findAll(prefix, suffix);
	if (choices.length === 0) {
		logger.debug('Found no completions in cache');
		return [];
	}
	logger.debug(`Found ${choices.length} completions in cache`);
	return choices.map(choice => makeGhostAPIChoice(choice, { forceSingleLine: !multiline }));
}

async function createTelemetryWithExp(
	accessor: ServicesAccessor,
	document: TextDocumentContents,
	headerRequestId: string,
	options?: Partial<GetGhostTextOptions>
): Promise<TelemetryWithExp> {
	const featuresService = accessor.get(ICompletionsFeaturesService);
	const properties: TelemetryProperties = { headerRequestId };
	if (options?.opportunityId) { properties.opportunityId = options.opportunityId; }
	if (options?.selectedCompletionInfo?.text) { properties.completionsActive = 'true'; }
	if (options?.isSpeculative) { properties.reason = 'speculative'; }
	const telemetryData = TelemetryData.createAndMarkAsIssued(properties);
	const telemetryWithExp = await featuresService.updateExPValuesAndAssignments(
		{ uri: document.uri, languageId: document.detectedLanguageId },
		telemetryData
	);
	return telemetryWithExp;
}

function telemetryWithAddData(
	document: TextDocumentContents,
	requestContext: RequestContext,
	choice: APIChoice,
	issuedTelemetryData: TelemetryWithExp
): TelemetryWithExp {
	const requestId = choice.requestId;
	const properties: { [key: string]: string } = {
		choiceIndex: choice.choiceIndex.toString(),
		clientCompletionId: choice.clientCompletionId,
	};
	if (choice.generatedChoiceIndex !== undefined) {
		properties.originalChoiceIndex = properties.choiceIndex;
		properties.choiceIndex = (10_000 * (choice.generatedChoiceIndex + 1) + choice.choiceIndex).toString();
	}
	const measurements: { [key: string]: number } = {
		compCharLen: choice.completionText.length,
		numLines: choice.completionText.trim().split('\n').length,
	};
	if (choice.meanLogProb) {
		measurements.meanLogProb = choice.meanLogProb;
	}
	if (choice.meanAlternativeLogProb) {
		measurements.meanAlternativeLogProb = choice.meanAlternativeLogProb;
	}

	const extendedTelemetry = choice.telemetryData.extendedBy(properties, measurements);
	extendedTelemetry.issuedTime = issuedTelemetryData.issuedTime;
	extendedTelemetry.measurements.timeToProduceMs = performance.now() - issuedTelemetryData.issuedTime;
	addDocumentTelemetry(extendedTelemetry, document);
	extendedTelemetry.extendWithRequestId(requestId);
	return extendedTelemetry;
}

function telemetryIssued(
	accessor: ServicesAccessor,
	document: TextDocumentContents,
	requestContext: RequestContext,
	position: IPosition,
	prompt: PromptResponsePresent,
	baseTelemetryData: TelemetryWithExp,
	requestInfo: EngineRequestInfo,
	ghostTextOptions: GetGhostTextOptions
): TelemetryWithExp {
	const properties: { [key: string]: string } = {
		languageId: document.detectedLanguageId,
	};
	properties.afterAccept = requestContext.afterAccept.toString();
	properties.isSpeculative = ghostTextOptions.isSpeculative.toString();
	const telemetryData = baseTelemetryData.extendedBy(properties);
	addDocumentTelemetry(telemetryData, document);

	const repoInfo = requestContext.repoInfo;
	telemetryData.properties.gitRepoInformation =
		repoInfo === undefined ? 'unavailable' : repoInfo === ComputationStatus.PENDING ? 'pending' : 'available';
	if (repoInfo !== undefined && repoInfo !== ComputationStatus.PENDING) {
		telemetryData.properties.gitRepoUrl = repoInfo.url;
		telemetryData.properties.gitRepoHost = repoInfo.hostname;
		if (repoInfo.repoId?.type === 'github') {
			telemetryData.properties.gitRepoOwner = repoInfo.repoId.org;
			telemetryData.properties.gitRepoName = repoInfo.repoId.repo;
		} else if (repoInfo.repoId?.type === 'ado') {
			telemetryData.properties.gitRepoOwner = repoInfo.repoId.project;
			telemetryData.properties.gitRepoName = repoInfo.repoId.repo;
		} else {
		}
		telemetryData.properties.gitRepoPath = repoInfo.pathname;
	}

	telemetryData.properties.engineName = requestInfo.modelId;
	telemetryData.properties.engineChoiceSource = requestInfo.engineChoiceSource;

	telemetryData.properties.isMultiline = JSON.stringify(requestContext.multiline);
	telemetryData.properties.isCycling = JSON.stringify(requestContext.isCycling);

	const currentLine = document.lineAt(position.line);
	const lineBeforeCursor = document.getText(LocationFactory.range(currentLine.range.start, position));
	const restOfLine = document.getText(LocationFactory.range(position, currentLine.range.end));

	const typeFileHashCode = Array.from(prompt.neighborSource.entries()).map(typeFiles => [
		typeFiles[0],
		typeFiles[1].map(f => createSha256Hash(f).toString()),
	]);

	const extendedProperties: TelemetryProperties = {
		beforeCursorWhitespace: JSON.stringify(lineBeforeCursor.trim() === ''),
		afterCursorWhitespace: JSON.stringify(restOfLine.trim() === ''),
		neighborSource: JSON.stringify(typeFileHashCode),
		blockMode: requestContext.blockMode,
	};
	const extendedMeasurements: TelemetryMeasurements = {
		...telemetrizePromptLength(prompt.prompt),
		promptEndPos: document.offsetAt(position),
		promptComputeTimeMs: prompt.computeTimeMs,
	};
	if (prompt.metadata) {
		extendedProperties.promptMetadata = JSON.stringify(prompt.metadata);
	}
	if (prompt.contextProvidersTelemetry) {
		extendedProperties.contextProviders = JSON.stringify(prompt.contextProvidersTelemetry);
	}
	const telemetryDataToSend = telemetryData.extendedBy(extendedProperties, extendedMeasurements);

	telemetry(accessor, 'ghostText.issued', telemetryDataToSend);

	return telemetryData;
}

function addDocumentTelemetry(telemetry: TelemetryWithExp, document: TextDocumentContents): void {
	telemetry.measurements.documentLength = document.getText().length;
	telemetry.measurements.documentLineCount = document.lineCount;
}
