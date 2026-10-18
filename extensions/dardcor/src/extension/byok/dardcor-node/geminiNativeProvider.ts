/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiError, GenerateContentParameters, GoogleGenAI, Tool, Type } from '@google/genai';
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelDataPart, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { IResponseDelta, OpenAiFunctionTool } from '../../../platform/networking/common/fetch';
import { APIUsage } from '../../../platform/networking/common/openai';
import { CustomDataPartMimeTypes } from '../../../platform/endpoint/common/endpointTypes';
import { DardcorChatAttr, emitInferenceDetailsEvent, GenAiAttr, GenAiMetrics, GenAiOperationName, GenAiProviderName, type OTelModelOptions, StdAttr, stringifyToolDefinitionsForOTel, toSystemInstructions, truncateForOTel } from '../../../platform/otel/common/index';
import { IOTelService, SpanKind, SpanStatusCode } from '../../../platform/otel/common/otelService';
import { IRequestLogger } from '../../../platform/requestLogger/common/requestLogger';
import { retrieveCapturingTokenByCorrelation, runWithCapturingToken } from '../../../platform/requestLogger/node/requestLogger';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { toErrorMessage } from '../../../util/common/errorMessage';
import { buildOTelInputFromChatMessages } from './byokOTelHelpers';
import { RecordedProgress } from '../../../util/common/progressRecorder';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { BYOKKnownModels, byokKnownModelsToAPIInfo, BYOKModelCapabilities, LMResponsePart } from '../common/byokProvider';
import { toGeminiFunction as toGeminiFunctionDeclaration, ToolJsonSchema } from '../common/geminiFunctionDeclarationConverter';
import { apiMessageToGeminiMessage, geminiMessagesToRawMessagesForLogging } from '../common/geminiMessageConverter';
import { AbstractLanguageModelChatProvider, ExtendedLanguageModelChatInformation, LanguageModelChatConfiguration } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

export class GeminiNativeBYOKLMProvider extends AbstractLanguageModelChatProvider {

	public static readonly providerName = 'Gemini';
	public static readonly providerId = this.providerName.toLowerCase();

	constructor(
		knownModels: BYOKKnownModels | undefined,
		byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
		@IRequestLogger private readonly _requestLogger: IRequestLogger,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IOTelService private readonly _otelService: IOTelService,
	) {
		super(GeminiNativeBYOKLMProvider.providerId, GeminiNativeBYOKLMProvider.providerName, knownModels, byokStorageService, logService);
	}

	protected async getAllModels(silent: boolean, apiKey: string | undefined): Promise<ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		if (!apiKey) {
			return [];
		}

		try {
			const client = new GoogleGenAI({ apiKey });
			const models = await client.models.list();
			const modelList: Record<string, BYOKModelCapabilities> = {};

			for await (const model of models) {
				const modelId = model.name;
				if (!modelId) {
					continue;
				}

				if (this._knownModels && this._knownModels[modelId]) {
					modelList[modelId] = this._knownModels[modelId];
				}
			}
			return byokKnownModelsToAPIInfo(this._name, modelList);
		} catch (e) {
			let error: Error;
			if (e instanceof ApiError) {
				let message = e.message;
				try { message = JSON.parse(message).error?.message; } catch { }
				error = new Error(message ?? e.message, { cause: e });
			} else {
				error = new Error(toErrorMessage(e, true));
			}
			this._logService.error(error, `Error fetching available ${GeminiNativeBYOKLMProvider.providerName} models`);
			throw error;
		}
	}

	async provideLanguageModelChatResponse(model: ExtendedLanguageModelChatInformation<LanguageModelChatConfiguration>, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<any> {
		const correlationId = (options as { modelOptions?: OTelModelOptions }).modelOptions?._capturingTokenCorrelationId;
		const capturingToken = correlationId ? retrieveCapturingTokenByCorrelation(correlationId) : undefined;
		const telemetryTurn = (options as { modelOptions?: OTelModelOptions }).modelOptions?._telemetryTurn;

		const parentTraceContext = (options as { modelOptions?: OTelModelOptions }).modelOptions?._otelTraceContext ?? undefined;

		let otelSpan: ReturnType<typeof this._otelService.startSpan> | undefined;

		const doRequest = async () => {
			const issuedTime = Date.now();
			const apiKey = model.configuration?.apiKey;
			if (!apiKey) {
				throw new Error('API key not found for the model');
			}

			const client = new GoogleGenAI({ apiKey });
			const { contents, systemInstruction } = apiMessageToGeminiMessage(messages as LanguageModelChatMessage[]);

			const requestId = generateUuid();
			const pendingLoggedChatRequest = this._requestLogger.logChatRequest(
				'GeminiNativeBYOK',
				{
					model: model.id,
					modelMaxPromptTokens: model.maxInputTokens,
					urlOrRequestMetadata: 'https://generativelanguage.googleapis.com',
				},
				{
					model: model.id,
					messages: geminiMessagesToRawMessagesForLogging(contents, systemInstruction),
					ourRequestId: requestId,
					location: ChatLocation.Other,
					body: {
						tools: options.tools?.map((tool): OpenAiFunctionTool => ({
							type: 'function',
							function: {
								name: tool.name,
								description: tool.description,
								parameters: tool.inputSchema
							}
						}))
					}
				});

			const tools: Tool[] = (options.tools ?? []).length > 0 ? [{
				functionDeclarations: (options.tools ?? []).map(tool => {
					if (!tool.inputSchema) {
						return {
							name: tool.name,
							description: tool.description,
							parameters: {
								type: Type.OBJECT,
								properties: {},
								required: []
							}
						};
					}

					const finalTool = toGeminiFunctionDeclaration(tool.name, tool.description, tool.inputSchema as ToolJsonSchema);
					finalTool.description = tool.description || finalTool.description;
					return finalTool;
				})
			}] : [];

			const abortController = new AbortController();
			const cancelSub = token.onCancellationRequested(() => {
				abortController.abort();
				this._logService.trace('Gemini request aborted via VS Code cancellation token');
			});

			const params: GenerateContentParameters = {
				model: model.id,
				contents: contents,
				config: {
					systemInstruction: systemInstruction,
					tools: tools.length > 0 ? tools : undefined,
					maxOutputTokens: model.maxOutputTokens,
					thinkingConfig: {
						includeThoughts: true,
					},
					abortSignal: abortController.signal
				}
			};

			const wrappedProgress = new RecordedProgress(progress);

			try {
				const result = await this._makeRequest(client, wrappedProgress, params, token, issuedTime);
				if (result.ttft) {
					pendingLoggedChatRequest.markTimeToFirstToken(result.ttft);
				}
				pendingLoggedChatRequest.resolve({
					type: ChatFetchResponseType.Success,
					requestId,
					serverRequestId: requestId,
					usage: result.usage,
					resolvedModel: model.id,
					value: ['value'],
				}, wrappedProgress.items.map((i): IResponseDelta => {
					return {
						text: i instanceof LanguageModelTextPart ? i.value : '',
						dardcorToolCalls: i instanceof LanguageModelToolCallPart ? [{
							name: i.name,
							arguments: JSON.stringify(i.input),
							id: i.callId
						}] : undefined,
					};
				}));

				if (result.usage) {
					wrappedProgress.report(new LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(result.usage)), CustomDataPartMimeTypes.Usage));
				}

				if (otelSpan && result.usage) {
					otelSpan.setAttributes({
						[GenAiAttr.USAGE_INPUT_TOKENS]: result.usage.prompt_tokens ?? 0,
						[GenAiAttr.USAGE_OUTPUT_TOKENS]: result.usage.completion_tokens ?? 0,
						...(result.usage.prompt_tokens_details?.cached_tokens !== undefined
							? { [GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS]: result.usage.prompt_tokens_details.cached_tokens }
							: {}),
						[GenAiAttr.RESPONSE_MODEL]: model.id,
						[GenAiAttr.RESPONSE_ID]: requestId,
						[GenAiAttr.RESPONSE_FINISH_REASONS]: ['stop'],
						[GenAiAttr.REQUEST_STREAM]: true,
						...(result.ttft ? { [DardcorChatAttr.TIME_TO_FIRST_TOKEN]: result.ttft } : {}),
						...(result.ttft ? { [GenAiAttr.RESPONSE_TIME_TO_FIRST_CHUNK]: result.ttft / 1000 } : {}),
						[GenAiAttr.REQUEST_MAX_TOKENS]: model.maxOutputTokens ?? 0,
					});
					if (this._otelService.config.captureContent) {
						const responseText = wrappedProgress.items
							.filter((p): p is LanguageModelTextPart => p instanceof LanguageModelTextPart)
							.map(p => p.value).join('');
						const toolCalls = wrappedProgress.items
							.filter((p): p is LanguageModelToolCallPart => p instanceof LanguageModelToolCallPart)
							.map(tc => ({ type: 'tool_call' as const, id: tc.callId, name: tc.name, arguments: tc.input }));
						const parts: Array<{ type: string; content?: string; id?: string; name?: string; arguments?: unknown }> = [];
						if (responseText) { parts.push({ type: 'text', content: responseText }); }
						parts.push(...toolCalls);
						if (parts.length > 0) {
							otelSpan.setAttribute(GenAiAttr.OUTPUT_MESSAGES, truncateForOTel(JSON.stringify([{ role: 'assistant', parts }]), this._otelService.config.maxAttributeSizeChars));
						}
					}
				}

				if (result.usage) {
					const durationSec = (Date.now() - issuedTime) / 1000;
					const metricAttrs = { operationName: GenAiOperationName.CHAT, providerName: 'gemini', requestModel: model.id, responseModel: model.id };
					GenAiMetrics.recordOperationDuration(this._otelService, durationSec, metricAttrs);
					if (result.usage.prompt_tokens) { GenAiMetrics.recordTokenUsage(this._otelService, result.usage.prompt_tokens, 'input', metricAttrs); }
					if (result.usage.completion_tokens) { GenAiMetrics.recordTokenUsage(this._otelService, result.usage.completion_tokens, 'output', metricAttrs); }
					if (result.ttft) { GenAiMetrics.recordTimeToFirstToken(this._otelService, model.id, result.ttft / 1000); }
					if (result.ttft) { GenAiMetrics.recordTimeToFirstChunk(this._otelService, result.ttft / 1000, metricAttrs); }
				}

				emitInferenceDetailsEvent(
					this._otelService,
					{ model: model.id, maxTokens: model.maxOutputTokens },
					result.usage ? {
						id: requestId,
						model: model.id,
						finishReasons: ['stop'],
						inputTokens: result.usage.prompt_tokens,
						outputTokens: result.usage.completion_tokens,
					} : undefined,
				);

				this._telemetryService.sendTelemetryEvent('response.success', { github: true, microsoft: true }, {
					source: 'byok.gemini',
					model: model.id,
					requestId,
				}, {
					totalTokenMax: model.maxInputTokens ?? -1,
					...(telemetryTurn !== undefined ? { turn: telemetryTurn } : {}),
					tokenCountMax: model.maxOutputTokens ?? -1,
					promptTokenCount: result.usage?.prompt_tokens,
					promptCacheTokenCount: result.usage?.prompt_tokens_details?.cached_tokens,
					tokenCount: result.usage?.total_tokens,
					completionTokens: result.usage?.completion_tokens,
					timeToFirstToken: result.ttft,
					timeToFirstTokenEmitted: result.ttfte,
					timeToComplete: Date.now() - issuedTime,
					issuedTime,
					isBYOK: 1,
				});
			} catch (err) {
				this._logService.error(`BYOK GeminiNative error: ${toErrorMessage(err, true)}`);
				pendingLoggedChatRequest.resolve({
					type: token.isCancellationRequested ? ChatFetchResponseType.Canceled : ChatFetchResponseType.Unknown,
					requestId,
					serverRequestId: requestId,
					reason: token.isCancellationRequested ? 'cancelled' : toErrorMessage(err)
				}, wrappedProgress.items.map((i): IResponseDelta => {
					return {
						text: i instanceof LanguageModelTextPart ? i.value : '',
						dardcorToolCalls: i instanceof LanguageModelToolCallPart ? [{
							name: i.name,
							arguments: JSON.stringify(i.input),
							id: i.callId
						}] : undefined,
					};
				}));
				throw err;
			} finally {
				cancelSub.dispose();
			}
		};

		const executeRequest = async () => {
			const chatSessionId = capturingToken?.chatSessionId;
			const parentChatSessionId = capturingToken?.parentChatSessionId;
			const debugLogLabel = capturingToken?.debugLogLabel;
			otelSpan = this._otelService.startSpan(`chat ${model.id}`, {
				kind: SpanKind.CLIENT,
				attributes: {
					[GenAiAttr.OPERATION_NAME]: GenAiOperationName.CHAT,
					[GenAiAttr.PROVIDER_NAME]: GenAiProviderName.GEMINI,
					[GenAiAttr.REQUEST_MODEL]: model.id,
					...(chatSessionId ? { [GenAiAttr.CONVERSATION_ID]: chatSessionId } : {}),
					...(chatSessionId ? { [DardcorChatAttr.SESSION_ID]: chatSessionId } : {}),
					...(chatSessionId ? { [DardcorChatAttr.CHAT_SESSION_ID]: chatSessionId } : {}),
					...(parentChatSessionId ? { [DardcorChatAttr.PARENT_CHAT_SESSION_ID]: parentChatSessionId } : {}),
					...(debugLogLabel ? { [DardcorChatAttr.DEBUG_LOG_LABEL]: debugLogLabel } : {}),
					[GenAiAttr.AGENT_NAME]: 'GeminiBYOK',
					[DardcorChatAttr.MAX_PROMPT_TOKENS]: model.maxInputTokens,
					[StdAttr.SERVER_ADDRESS]: 'generativelanguage.googleapis.com',
				},
			});
			if (this._otelService.config.captureContent) {
				const toolDefsJson = stringifyToolDefinitionsForOTel(options.tools);
				if (toolDefsJson) {
					otelSpan.setAttribute(GenAiAttr.TOOL_DEFINITIONS, truncateForOTel(toolDefsJson, this._otelService.config.maxAttributeSizeChars));
				}
				try {
					const { systemTexts, inputMsgs } = buildOTelInputFromChatMessages(messages);
					const systemInstructions = toSystemInstructions(systemTexts);
					if (systemInstructions) {
						otelSpan.setAttribute(GenAiAttr.SYSTEM_INSTRUCTIONS, truncateForOTel(JSON.stringify(systemInstructions), this._otelService.config.maxAttributeSizeChars));
					}
					otelSpan.setAttribute(GenAiAttr.INPUT_MESSAGES, truncateForOTel(JSON.stringify(inputMsgs), this._otelService.config.maxAttributeSizeChars));
				} catch { }
			}
			try {
				const result = capturingToken
					? await runWithCapturingToken(capturingToken, doRequest)
					: await doRequest();
				otelSpan.setStatus(SpanStatusCode.OK);
				return result;
			} catch (err) {
				otelSpan.setStatus(SpanStatusCode.ERROR, err instanceof Error ? err.message : String(err));
				throw err;
			} finally {
				otelSpan.end();
			}
		};

		if (parentTraceContext) {
			return this._otelService.runWithTraceContext(parentTraceContext, executeRequest);
		}
		return executeRequest();
	}

	async provideTokenCount(model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token: CancellationToken): Promise<number> {
		return Math.ceil(text.toString().length / 4);
	}

	private async _makeRequest(client: GoogleGenAI, progress: Progress<LMResponsePart>, params: GenerateContentParameters, token: CancellationToken, issuedTime: number): Promise<{ ttft: number | undefined; ttfte: number | undefined; usage: APIUsage | undefined }> {
		const start = Date.now();
		let ttft: number | undefined;
		let ttfte: number | undefined;
		let usage: APIUsage | undefined;

		try {
			const stream = await client.models.generateContentStream(params);

			let pendingThinkingSignature: string | undefined;

			for await (const chunk of stream) {
				if (token.isCancellationRequested) {
					break;
				}

				if (ttft === undefined) {
					ttft = Date.now() - start;
				}

				this._logService.trace(`Gemini chunk: ${JSON.stringify(chunk)}`);

				if (chunk.candidates && chunk.candidates.length > 0) {
					const candidate = chunk.candidates[0];

					if (candidate.content && candidate.content.parts) {
						for (const part of candidate.content.parts) {
							if ('thoughtSignature' in part && part.thoughtSignature) {
								pendingThinkingSignature = part.thoughtSignature as string;
							}
							if ('thought' in part && part.thought === true && part.text) {
								if (ttfte === undefined) {
									ttfte = Date.now() - issuedTime;
								}
								progress.report(new LanguageModelThinkingPart(part.text));
							} else if (part.text) {
								if (ttfte === undefined) {
									ttfte = Date.now() - issuedTime;
								}
								progress.report(new LanguageModelTextPart(part.text));
							} else if (part.functionCall && part.functionCall.name) {
								if (pendingThinkingSignature) {
									const thinkingPart = new LanguageModelThinkingPart('', undefined, { signature: pendingThinkingSignature });
									progress.report(thinkingPart);
									pendingThinkingSignature = undefined;
								}

								if (ttfte === undefined) {
									ttfte = Date.now() - issuedTime;
								}
								progress.report(new LanguageModelToolCallPart(
									generateUuid(),
									part.functionCall.name,
									part.functionCall.args || {}
								));
							}
						}
					}
				}

				if (chunk.usageMetadata) {
					const promptTokens = chunk.usageMetadata.promptTokenCount;
					const candidateTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
					const thoughtTokens = chunk.usageMetadata.thoughtsTokenCount ?? 0;
					const completionTokens = candidateTokens + thoughtTokens > 0 ? candidateTokens + thoughtTokens : undefined;
					const cachedTokens = chunk.usageMetadata.cachedContentTokenCount;

					if (!usage) {
						usage = {
							completion_tokens: completionTokens ?? -1,
							prompt_tokens: promptTokens ?? -1,
							total_tokens: chunk.usageMetadata.totalTokenCount ?? -1,
							prompt_tokens_details: {
								cached_tokens: cachedTokens ?? 0,
							}
						};
					} else {
						if (promptTokens !== undefined) {
							usage.prompt_tokens = promptTokens;
						}
						if (completionTokens !== undefined) {
							usage.completion_tokens = completionTokens;
						}
						if (chunk.usageMetadata.totalTokenCount !== undefined) {
							usage.total_tokens = chunk.usageMetadata.totalTokenCount;
						} else if (usage.prompt_tokens !== -1 && usage.completion_tokens !== -1) {
							usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
						}
						if (cachedTokens !== undefined) {
							usage.prompt_tokens_details!.cached_tokens = cachedTokens;
						}
					}
				}
			}

			return { ttft, ttfte, usage };
		} catch (error) {
			if ((error as any)?.name === 'AbortError' || token.isCancellationRequested) {
				this._logService.trace('Gemini streaming aborted');
				return { ttft, ttfte, usage };
			}
			this._logService.error(`Gemini streaming error: ${toErrorMessage(error, true)}`);
			throw error;
		}
	}
}
