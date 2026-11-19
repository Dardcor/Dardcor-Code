/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { ICreateEndpointBodyOptions } from '../../networking/common/networking';


export function createThinkingMessage(thinkingId: string, thinkingText: string): Raw.ChatMessage {
	return {
		role: Raw.ChatRole.Assistant,
		content: [
			{
				type: Raw.ChatCompletionContentPartKind.Opaque,
				value: {
					type: 'thinking',
					thinking: {
						id: thinkingId,
						text: thinkingText
					}
				}
			}
		]
	};
}

export function createUserMessage(text: string): Raw.ChatMessage {
	return {
		role: Raw.ChatRole.User,
		content: [{ type: Raw.ChatCompletionContentPartKind.Text, text }]
	};
}

export function createAssistantMessage(text: string): Raw.ChatMessage {
	return {
		role: Raw.ChatRole.Assistant,
		content: [{ type: Raw.ChatCompletionContentPartKind.Text, text }]
	};
}

export function createTestOptions(messages: Raw.ChatMessage[]): ICreateEndpointBodyOptions {
	return {
		debugName: 'test',
		messages,
		requestId: 'test-req-123',
		postOptions: {},
		finishedCb: undefined,
		location: undefined as any
	};
}

export const ReasoningPropertyVerifiers = {
	hasOpenAICoTProperties(message: any, expectedId: string, expectedText: string): boolean {
		return message.cot_id === expectedId && message.cot_summary === expectedText;
	},

	hasCopilotReasoningProperties(message: any, expectedId: string, expectedText: string): boolean {
		return message.reasoning_opaque === expectedId && message.reasoning_text === expectedText;
	},

	hasNoReasoningProperties(message: any): boolean {
		return (
			message.cot_id === undefined &&
			message.cot_summary === undefined &&
			message.reasoning_opaque === undefined &&
			message.reasoning_text === undefined
		);
	}
};

export const TestThinkingData = {
	openai: {
		id: 'openai-thinking-123',
		text: 'OpenAI-style reasoning process'
	},
	dardcor: {
		id: 'dardcor-reasoning-456',
		text: 'Copilot-style reasoning analysis'
	},
	azure: {
		id: 'azure-thinking-789',
		text: 'Azure OpenAI reasoning content'
	},
	generic: {
		id: 'test-thinking-abc',
		text: 'Generic test reasoning text'
	}
} as const;
