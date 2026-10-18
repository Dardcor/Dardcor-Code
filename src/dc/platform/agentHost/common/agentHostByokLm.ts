/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';


export interface IByokLmTextPart {
	readonly type: 'text';
	readonly text: string;
}

export type ByokLmImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/bmp';

export interface IByokLmImagePart {
	readonly type: 'image';
	readonly mimeType: ByokLmImageMimeType;
	readonly data: string;
}

export type IByokLmContentPart = IByokLmTextPart | IByokLmImagePart;

export interface IByokLmMessageItem {
	readonly type: 'message';
	readonly role: 'system' | 'developer' | 'user' | 'assistant';
	readonly content: IByokLmContentPart[];
}

export interface IByokLmReasoningItem {
	readonly type: 'reasoning';
	readonly id?: string;
	readonly summary: string[];
	readonly encryptedContent?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface IByokLmFunctionCallItem {
	readonly type: 'function_call';
	readonly callId: string;
	readonly name: string;
	readonly argumentsJson: string;
}

export interface IByokLmFunctionCallOutputItem {
	readonly type: 'function_call_output';
	readonly callId: string;
	readonly output: string;
}

export interface IByokLmCustomToolCallItem {
	readonly type: 'custom_tool_call';
	readonly callId: string;
	readonly name: string;
	readonly input: string;
}

export interface IByokLmCustomToolCallOutputItem {
	readonly type: 'custom_tool_call_output';
	readonly callId: string;
	readonly output: string;
}

export type IByokLmInputItem =
	IByokLmMessageItem |
	IByokLmReasoningItem |
	IByokLmFunctionCallItem |
	IByokLmFunctionCallOutputItem |
	IByokLmCustomToolCallItem |
	IByokLmCustomToolCallOutputItem;

export interface IByokLmFunctionTool {
	readonly type: 'function';
	readonly name: string;
	readonly description?: string;
	readonly parametersSchema?: object;
}

export interface IByokLmCustomTool {
	readonly type: 'custom';
	readonly name: string;
	readonly description?: string;
}

export type IByokLmTool = IByokLmFunctionTool | IByokLmCustomTool;

export interface IByokLmChatRequest {
	readonly vendor: string;
	readonly modelId: string;
	readonly instructions?: string;
	readonly input: IByokLmInputItem[];
	readonly tools?: IByokLmTool[];
	readonly previousResponseId?: string;
	readonly reasoningEffort?: string;
	readonly modelOptions?: Record<string, unknown>;
}

export interface IByokLmOutputMessageItem {
	readonly type: 'message';
	readonly content: IByokLmTextPart[];
}

export type IByokLmOutputItem =
	IByokLmOutputMessageItem |
	IByokLmReasoningItem |
	IByokLmFunctionCallItem |
	IByokLmCustomToolCallItem;

export interface IByokLmChatResult {
	readonly output: IByokLmOutputItem[];
	readonly responseId?: string;
	readonly usage?: {
		readonly inputTokens?: number;
		readonly outputTokens?: number;
		readonly reasoningTokens?: number;
	};
	readonly error?: string;
}

export interface IByokLmModelInfo {
	readonly vendor: string;
	readonly id: string;
	readonly name?: string;
	readonly modelIdentifier?: string;
	readonly maxContextWindowTokens?: number;
	readonly supportsVision?: boolean;
	readonly supportedReasoningEfforts?: readonly string[];
	readonly defaultReasoningEffort?: string;
}

export function getByokLmSelectionModelId(model: IByokLmModelInfo): string {
	const vendorPrefix = `${model.vendor}/`;
	return model.modelIdentifier?.startsWith(vendorPrefix)
		? model.modelIdentifier.slice(vendorPrefix.length)
		: model.id;
}

export function getByokLmAgentModelId(model: IByokLmModelInfo): string {
	return `${model.vendor}/${getByokLmSelectionModelId(model)}`;
}

export function resolveByokLmEnablement(rootConfigValue: boolean | undefined): { readonly enabled: boolean; readonly trace: string } {
	const enabled = rootConfigValue === true;
	return {
		enabled,
		trace: `enabled: ${enabled} (root config: ${rootConfigValue ?? 'unset'})`,
	};
}

export const IAgentHostByokLmHandler = createDecorator<IAgentHostByokLmHandler>('agentHostByokLmHandler');

export interface IAgentHostByokLmHandler {
	readonly _serviceBrand: undefined;

	readonly onDidChangeModels?: Event<void>;

	chat(request: IByokLmChatRequest, token: CancellationToken): Promise<IByokLmChatResult>;

	listModels(token: CancellationToken): Promise<IByokLmModelInfo[]>;
}

export interface IByokLmBridgeConnection {
	chat(request: IByokLmChatRequest): Promise<IByokLmChatResult>;
	readonly onDidChangeModels: Event<IByokLmModelInfo[]>;
}
