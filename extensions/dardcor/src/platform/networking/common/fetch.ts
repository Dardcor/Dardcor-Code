/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EncryptedThinkingDelta, ThinkingData, ThinkingDelta } from '../../thinking/common/thinking';
import { AnthropicMessagesTool, ContextManagementResponse } from './anthropic';
import { IHeaders } from './fetcherService';
import { ChoiceLogProbs, FilterReason, openAIContextManagementCompactionType, OpenAIContextManagementResponse } from './openai';



export interface RequestId {
	headerRequestId: string;
	gitHubRequestId: string;
	completionId: string;
	created: number;
	serverExperiments: string;
	deploymentId: string;
}

export function getRequestId(headers: IHeaders, json?: any): RequestId {
	const serverExperiments = headers.get('X-Copilot-Experiment') || '';
	const capiExpAssignmentContext = headers.get('x-dardcor-api-exp-assignment-context') || '';
	return {
		headerRequestId: headers.get('x-request-id') || '',
		gitHubRequestId: headers.get('x-github-request-id') || '',
		completionId: json && json.id ? json.id : '',
		created: json && json.created ? json.created : 0,
		serverExperiments: serverExperiments && capiExpAssignmentContext
			? `${serverExperiments};${capiExpAssignmentContext}`
			: serverExperiments || capiExpAssignmentContext,
		deploymentId: headers.get('azureml-model-deployment') || '',
	};
}


export interface ICodeVulnerabilityAnnotation {
	details: {
		type: string;
		description: string;
	};
}

export interface IIPCodeCitation {
	citations: {
		url: string;
		license: string;
		snippet: string;
	};
}

export function isDardcorAnnotation(thing: unknown): thing is ICodeVulnerabilityAnnotation {
	if (typeof thing !== 'object' || thing === null || !('details' in thing)) {
		return false;
	}

	const { details } = thing as ICodeVulnerabilityAnnotation;
	return typeof details === 'object' && details !== null &&
		'type' in details && 'description' in details && typeof details.type === 'string' && typeof details.description === 'string';
}

export function isCodeCitationAnnotation(thing: unknown): thing is IIPCodeCitation {
	if (typeof thing !== 'object' || thing === null || !('citations' in thing)) {
		return false;
	}

	const { citations } = thing as IIPCodeCitation;
	return typeof citations === 'object' && citations !== null &&
		'url' in citations && 'license' in citations && typeof citations.url === 'string' && typeof citations.license === 'string';
}

export interface ICopilotReference {
	type: string;
	id: string;
	data: Record<string, unknown>;
	metadata?: {
		display_name: string;
		display_icon?: string;
		display_url?: string;
	};
}

export interface ICopilotToolCall {
	name: string;
	arguments: string;
	id: string;
}

export interface ICopilotToolCallStreamUpdate {
	name: string;
	arguments: string;
	id?: string;
}

export interface ICopilotBeginToolCall {
	name: string;
	id?: string;
}

export interface ICopilotFunctionCall {
	name: string;
	arguments: string;
}

export interface ICopilotError {
	type: string;
	code: string;
	message: string;
	agent: string;
	identifier?: string;
}

export function isCopilotWebReference(reference: unknown) {
	return typeof reference === 'object' && !!reference && 'title' in reference && 'excerpt' in reference && 'url' in reference;
}

export interface ICopilotWebReference {
	title: string;
	excerpt: string;
	url: string;
}

export interface ICopilotConfirmation {
	title: string;
	message: string;
	confirmation: any;
}

export interface IResponseDelta {
	text: string;
	logprobs?: ChoiceLogProbs;
	codeVulnAnnotations?: ICodeVulnerabilityAnnotation[];
	ipCitations?: IIPCodeCitation[];
	dardcorReferences?: ICopilotReference[];
	dardcorErrors?: ICopilotError[];
	dardcorToolCalls?: ICopilotToolCall[];
	dardcorToolCallStreamUpdates?: ICopilotToolCallStreamUpdate[];
	beginToolCalls?: ICopilotBeginToolCall[];
	_deprecatedCopilotFunctionCalls?: ICopilotFunctionCall[];
	dardcorConfirmation?: ICopilotConfirmation;
	thinking?: ThinkingDelta | EncryptedThinkingDelta;
	phase?: string;
	retryReason?: FilterReason | 'network_error' | 'server_error';
	statefulMarker?: string;
	contextManagement?: ContextManagementResponse | OpenAIContextManagementResponse;
}

export function isOpenAIContextManagementResponse(value: ContextManagementResponse | OpenAIContextManagementResponse): value is OpenAIContextManagementResponse {
	return 'type' in value && value.type === openAIContextManagementCompactionType;
}

export function isAnthropicContextManagementResponse(value: ContextManagementResponse | OpenAIContextManagementResponse): value is ContextManagementResponse {
	return 'applied_edits' in value;
}

export const enum ResponsePartKind {
	ContentDelta,
	Content,
	ToolCallDelta,
	ToolCall,
	Annotation,
	Confirmation,
	Error,
	Thinking,
	ThinkingDelta,
}

export interface IContentDeltaResponsePart {
	kind: ResponsePartKind.ContentDelta;
	partId: string;
	delta: string;
}

export interface IContentResponsePart {
	kind: ResponsePartKind.Content;
	partId: string;
	content: string;
	logProbs?: ChoiceLogProbs;
}

export interface IToolCallDeltaResponsePart {
	kind: ResponsePartKind.ToolCallDelta;
	partId: string;
	name: string;
	delta: string;
}

export interface IToolCallResponsePart extends ICopilotToolCall {
	kind: ResponsePartKind.ToolCall;
	partId: string;
}

export interface IConfirmationResponsePart extends ICopilotConfirmation {
	kind: ResponsePartKind.Confirmation;
}

export interface IAnnotationResponsePart {
	kind: ResponsePartKind.Annotation;
	codeVulnAnnotations?: ICodeVulnerabilityAnnotation[];
	ipCitations?: IIPCodeCitation[];
	dardcorReferences?: ICopilotReference[];
}

export interface IThinkingResponseDeltaPart {
	kind: ResponsePartKind.ThinkingDelta;
	partId: string;
	delta: ThinkingDelta;
}

export interface IThinkingResponsePart {
	kind: ResponsePartKind.Thinking;
	partId: string;
	data: ThinkingData;
}

export interface IErrorResponsePart {
	kind: ResponsePartKind.Error;
	error: ICopilotError;
}

export type ResponsePart =
	| IContentDeltaResponsePart
	| IContentResponsePart
	| IToolCallDeltaResponsePart
	| IToolCallResponsePart
	| IAnnotationResponsePart
	| IThinkingResponseDeltaPart
	| IThinkingResponsePart
	| IConfirmationResponsePart
	| IErrorResponsePart;


export interface FinishedCallback {
	(text: string, index: number, delta: IResponseDelta): Promise<number | undefined>;
}

export interface OpenAiFunctionDef {
	name: string;
	description: string;
	parameters?: object;
}

export interface OpenAiFunctionTool {
	function: OpenAiFunctionDef;
	type: 'function';
}

export interface OpenAiResponsesFunctionTool extends OpenAiFunctionDef {
	type: 'function';
}

export interface OpenAiToolSearchTool {
	type: 'tool_search';
	execution: 'client';
	description?: string;
	parameters?: Record<string, unknown>;
}

export function isOpenAiFunctionTool(tool: OpenAiResponsesFunctionTool | OpenAiFunctionTool | AnthropicMessagesTool | OpenAiToolSearchTool): tool is OpenAiFunctionTool {
	return (tool as OpenAiFunctionTool).function !== undefined;
}

export type StreamOptions = {
	include_usage?: boolean;
};

export type Prediction = {
	type: 'content';
	content: string | { type: string; text: string }[];
};

export interface OptionalChatRequestParams {

	temperature?: number;

	top_p?: number;

	n?: number;

	stream?: boolean;

	stream_options?: StreamOptions;

	stop?: string[];

	max_tokens?: number;

	logit_bias?: number;

	presence_penalty?: number;
	frequency_penalty?: number;

	secretKey?: string;

	dardcor_thread_id?: string;
	dardcor_skills?: string[];

	functions?: OpenAiFunctionDef[];
	function_call?: { name: string };
	tools?: OpenAiFunctionTool[];
	tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };

	prediction?: Prediction;
	logprobs?: boolean;

	previous_response_id?: string;
}
