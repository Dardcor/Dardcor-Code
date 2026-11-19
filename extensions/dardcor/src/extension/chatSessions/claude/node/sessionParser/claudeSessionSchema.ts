/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type Anthropic from '@anthropic-ai/sdk';
import {
	IValidator,
	ValidationError,
	ValidatorType,
	vArray,
	vBoolean,
	vEnum,
	vLiteral,
	vNullable,
	vNumber,
	vObj,
	vObjAny,
	vRequired,
	vString,
	vUnchecked,
	vUndefined,
	vUnion,
	vUnknown,
} from '../../../../../platform/configuration/common/validator';

export { IValidator, ValidationError, ValidatorType };


export function vIsoTimestamp(): IValidator<string> {
	return {
		validate(content: unknown) {
			if (typeof content !== 'string') {
				return { content: undefined, error: { message: `Expected ISO timestamp string, got ${typeof content}` } };
			}
			const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
			if (!isoPattern.test(content)) {
				return { content: undefined, error: { message: `Invalid ISO timestamp format: ${content}` } };
			}
			return { content, error: undefined };
		},
		toSchema() {
			return { type: 'string', format: 'date-time' };
		}
	};
}

export function vUuid(): IValidator<string> {
	return {
		validate(content: unknown) {
			if (typeof content !== 'string') {
				return { content: undefined, error: { message: `Expected UUID string, got ${typeof content}` } };
			}
			if (content.length === 0) {
				return { content: undefined, error: { message: 'Expected non-empty UUID string' } };
			}
			return { content, error: undefined };
		},
		toSchema() {
			return { type: 'string', format: 'uuid' };
		}
	};
}



function assertValidatorAssignable<_TValidator extends TSDKType, TSDKType>(): void { }

export const vTextBlock = vObj({
	type: vRequired(vLiteral('text')),
	text: vRequired(vString()),
	citations: vNullable(vArray(vUnchecked<Anthropic.TextCitation>())),
});
assertValidatorAssignable<ValidatorType<typeof vTextBlock>, Anthropic.TextBlock>();
export type TextBlock = Anthropic.TextBlock;

export const vThinkingBlock = vObj({
	type: vRequired(vLiteral('thinking')),
	thinking: vRequired(vString()),
	signature: vRequired(vString()),
});
assertValidatorAssignable<ValidatorType<typeof vThinkingBlock>, Anthropic.ThinkingBlock>();
export type ThinkingBlock = Anthropic.ThinkingBlock;

export const vToolUseBlock = vObj({
	type: vRequired(vLiteral('tool_use')),
	id: vRequired(vString()),
	name: vRequired(vString()),
	input: vRequired(vUnknown()),
});
assertValidatorAssignable<ValidatorType<typeof vToolUseBlock>, Anthropic.Beta.Messages.BetaToolUseBlock>();
export type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;

export const vToolResultBlock = vObj({
	type: vRequired(vLiteral('tool_result')),
	tool_use_id: vRequired(vString()),
	content: vUnion(
		vString(),
		vArray(vUnchecked<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.SearchResultBlockParam | Anthropic.DocumentBlockParam>()),
		vUndefined()
	),
	is_error: vBoolean(),
});
assertValidatorAssignable<ValidatorType<typeof vToolResultBlock>, Anthropic.ToolResultBlockParam>();
export type ToolResultBlock = Anthropic.ToolResultBlockParam;

const vBase64ImageSource = vObj({
	type: vRequired(vLiteral('base64')),
	media_type: vRequired(vEnum('image/jpeg', 'image/png', 'image/gif', 'image/webp')),
	data: vRequired(vString()),
});

const vURLImageSource = vObj({
	type: vRequired(vLiteral('url')),
	url: vRequired(vString()),
});

export const vImageBlock = vObj({
	type: vRequired(vLiteral('image')),
	source: vRequired(vUnion(vBase64ImageSource, vURLImageSource)),
});
assertValidatorAssignable<ValidatorType<typeof vImageBlock>, Anthropic.ImageBlockParam>();
export type ImageBlock = Anthropic.ImageBlockParam;

export const vUnknownContentBlock = vObj({
	type: vRequired(vString()),
});
export type UnknownContentBlock = { type: string };

export const vContentBlock = vUnion(
	vTextBlock,
	vThinkingBlock,
	vToolUseBlock,
	vToolResultBlock,
	vImageBlock,
	vUnknownContentBlock
);
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock | UnknownContentBlock;



export const vCacheCreation = vObj({
	ephemeral_1h_input_tokens: vNumber(),
	ephemeral_5m_input_tokens: vNumber(),
});
export type CacheCreation = ValidatorType<typeof vCacheCreation>;

export const vUsage = vObj({
	cache_creation: vNullable(vCacheCreation),
	cache_creation_input_tokens: vNumber(),
	cache_read_input_tokens: vNumber(),
	input_tokens: vNumber(),
	output_tokens: vNumber(),
});
export type Usage = ValidatorType<typeof vUsage>;



export const vUserMessageContent = vObj({
	role: vRequired(vLiteral('user')),
	content: vRequired(vUnion(vString(), vArray(vContentBlock))),
});
export type UserMessageContent = ValidatorType<typeof vUserMessageContent>;

export const vAssistantMessageContent = vObj({
	role: vRequired(vLiteral('assistant')),
	content: vRequired(vArray(vContentBlock)),
	id: vString(),
	model: vString(),
	type: vString(),
	stop_reason: vNullable(vString()),
	stop_sequence: vNullable(vString()),
	usage: vUsage,
	parent_tool_use_id: vNullable(vString()),
});
export type AssistantMessageContent = ValidatorType<typeof vAssistantMessageContent>;

interface SystemMessageContent {
	readonly role: 'system';
	readonly content: string;
}

export const SYNTHETIC_MODEL_ID = '<synthetic>';



export const vQueueOperationEntry = vObj({
	type: vRequired(vLiteral('queue-operation')),
	operation: vRequired(vEnum('dequeue', 'enqueue')),
	timestamp: vRequired(vIsoTimestamp()),
	sessionId: vRequired(vUuid()),
});
export type QueueOperationEntry = ValidatorType<typeof vQueueOperationEntry>;

const vCommonMessageFields = {
	uuid: vRequired(vUuid()),
	sessionId: vRequired(vUuid()),
	timestamp: vRequired(vIsoTimestamp()),
	parentUuid: vNullable(vUuid()),
	isSidechain: vBoolean(),
	userType: vString(),
	cwd: vString(),
	version: vString(),
	gitBranch: vString(),
	slug: vString(),
	agentId: vString(),
};

export const vUserMessageEntry = vObj({
	...vCommonMessageFields,
	type: vRequired(vLiteral('user')),
	message: vRequired(vUserMessageContent),
	toolUseResult: vUnion(vString(), vObjAny()),
	sourceToolAssistantUUID: vString(),
	isCompactSummary: vBoolean(),
});
export type UserMessageEntry = ValidatorType<typeof vUserMessageEntry>;

export const vAssistantMessageEntry = vObj({
	...vCommonMessageFields,
	type: vRequired(vLiteral('assistant')),
	message: vRequired(vAssistantMessageContent),
});
export type AssistantMessageEntry = ValidatorType<typeof vAssistantMessageEntry>;

export const vSummaryEntry = vObj({
	type: vRequired(vLiteral('summary')),
	summary: vRequired(vString()),
	leafUuid: vRequired(vUuid()),
});
export type SummaryEntry = ValidatorType<typeof vSummaryEntry>;

export const vCustomTitleEntry = vObj({
	type: vRequired(vLiteral('custom-title')),
	customTitle: vRequired(vString()),
	sessionId: vRequired(vUuid()),
});
export type CustomTitleEntry = ValidatorType<typeof vCustomTitleEntry>;

export const vChainNodeFields = vObj({
	uuid: vRequired(vUuid()),
	parentUuid: vNullable(vUuid()),
	logicalParentUuid: vNullable(vUuid()),
});



export const vMessageEntry = vUnion(
	vUserMessageEntry,
	vAssistantMessageEntry
);
export type MessageEntry = ValidatorType<typeof vMessageEntry>;



export type ImageMediaType = Anthropic.Messages.Base64ImageSource['media_type'];

const SUPPORTED_IMAGE_MEDIA_TYPES: Record<ImageMediaType, true> = {
	'image/jpeg': true,
	'image/png': true,
	'image/gif': true,
	'image/webp': true,
};

function isImageMediaType(value: string): value is ImageMediaType {
	return Object.hasOwn(SUPPORTED_IMAGE_MEDIA_TYPES, value);
}

export function toAnthropicImageMediaType(mimeType: string): ImageMediaType | undefined {
	const normalized = mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType.toLowerCase();
	return isImageMediaType(normalized) ? normalized : undefined;
}

export function isUserRequest(content: UserMessageContent['content']): boolean {
	if (typeof content === 'string') {
		return true;
	}
	if (!Array.isArray(content)) {
		return false;
	}
	return content.some(block => block.type !== 'tool_result');
}



export interface ChainNode {
	readonly uuid: string;
	readonly parentUuid: string | null;
	readonly raw: Record<string, unknown>;
	readonly lineNumber: number;
}

export interface StoredMessage {
	readonly uuid: string;
	readonly sessionId: string;
	readonly timestamp: Date;
	readonly parentUuid: string | null;
	readonly type: 'user' | 'assistant' | 'system';
	readonly message: UserMessageContent | AssistantMessageContent | SystemMessageContent;
	readonly isSidechain?: boolean;
	readonly userType?: string;
	readonly cwd?: string;
	readonly version?: string;
	readonly gitBranch?: string;
	readonly slug?: string;
	readonly agentId?: string;
}

export interface ISubagentSession {
	readonly agentId: string;
	readonly parentToolUseId?: string;
	readonly messages: readonly StoredMessage[];
	readonly timestamp: Date;
}

export interface IClaudeCodeSession extends IClaudeCodeSessionInfo {
	readonly messages: readonly StoredMessage[];
	readonly subagents: readonly ISubagentSession[];
}

export interface IClaudeCodeSessionInfo {
	readonly id: string;
	readonly label: string;
	readonly created: number;
	readonly lastRequestStarted?: number;
	readonly lastRequestEnded?: number;
	readonly folderName?: string;
	readonly cwd?: string;
	readonly gitBranch?: string;
}


