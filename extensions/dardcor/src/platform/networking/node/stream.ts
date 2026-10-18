/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { ILogService, LogLevel } from '../../log/common/logService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { RawThinkingDelta, ThinkingDelta } from '../../thinking/common/thinking';
import { extractThinkingDeltaFromChoice, } from '../../thinking/common/thinkingUtils';
import { FinishedCallback, getRequestId, ICodeVulnerabilityAnnotation, ICopilotBeginToolCall, ICopilotConfirmation, ICopilotError, ICopilotFunctionCall, ICopilotReference, ICopilotToolCall, ICopilotToolCallStreamUpdate, IIPCodeCitation, isCodeCitationAnnotation, isDardcorAnnotation, RequestId } from '../common/fetch';
import { DestroyableStream, Response } from '../common/fetcherService';
import { APIErrorResponse, APIJsonData, APIUsage, ChoiceLogProbs, FilterReason, FinishedCompletionReason, isApiUsage, IToolCall } from '../common/openai';

class APIJsonDataStreaming {

	constructor(public readonly model: string) { }

	get text(): readonly string[] {
		return this._text;
	}

	private _text: string[] = [];
	private _newText: string[] = [];

	append(choice: ExtendedChoiceJSON) {
		if (choice.text) {
			const str = APIJsonDataStreaming._removeCR(choice.text);
			this._text.push(str);
			this._newText.push(str);
		}
		if (choice.delta?.content) {
			const str = APIJsonDataStreaming._removeCR(choice.delta.content);
			this._text.push(str);
			this._newText.push(str);
		}
		if (choice.delta?.function_call && (choice.delta.function_call.name || choice.delta.function_call.arguments)) {
			const str = APIJsonDataStreaming._removeCR(choice.delta.function_call.arguments);
			this._text.push(str);
			this._newText.push(str);
		}
	}

	flush(): string {
		const delta = this._newText.join('');
		this._newText = [];
		return delta;
	}

	private static _removeCR(text: string): string {
		return text.replace(/\r$/g, '');
	}

	toJSON() {
		return {
			text: this._text,
			newText: this._newText
		};
	}
}

class StreamingToolCall {
	public id: string | undefined;
	public name: string | undefined;
	public arguments: string = '';

	constructor() { }

	update(toolCall: IToolCall): boolean {
		let argumentsChanged = false;

		if (toolCall.id) {
			this.id = toolCall.id;
		}

		if (toolCall.function?.name) {
			this.name = toolCall.function.name;
		}

		if (toolCall.function?.arguments) {
			this.arguments += toolCall.function.arguments;
			argumentsChanged = true;
		}

		return argumentsChanged;
	}
}

class StreamingToolCalls {
	private toolCalls: StreamingToolCall[] = [];

	constructor() { }

	getToolCalls(): ICopilotToolCall[] {
		return this.toolCalls.map(call => {
			return {
				name: call.name!,
				arguments: call.arguments,
				id: call.id!,
			};
		});
	}

	hasToolCalls(): boolean {
		return this.toolCalls.length > 0;
	}

	update(choice: ExtendedChoiceJSON): ICopilotToolCallStreamUpdate[] {
		const updates: ICopilotToolCallStreamUpdate[] = [];
		choice.delta?.tool_calls?.forEach(toolCall => {
			let currentCall: StreamingToolCall | undefined;
			if (toolCall.id) {
				currentCall = this.toolCalls.find(call => call.id === toolCall.id);
			}
			if (!currentCall) {
				currentCall = this.toolCalls.at(-1);
			}
			if (!currentCall || (toolCall.id && currentCall.id && currentCall.id !== toolCall.id)) {
				currentCall = new StreamingToolCall();
				this.toolCalls.push(currentCall);
			}

			const argumentsChanged = currentCall.update(toolCall);
			if (argumentsChanged && currentCall.name) {
				updates.push({
					name: currentCall.name,
					arguments: currentCall.arguments,
					id: currentCall.id,
				});
			}
		});
		return updates;
	}
}

export function splitChunk(chunk: string): [string[], string] {
	const dataLines = chunk.split('\n');
	const newExtra = dataLines.pop();
	return [dataLines.filter(line => line !== ''), newExtra!];
}

export interface FinishedCompletion {
	solution: APIJsonDataStreaming;
	finishOffset: number | undefined;
	reason: FinishedCompletionReason;
	filterReason?: FilterReason;
	error?: APIErrorResponse;
	usage?: APIUsage;
	requestId: RequestId;
	index: number;
}

interface ChoiceJSON {
	index: number;
	text?: string;
	delta?: { content: string | null };
	finish_reason?: FinishedCompletionReason.Stop | FinishedCompletionReason.Length | FinishedCompletionReason.FunctionCall | FinishedCompletionReason.ContentFilter | FinishedCompletionReason.ServerError | FinishedCompletionReason.ToolCalls | null;
	logprobs?: ChoiceLogProbs;
}

interface ExtendedChoiceJSON extends ChoiceJSON {
	content_filter_results?: Record<Exclude<FilterReason, FilterReason.Copyright>, { filtered: boolean; severity: string }>;
	message?: RawThinkingDelta;
	delta?: {
		content: string | null;
		dardcor_annotations?: {
			CodeVulnerability: ICodeVulnerabilityAnnotation[];
			IPCodeCitations: IIPCodeCitation[];
			TextCopyright: boolean | undefined;
			Sexual: boolean | undefined;
			SexualPattern: boolean | undefined;
			Violence: boolean | undefined;
			HateSpeech: boolean | undefined;
			HateSpeechPattern: boolean | undefined;
			SelfHarm: boolean | undefined;
			PromptPromBlockList: boolean | undefined;
		};
		function_call?: { name: string; arguments: string };
		tool_calls?: IToolCall[];
		role?: string;
		name?: string;
	} & RawThinkingDelta;
}

export class SSEProcessor {
	private requestId: RequestId = getRequestId(this.response.headers);
	private readonly solutions: Record<number, APIJsonDataStreaming | null> = {};

	private readonly completedFunctionCallIdxs: Map<number , 'function' | 'tool'> = new Map();
	private readonly functionCalls: Record<string, APIJsonDataStreaming | null> = {};
	private readonly toolCalls = new StreamingToolCalls();
	private functionCallName: string | undefined = undefined;

	private constructor(
		private readonly logService: ILogService,
		private readonly telemetryService: ITelemetryService,
		private readonly expectedNumChoices: number,
		private readonly response: Response,
		private readonly body: DestroyableStream<string>,
		private readonly cancellationToken?: CancellationToken
	) { }

	static async create(
		logService: ILogService,
		telemetryService: ITelemetryService,
		expectedNumChoices: number,
		response: Response,
		cancellationToken?: CancellationToken
	) {
		const body = response.body.pipeThrough(new TextDecoderStream());
		return new SSEProcessor(
			logService,
			telemetryService,
			expectedNumChoices,
			response,
			body,
			cancellationToken
		);
	}

	async *processSSE(finishedCb: FinishedCallback = async () => undefined): AsyncIterable<FinishedCompletion> {
		try {
			// If it's n > 1 we don't handle usage as the usage is global for the stream and all our code assumes per choice
			if (this.expectedNumChoices > 1) {
				for await (const usageOrCompletions of this.processSSEInner(finishedCb)) {
					if (!isApiUsage(usageOrCompletions)) {
						yield usageOrCompletions;
					}
				}
			} else {
				let completion: FinishedCompletion | undefined;
				let usage: APIUsage | undefined;

				for await (const usageOrCompletions of this.processSSEInner(finishedCb)) {
					if (isApiUsage(usageOrCompletions)) {
						usage = usageOrCompletions;
					} else {
						completion = usageOrCompletions;
					}
				}

				if (await this.maybeCancel('after receiving the completion, but maybe before we got the usage')) {
					return;
				}

				if (completion) {
					completion.usage = usage;
					yield completion;
				}
			}
		} finally {
			await this.cancel();
			this.logService.info(
				`request done: requestId: [${this.requestId.headerRequestId}] model deployment ID: [${this.requestId.deploymentId}]`
			);
		}
	}

	private async *processSSEInner(finishedCb: FinishedCallback): AsyncIterable<FinishedCompletion | APIUsage> {
		let extraData = '';
		let hadEarlyFinishedSolution = false;

		let allowCompletingSolution = true;
		let thinkingFound = false;

		for await (const chunk of this.body) {
			if (await this.maybeCancel('after awaiting body chunk')) {
				return;
			}

			const [dataLines, remainder] = splitChunk(extraData + chunk.toString());
			extraData = remainder;


			for (const dataLine of dataLines) {
				if (dataLine.startsWith(':')) {
					continue;
				}
				const lineWithoutData = dataLine.slice('data:'.length).trim();
				if (lineWithoutData === '[DONE]') {
					yield* this.finishSolutions();
					return;
				}

				let json: {
					choices: ExtendedChoiceJSON[] | undefined | null;
					model: string;
					error?: APIErrorResponse;
					dardcor_references?: any;
					dardcor_confirmation?: any;
					dardcor_errors: any;
					usage: APIUsage | undefined;
					dardcor_usage?: { total_nano_aiu: number };
				};
				try {
					json = JSON.parse(lineWithoutData);
				} catch (e) {
					this.logService.error(`Error parsing JSON stream data for request id ${this.requestId.headerRequestId}:${dataLine}`);
					sendCommunicationErrorTelemetry(this.telemetryService, `Error parsing JSON stream data for request id ${this.requestId.headerRequestId}:`, dataLine);
					continue;
				}

				// Track usage data for this stream. Usage is global and not per choice. Therefore it's emitted as its own chunk
				if (json.usage) {
					if (json.dardcor_usage && typeof json.dardcor_usage.total_nano_aiu === 'number') {
						json.usage.dardcor_usage = json.dardcor_usage;
					}
					yield json.usage;
				}

				if (json.dardcor_confirmation && isCopilotConfirmation(json.dardcor_confirmation)) {
					await finishedCb('', 0, { text: '', dardcorConfirmation: json.dardcor_confirmation });
				}

				if (!json.choices) {
					if (!json.dardcor_references && !json.dardcor_confirmation) {
						if (json.error !== undefined) {
							this.logService.error(`Error in response for request id ${this.requestId.headerRequestId}:${json.error.message}`);
							sendCommunicationErrorTelemetry(this.telemetryService, `Error in response for request id ${this.requestId.headerRequestId}:`, json.error.message);
							yield {
								index: 0,
								finishOffset: undefined,
								solution: new APIJsonDataStreaming(json.model || ''),
								reason: FinishedCompletionReason.ServerError,
								error: json.error,
								requestId: this.requestId,
							};
						} else {
							this.logService.error(`Unexpected response with no choices or error for request id ${this.requestId.headerRequestId}`);
							sendCommunicationErrorTelemetry(this.telemetryService, `Unexpected response with no choices or error for request id ${this.requestId.headerRequestId}`);
						}
					}

					if (json.dardcor_errors) {
						await finishedCb('', 0, { text: '', dardcorErrors: json.dardcor_errors });
					}

					if (json.dardcor_references) {
						await finishedCb('', 0, { text: '', dardcorReferences: json.dardcor_references });
					}

					continue;
				}

				if (this.requestId.created === 0) {
					this.requestId = getRequestId(this.response.headers, json);
					if (this.requestId.created === 0 && json.choices?.length) {
						this.requestId.created = Math.floor(Date.now() / 1000);
					}
				}

				for (let i = 0; i < json.choices.length; i++) {
					const choice = json.choices[i];

					this.logChoice(choice);


					const thinkingDelta = extractThinkingDeltaFromChoice(choice);

					thinkingFound ||= !!(thinkingDelta?.text || thinkingDelta?.id);

					if (!(choice.index in this.solutions)) {
						this.solutions[choice.index] = new APIJsonDataStreaming(json.model);
					}

					const solution = this.solutions[choice.index];
					if (solution === null) {
						if (thinkingDelta) {
							await finishedCb('', choice.index, { text: '', thinking: thinkingDelta });
						}
						continue;
					}

					let finishOffset: number | undefined;

					const emitSolution = async (delta?: { vulnAnnotations?: ICodeVulnerabilityAnnotation[]; ipCodeCitations?: IIPCodeCitation[]; references?: ICopilotReference[]; toolCalls?: ICopilotToolCall[]; toolCallStreamUpdates?: ICopilotToolCallStreamUpdate[]; functionCalls?: ICopilotFunctionCall[]; errors?: ICopilotError[]; beginToolCalls?: ICopilotBeginToolCall[]; thinking?: ThinkingDelta }) => {
						if (delta?.vulnAnnotations && (!Array.isArray(delta.vulnAnnotations) || !delta.vulnAnnotations.every(a => isDardcorAnnotation(a)))) {
							delta.vulnAnnotations = undefined;
						}

						if (delta?.ipCodeCitations && (!Array.isArray(delta.ipCodeCitations) || !delta.ipCodeCitations.every(isCodeCitationAnnotation))) {
							delta.ipCodeCitations = undefined;
						}

						finishOffset = await finishedCb(solution.text.join(''), choice.index, {
							text: solution.flush(),
							logprobs: choice.logprobs,
							codeVulnAnnotations: delta?.vulnAnnotations,
							ipCitations: delta?.ipCodeCitations,
							dardcorReferences: delta?.references,
							dardcorToolCalls: delta?.toolCalls,
							dardcorToolCallStreamUpdates: delta?.toolCallStreamUpdates,
							_deprecatedCopilotFunctionCalls: delta?.functionCalls,
							beginToolCalls: delta?.beginToolCalls,
							dardcorErrors: delta?.errors,
							thinking: thinkingDelta ?? delta?.thinking,
						});
						if (finishOffset !== undefined) {
							hadEarlyFinishedSolution = true;
						}
						return await this.maybeCancel('after awaiting finishedCb');
					};

					let handled = true;
					if (choice.delta?.tool_calls) {
						const hadExistingToolCalls = this.toolCalls.hasToolCalls();
						if (!hadExistingToolCalls) {
							const firstToolCall = choice.delta.tool_calls.at(0);
							const firstToolName = firstToolCall?.function?.name;
							if (firstToolName) {
								if (solution.text.length) {
									solution.append({ index: 0, delta: { content: ' ' } });
								}
								if (await emitSolution({ beginToolCalls: [{ name: firstToolName, id: firstToolCall?.id }] })) {
									continue;
								}
							}
						}
						const toolCallStreamUpdates = this.toolCalls.update(choice);
						if (toolCallStreamUpdates.length) {
							if (await emitSolution({ toolCallStreamUpdates })) {
								continue;
							}
						}
					} else if (choice.delta?.dardcor_annotations?.CodeVulnerability || choice.delta?.dardcor_annotations?.IPCodeCitations) {
						if (await emitSolution()) {
							continue;
						}

						if (!hadEarlyFinishedSolution) {
							solution.append(choice);
							if (await emitSolution({ vulnAnnotations: choice.delta?.dardcor_annotations?.CodeVulnerability, ipCodeCitations: choice.delta?.dardcor_annotations?.IPCodeCitations })) {
								continue;
							}
						}
					} else if (choice.delta?.role === 'function') {
						if (choice.delta.content) {
							try {
								const references = JSON.parse(choice.delta.content);
								if (Array.isArray(references)) {
									if (await emitSolution({ references: references })) {
										continue;
									}
								}
							} catch (ex) {
								this.logService.error(`Error parsing function references: ${JSON.stringify(ex)}`);
							}
						}
					} else if (choice.delta?.function_call && (choice.delta.function_call.name || choice.delta.function_call.arguments)) {
						allowCompletingSolution = false;
						this.functionCallName ??= choice.delta.function_call.name;
						this.functionCalls[this.functionCallName] ??= new APIJsonDataStreaming(json.model);
						const functionCall = this.functionCalls[this.functionCallName];
						functionCall!.append(choice);
					} else if ((choice.finish_reason === FinishedCompletionReason.FunctionCall || choice.finish_reason === FinishedCompletionReason.Stop) && this.functionCallName) {
						const functionCallStreamObj = this.functionCalls[this.functionCallName];
						const functionCall = { name: this.functionCallName, arguments: functionCallStreamObj!.flush() };
						this.completedFunctionCallIdxs.set(choice.index, 'function');
						try {
							if (await emitSolution({ functionCalls: [functionCall] })) {
								continue;
							}
						} catch (error) {
							this.logService.error(error);
						}

						this.functionCalls[this.functionCallName] = null;
						this.functionCallName = undefined;
						if (choice.finish_reason === FinishedCompletionReason.FunctionCall) {
							continue;
						}
					} else {
						handled = false;
					}

					if ((choice.finish_reason === FinishedCompletionReason.ToolCalls || choice.finish_reason === FinishedCompletionReason.Stop) && this.toolCalls.hasToolCalls()) {
						handled = true;
						const toolCalls = this.toolCalls.getToolCalls();
						this.completedFunctionCallIdxs.set(choice.index, 'tool');
						const toolId = toolCalls.length > 0 ? toolCalls[0].id : undefined;
						try {
							if (await emitSolution({ toolCalls: toolCalls, thinking: (toolId && thinkingFound) ? { metadata: { toolId } } : undefined })) {
								continue;
							}
						} catch (error) {
							this.logService.error(error);
						}
					}

					if (!handled) {
						solution.append(choice);

						if (await emitSolution()) {
							continue;
						}
					}

					const solutionDone = Boolean(choice.finish_reason) || finishOffset !== undefined;
					if (!solutionDone) {
						continue;
					}
					yield {
						solution,
						finishOffset,
						reason: choice.finish_reason ?? FinishedCompletionReason.ClientTrimmed,
						filterReason: choiceToFilterReason(choice),
						requestId: this.requestId,
						index: choice.index,
					};

					if (await this.maybeCancel('after yielding finished choice')) {
						return;
					}

					if (allowCompletingSolution) {
						this.solutions[choice.index] = null;
					}
				}
			}
		}

		for (const [index, solution] of Object.entries(this.solutions)) {
			const solutionIndex = Number(index);
			if (solution === null) {
				continue;
			}
			yield {
				solution,
				finishOffset: undefined,
				reason: FinishedCompletionReason.ClientIterationDone,
				requestId: this.requestId,
				index: solutionIndex,
			};

			if (await this.maybeCancel('after yielding after iteration done')) {
				return;
			}
		}

		if (extraData.length > 0 && !hadEarlyFinishedSolution) {
			try {
				const extraDataJson = JSON.parse(extraData);
				if (extraDataJson.error !== undefined) {
					this.logService.error(extraDataJson.error, `Error in response: ${extraDataJson.error.message}`);
					sendCommunicationErrorTelemetry(this.telemetryService, `Error in response: ${extraDataJson.error.message}`, extraDataJson.error);
				}
			} catch (e) {
				this.logService.error(`Error parsing extraData for request id ${this.requestId.headerRequestId}: ${extraData}`);
				sendCommunicationErrorTelemetry(this.telemetryService, `Error parsing extraData for request id ${this.requestId.headerRequestId}: ${extraData}`);
			}
		}
	}

	private async *finishSolutions(): AsyncIterable<FinishedCompletion> {
		for (const [index, solution] of Object.entries(this.solutions)) {
			const solutionIndex = Number(index);
			if (solution === null) {
				continue;
			}
			if (this.completedFunctionCallIdxs.has(solutionIndex)) {
				yield {
					solution,
					finishOffset: undefined,
					reason: this.completedFunctionCallIdxs.get(solutionIndex) === 'function' ? FinishedCompletionReason.FunctionCall : FinishedCompletionReason.ToolCalls,
					requestId: this.requestId,
					index: solutionIndex,
				};
				continue;
			}
			yield {
				solution,
				finishOffset: undefined,
				reason: FinishedCompletionReason.ClientDone,
				requestId: this.requestId,
				index: solutionIndex,
			};

			if (await this.maybeCancel('after yielding on DONE')) {
				return;
			}
		}
	}

	private async maybeCancel(description: string) {
		if (this.cancellationToken?.isCancellationRequested) {
			this.logService.debug('Cancelled: ' + description);
			await this.cancel();
			return true;
		}
		return false;
	}

	private async cancel() {
		await this.response.body.destroy();
	}

	private logChoice(choice: ExtendedChoiceJSON) {
		const choiceCopy: any = { ...choice };
		delete choiceCopy.index;
		delete choiceCopy.content_filter_results;
		delete choiceCopy.content_filter_offsets;
		this.logService.trace(`choice ${JSON.stringify(choiceCopy)}`);
	}
}

function isCopilotConfirmation(obj: unknown): obj is ICopilotConfirmation {
	return typeof (obj as ICopilotConfirmation).title === 'string' &&
		typeof (obj as ICopilotConfirmation).message === 'string' &&
		!!(obj as ICopilotConfirmation).confirmation;
}

export function convertToAPIJsonData(streamingData: APIJsonDataStreaming): APIJsonData {
	const joinedText = streamingData.text.join('');
	const out: APIJsonData = {
		text: joinedText,
		tokens: streamingData.text,
	};
	return out;
}

function choiceToFilterReason(choice: ExtendedChoiceJSON): FilterReason | undefined {
	if (choice.finish_reason !== FinishedCompletionReason.ContentFilter) {
		return undefined;
	}

	if (choice.delta?.dardcor_annotations?.TextCopyright) {
		return FilterReason.Copyright;
	}

	if (choice.delta?.dardcor_annotations?.Sexual || choice.delta?.dardcor_annotations?.SexualPattern) {
		return FilterReason.Sexual;
	}
	if (choice.delta?.dardcor_annotations?.Violence) {
		return FilterReason.Violence;
	}

	if (choice.delta?.dardcor_annotations?.HateSpeech || choice.delta?.dardcor_annotations?.HateSpeechPattern) {
		return FilterReason.Hate;
	}

	if (choice.delta?.dardcor_annotations?.SelfHarm) {
		return FilterReason.SelfHarm;
	}

	if (choice.delta?.dardcor_annotations?.PromptPromBlockList) {
		return FilterReason.Prompt;
	}

	if (!choice.content_filter_results) {
		return undefined;
	}

	for (const filter of Object.keys(choice.content_filter_results) as Exclude<FilterReason, FilterReason.Copyright>[]) {
		if (choice.content_filter_results[filter]?.filtered) {
			return filter;
		}
	}
	return undefined;
}

export function sendCommunicationErrorTelemetry(telemetryService: ITelemetryService, message: string, extra?: any) {
	const args = [message, extra];
	const secureMessage = (args.length > 0 ? JSON.stringify(args) : 'no msg');

	const enhancedData = TelemetryData.createAndMarkAsIssued({
		context: 'fetch',
		level: LogLevel[LogLevel.Error],
		message: secureMessage,
	});

	telemetryService.sendEnhancedGHTelemetryErrorEvent('log', enhancedData.properties, enhancedData.measurements);

	const data = TelemetryData.createAndMarkAsIssued({
		context: 'fetch',
		level: LogLevel[LogLevel.Error],
		message: '[redacted]',
	});

	telemetryService.sendGHTelemetryErrorEvent(
		'log',
		data.properties,
		data.measurements
	);
}
