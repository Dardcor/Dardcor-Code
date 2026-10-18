/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OpenAI, OutputMode, Raw, toMode } from '@vscode/prompt-tsx';
import { ChatCompletionContentPartImage } from '@vscode/prompt-tsx/dist/base/output/openaiTypes';
import { ChatCompletionContentPartKind } from '@vscode/prompt-tsx/dist/base/output/rawTypes';
import { rawPartAsThinkingData } from '../../endpoint/common/thinkingDataContainer';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { ThinkingData, ThinkingDataInMessage } from '../../thinking/common/thinking';
import { ICopilotReference, RequestId } from './fetch';

export interface APILogprobs {
	text_offset: number[];
	token_logprobs: number[];
	top_logprobs?: { [key: string]: number }[];
	tokens: string[];
}

export interface APIUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_tokens_details?: {
		cached_tokens: number;
		cache_creation_input_tokens?: number;
		anthropic_cache_creation?: {
			ephemeral_1h_input_tokens?: number;
			ephemeral_5m_input_tokens?: number;
		};
	};
	completion_tokens_details?: {
		reasoning_tokens: number;
		accepted_prediction_tokens: number;
		rejected_prediction_tokens: number;
	};
	dardcor_usage?: {
		total_nano_aiu: number;
	};
}

export function isApiUsage(obj: unknown): obj is APIUsage {
	return typeof (obj as APIUsage).prompt_tokens === 'number' &&
		typeof (obj as APIUsage).completion_tokens === 'number' &&
		typeof (obj as APIUsage).total_tokens === 'number';
}

export function nanoAiuToCredits(nanoAiu: number | undefined): number | undefined {
	return typeof nanoAiu === 'number' && nanoAiu >= 0 ? nanoAiu / 1_000_000_000 : undefined;
}


export interface APIJsonData {
	text: string;
	tokens: readonly string[];
	logprobs?: APILogprobs;
}

export interface APIErrorResponse {
	code: number;
	message: string;
	metadata?: Record<string, any>;
}

export const openAIContextManagementCompactionType = 'compaction';

export const modelsWithoutResponsesContextManagement = new Set(['gpt-5', 'gpt-5.1', 'gpt-5.2']);



export interface OpenAIContextManagement {
	type: typeof openAIContextManagementCompactionType;
	compact_threshold: number;
}


export interface OpenAIContextManagementResponse {
	encrypted_content: string;
	type: typeof openAIContextManagementCompactionType;
	id: string;
}


export enum ChatRole {
	System = 'system',
	User = 'user',
	Assistant = 'assistant',
	Function = 'function',
	Tool = 'tool'
}


export type CAPIChatMessage = OpenAI.ChatMessage & {
	dardcor_references?: ICopilotReference[];
	dardcor_confirmations?: { state: string; confirmation: any }[];

	dardcor_cache_control?: {
		'type': 'ephemeral';
	};
} & ThinkingDataInMessage;

export function getCAPITextPart(content: string | OpenAI.ChatCompletionContentPart[] | OpenAI.ChatCompletionContentPart): string {
	if (Array.isArray(content)) {
		return content.map((part) => getCAPITextPart(part)).join('');
	} else if (typeof content === 'string') {
		return content;
	} else if (typeof content === 'object' && 'text' in content) {
		return content.text;
	} else {
		return '';
	}
}

export type RawMessageConversionCallback = (message: CAPIChatMessage, thinkingData?: ThinkingData) => void;
export function rawMessageToCAPI(message: Raw.ChatMessage, callback?: RawMessageConversionCallback): CAPIChatMessage;
export function rawMessageToCAPI(message: Raw.ChatMessage[], callback?: RawMessageConversionCallback): CAPIChatMessage[];
export function rawMessageToCAPI(message: Raw.ChatMessage[] | Raw.ChatMessage, callback?: RawMessageConversionCallback): CAPIChatMessage | CAPIChatMessage[] {
	if (Array.isArray(message)) {
		return message.map(m => rawMessageToCAPI(m, callback));
	}

	const out: CAPIChatMessage = toMode(OutputMode.OpenAI, message);
	if ('dardcor_references' in message) {
		out.dardcor_references = (message as any).dardcor_references;
	}
	if ('dardcor_confirmations' in message) {
		out.dardcor_confirmations = (message as any).dardcor_confirmations;
	}
	if (typeof out.content === 'string') {
		out.content = out.content.trimEnd();
	} else {
		for (let i = 0; i < out.content.length; i++) {
			const part = out.content[i];
			if (part.type === 'text') {
				part.text = part.text.trimEnd();
			} else if (part.type === 'image_url' && Array.isArray(message.content) && i < message.content.length) {
				const rawPart = message.content[i] as Raw.ChatCompletionContentPart;
				if (rawPart?.type === Raw.ChatCompletionContentPartKind.Image && rawPart.imageUrl?.mediaType) {
					const { mediaType, ...rawImageUrl } = rawPart.imageUrl;
					(part.image_url as ChatCompletionContentPartImage.ImageURL & { media_type: string }) = {
						...rawImageUrl,
						media_type: mediaType
					};
				}
			}
		}
	}

	if (message.content.find(part => part.type === ChatCompletionContentPartKind.CacheBreakpoint)) {
		out.dardcor_cache_control = { type: 'ephemeral' };
	}

	for (const content of message.content) {
		if (content.type === Raw.ChatCompletionContentPartKind.Opaque) {
			const data = rawPartAsThinkingData(content);
			if (callback && data) {
				callback(out, data);
			}
		}
	}

	return out;
}

export enum FinishedCompletionReason {
	Stop = 'stop',
	Length = 'length',
	FunctionCall = 'function_call',
	ToolCalls = 'tool_calls',
	ContentFilter = 'content_filter',
	ServerError = 'error',
	ClientTrimmed = 'client-trimmed',
	ClientIterationDone = 'Iteration Done',
	ClientDone = 'DONE',
}

export interface IToolCall {
	index: number;
	id?: string;
	function?: { name: string; arguments: string };
}

export enum FilterReason {
	Hate = 'hate',
	SelfHarm = 'self_harm',
	Sexual = 'sexual',
	Violence = 'violence',
	Copyright = 'snippy',
	Prompt = 'prompt'
}

export interface ChatCompletion {
	message: Raw.ChatMessage;
	choiceIndex: number;
	requestId: RequestId;
	tokens: readonly string[];
	usage: APIUsage | undefined;
	model: string;
	blockFinished: boolean;
	finishReason: FinishedCompletionReason;
	filterReason?: FilterReason;
	telemetryData: TelemetryData;
	error?: APIErrorResponse;
}

export interface ChoiceLogProbs {
	content: ChoiceLogProbsContent[];
}

export interface TokenLogProb {
	bytes: number[];
	token: string;
	logprob: number;
}

export interface ChoiceLogProbsContent extends TokenLogProb {
	top_logprobs: TokenLogProb[];
}
