/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ICopilotTokenStore } from '../../../platform/authentication/common/dardcorTokenStore';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { ICopilotToolCall } from '../../../platform/networking/common/fetch';
import { CapturingToken } from '../../../platform/requestLogger/common/capturingToken';
import { IRequestLogger } from '../../../platform/requestLogger/common/requestLogger';
import { ITabsAndEditorsService } from '../../../platform/tabs/common/tabsAndEditorsService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { createServiceIdentifier } from '../../../util/common/services';
import { CancellationTokenSource } from '../../../util/dardcor/base/common/cancellation';
import { isCancellationError } from '../../../util/dardcor/base/common/errors';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { renderPromptElement } from '../../prompts/node/base/promptRenderer';
import { PromptCategorizationPrompt } from '../../prompts/node/panel/promptCategorization';
import { CATEGORIZE_PROMPT_TOOL_NAME, CATEGORIZE_PROMPT_TOOL_SCHEMA, isValidDomain, isValidIntent, isValidScope, PromptClassification } from '../common/promptCategorizationTaxonomy';
import { getModeNameForTelemetry } from './telemetry';
import { isCAPIEndpoint } from '../../../platform/networking/common/networking';

const EXP_FLAG_PROMPT_CATEGORIZATION = 'dardcorchat.promptCategorization';

export const IPromptCategorizerService = createServiceIdentifier<IPromptCategorizerService>('IPromptCategorizerService');

export interface IPromptCategorizerService {
	readonly _serviceBrand: undefined;

	categorizePrompt(request: vscode.ChatRequest, context: vscode.ChatContext, telemetryMessageId: string): void;
}

const CATEGORIZATION_OUTCOMES = {
	SUCCESS: '',
	TIMEOUT: 'timeout',
	REQUEST_FAILED: 'requestFailed',
	NO_TOOL_CALL: 'noToolCall',
	PARSE_ERROR: 'parseError',
	INVALID_CLASSIFICATION: 'invalidClassification',
	PARTIAL_CLASSIFICATION: 'partialClassification',
	ERROR: 'error',
} as const;

const ISO_8601_DURATION_REGEX = /^PT(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

function isValidIsoDuration(duration: string): boolean {
	return ISO_8601_DURATION_REGEX.test(duration);
}

function hasValidTimeEstimates(partial: PromptClassification): boolean {
	return partial.timeEstimate.bestCase !== '' && partial.timeEstimate.realistic !== '';
}

function extractPartialClassification(obj: unknown): PromptClassification | undefined {
	if (typeof obj !== 'object' || obj === null) {
		return undefined;
	}

	const c = obj as Record<string, unknown>;

	if (
		typeof c.intent !== 'string' || !isValidIntent(c.intent) ||
		typeof c.domain !== 'string' || !isValidDomain(c.domain) ||
		typeof c.scope !== 'string' || !isValidScope(c.scope) ||
		typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1 ||
		typeof c.reasoning !== 'string'
	) {
		return undefined;
	}

	let bestCase = '';
	let realistic = '';
	if (typeof c.timeEstimate === 'object' && c.timeEstimate !== null) {
		const te = c.timeEstimate as Record<string, unknown>;
		if (typeof te.bestCase === 'string' && isValidIsoDuration(te.bestCase)) {
			bestCase = te.bestCase;
		}
		if (typeof te.realistic === 'string' && isValidIsoDuration(te.realistic)) {
			realistic = te.realistic;
		}
	}

	return {
		intent: c.intent,
		domain: c.domain,
		scope: c.scope,
		confidence: c.confidence,
		reasoning: c.reasoning,
		timeEstimate: { bestCase, realistic },
	};
}

export class PromptCategorizerService implements IPromptCategorizerService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IExperimentationService private readonly experimentationService: IExperimentationService,
		@ITabsAndEditorsService private readonly tabsAndEditorsService: ITabsAndEditorsService,
		@ICopilotTokenStore private readonly dardcorTokenStore: ICopilotTokenStore,
		@IRequestLogger private readonly requestLogger: IRequestLogger,
	) { }

	categorizePrompt(request: vscode.ChatRequest, context: vscode.ChatContext, telemetryMessageId: string): void {
		const isInternal = this.dardcorTokenStore.dardcorToken?.isInternal === true;
		if (!isInternal && !this.experimentationService.getTreatmentVariable<boolean>(EXP_FLAG_PROMPT_CATEGORIZATION)) {
			return;
		}

		if (request.location2 !== undefined) {
			return;
		}
		if (request.subAgentName !== undefined) {
			return;
		}
		if (request.attempt !== 0) {
			return;
		}
		if (context.history.length > 0) {
			return;
		}

		const parentChatSessionId = (request as { sessionId?: string }).sessionId;
		this._categorizePromptAsync(request, context, telemetryMessageId, parentChatSessionId).catch(err => {
			this.logService.error(`[PromptCategorizer] Error categorizing prompt: ${err instanceof Error ? err.message : String(err)}`);
		});
	}

	private async _categorizePromptAsync(request: vscode.ChatRequest, _context: vscode.ChatContext, telemetryMessageId: string, parentChatSessionId: string | undefined): Promise<void> {
		const startTime = Date.now();
		let outcome: typeof CATEGORIZATION_OUTCOMES[keyof typeof CATEGORIZATION_OUTCOMES] = CATEGORIZATION_OUTCOMES.ERROR;
		let errorDetail = '';
		let classification: PromptClassification | undefined;

		const currentLanguage = this.tabsAndEditorsService.activeTextEditor?.document.languageId;

		const CATEGORIZATION_TIMEOUT_MS = 10_000;
		const cts = new CancellationTokenSource();
		const timeoutHandle = setTimeout(() => cts.cancel(), CATEGORIZATION_TIMEOUT_MS);

		try {
			const mainModelEndpoint = await this.endpointProvider.getChatEndpoint(request);

			if (!isCAPIEndpoint(mainModelEndpoint) && mainModelEndpoint.modelProvider?.toLowerCase() !== 'dardcor') {
				this.logService.debug('[PromptCategorizer] Skipping categorization because main model is BYOK');
				return;
			}

			const endpoint = await this.endpointProvider.getChatEndpoint('dardcor-utility-small');

			const { messages } = await renderPromptElement(
				this.instantiationService,
				endpoint,
				PromptCategorizationPrompt,
				{
					userRequest: request.prompt,
				}
			);

			const toolCalls: ICopilotToolCall[] = [];

			const capturingToken = new CapturingToken(
				'categorization',
				undefined,
				undefined,
				undefined,
				undefined,
				parentChatSessionId,
				'categorization',
			);

			const response = await this.requestLogger.captureInvocation(capturingToken, () => endpoint.makeChatRequest2({
				debugName: 'promptCategorization',
				messages,
				finishedCb: async (_text, _index, delta) => {
					if (delta.dardcorToolCalls) {
						toolCalls.push(...delta.dardcorToolCalls);
					}
					return undefined;
				},
				location: ChatLocation.Panel,
				userInitiatedRequest: false,
				isConversationRequest: false,
				interactionTypeOverride: 'conversation-background',
				requestOptions: {
					tools: [{
						type: 'function',
						function: {
							name: CATEGORIZE_PROMPT_TOOL_NAME,
							description: 'Classify a user prompt across intent, domain, scope, and time estimate dimensions',
							parameters: CATEGORIZE_PROMPT_TOOL_SCHEMA
						}
					}],
					tool_choice: { type: 'function', function: { name: CATEGORIZE_PROMPT_TOOL_NAME } }
				}
			}, cts.token));

			if (cts.token.isCancellationRequested) {
				outcome = CATEGORIZATION_OUTCOMES.TIMEOUT;
				errorDetail = `Timed out after ${CATEGORIZATION_TIMEOUT_MS}ms`;
				this.logService.debug('[PromptCategorizer] Request cancelled due to timeout');
			} else if (response.type === ChatFetchResponseType.Success) {
				const categorizationCall = toolCalls.find(tc => tc.name === CATEGORIZE_PROMPT_TOOL_NAME);

				if (categorizationCall) {
					try {
						const parsed = JSON.parse(categorizationCall.arguments);
						const partial = extractPartialClassification(parsed);
						if (partial && hasValidTimeEstimates(partial)) {
							classification = partial;
							outcome = CATEGORIZATION_OUTCOMES.SUCCESS;
						} else if (partial) {
							classification = partial;
							outcome = CATEGORIZATION_OUTCOMES.PARTIAL_CLASSIFICATION;
							errorDetail = `Recovered core fields; invalid timeEstimate (arguments length: ${categorizationCall.arguments.length})`;
							this.logService.debug(`[PromptCategorizer] Partial classification recovered; ${errorDetail}`);
						} else {
							outcome = CATEGORIZATION_OUTCOMES.INVALID_CLASSIFICATION;
							errorDetail = `Invalid classification structure (arguments length: ${categorizationCall.arguments.length})`;
							this.logService.warn(`[PromptCategorizer] Invalid classification structure; ${errorDetail}`);
						}
					} catch (parseError) {
						outcome = CATEGORIZATION_OUTCOMES.PARSE_ERROR;
						const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
						errorDetail = `${parseMsg} (arguments length: ${categorizationCall.arguments.length}, timedOut: ${cts.token.isCancellationRequested})`;
						this.logService.warn(`[PromptCategorizer] Failed to parse tool arguments: ${errorDetail}`);
					}
				} else {
					outcome = CATEGORIZATION_OUTCOMES.NO_TOOL_CALL;
					errorDetail = `${toolCalls.length} tool calls returned, none matched ${CATEGORIZE_PROMPT_TOOL_NAME}`;
					this.logService.warn('[PromptCategorizer] No categorization tool call found in response');
				}
			} else {
				outcome = CATEGORIZATION_OUTCOMES.REQUEST_FAILED;
				errorDetail = `Response type: ${response.type}`;
				this.logService.warn(`[PromptCategorizer] Request failed with type: ${response.type}`);
			}

			toolCalls.length = 0;
		} catch (err) {
			if (isCancellationError(err)) {
				outcome = CATEGORIZATION_OUTCOMES.TIMEOUT;
				errorDetail = `Request cancelled after ${Date.now() - startTime}ms`;
			} else {
				errorDetail = err instanceof Error ? err.message : String(err);
			}
			this.logService.error(`[PromptCategorizer] Error during categorization: ${errorDetail}`);
		} finally {
			clearTimeout(timeoutHandle);
			cts.dispose();
		}

		const latencyMs = Date.now() - startTime;

		const MAX_ERROR_DETAIL_LENGTH = 500;
		const truncatedErrorDetail = errorDetail.length > MAX_ERROR_DETAIL_LENGTH
			? errorDetail.slice(0, MAX_ERROR_DETAIL_LENGTH)
			: errorDetail;

		this.telemetryService.sendMSFTTelemetryEvent(
			'promptCategorization',
			{
				taxonomyVersion: 'v2',
				sessionId: request.sessionId ?? '',
				requestId: telemetryMessageId,
				vscodeRequestId: request.id ?? '',
				modeName: getModeNameForTelemetry(request.modeInstructions2) ?? 'custom',
				currentLanguage: currentLanguage ?? '',
				outcome,
				intent: classification?.intent ?? '',
				domain: classification?.domain ?? '',
				timeEstimateBestCase: classification?.timeEstimate?.bestCase ?? '',
				timeEstimateRealistic: classification?.timeEstimate?.realistic ?? '',
				scope: classification?.scope ?? '',
			},
			{
				promptLength: request.prompt.length,
				numReferences: request.references?.length ?? 0,
				numToolReferences: request.toolReferences?.length ?? 0,
				confidence: classification?.confidence ?? 0,
				latencyMs,
			}
		);

		const MAX_TELEMETRY_PROMPT_LENGTH = 8192;
		const truncatedPrompt = request.prompt.length > MAX_TELEMETRY_PROMPT_LENGTH
			? request.prompt.slice(0, MAX_TELEMETRY_PROMPT_LENGTH)
			: request.prompt;

		this.telemetryService.sendInternalMSFTTelemetryEvent(
			'promptCategorization',
			{
				taxonomyVersion: 'v2',
				sessionId: request.sessionId ?? '',
				requestId: telemetryMessageId,
				vscodeRequestId: request.id ?? '',
				modeName: getModeNameForTelemetry(request.modeInstructions2) ?? 'custom',
				currentLanguage: currentLanguage ?? '',
				outcome,
				errorDetail: truncatedErrorDetail,
				intent: classification?.intent ?? '',
				domain: classification?.domain ?? '',
				timeEstimateBestCase: classification?.timeEstimate?.bestCase ?? '',
				timeEstimateRealistic: classification?.timeEstimate?.realistic ?? '',
				scope: classification?.scope ?? '',
				reasoning: classification?.reasoning ?? '',
				prompt: truncatedPrompt,
			},
			{
				promptLength: request.prompt.length,
				numReferences: request.references?.length ?? 0,
				numToolReferences: request.toolReferences?.length ?? 0,
				confidence: classification?.confidence ?? 0,
				latencyMs,
			}
		);

		this.logService.debug(`[PromptCategorizer] Classification complete: outcome=${outcome || 'success'}, latencyMs=${latencyMs}, intent=${classification?.intent}, domain=${classification?.domain}, scope=${classification?.scope}`);
	}
}
