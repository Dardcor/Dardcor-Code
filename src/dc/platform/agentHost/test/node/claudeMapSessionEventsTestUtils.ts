/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type Anthropic from '@anthropic-ai/sdk';
import type { SDKAssistantMessage, SDKPartialAssistantMessage, SDKResultError, SDKResultSuccess, SDKSystemMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export type BetaRawContentBlockDeltaEvent = Anthropic.Beta.BetaRawContentBlockDeltaEvent;
export type BetaRawContentBlockStartEvent = Anthropic.Beta.BetaRawContentBlockStartEvent;
export type BetaRawContentBlockStopEvent = Anthropic.Beta.BetaRawContentBlockStopEvent;
export type BetaRawMessageStartEvent = Anthropic.Beta.BetaRawMessageStartEvent;
export type BetaRawMessageStopEvent = Anthropic.Beta.BetaRawMessageStopEvent;
export type BetaContentBlock = Anthropic.Beta.BetaContentBlock;

export const TEST_UUID = '11111111-2222-3333-4444-555555555555';

export function makeNonNullableUsage(): SDKResultSuccess['usage'] {
	return {
		cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
		inference_geo: 'unknown',
		input_tokens: 0,
		iterations: [],
		output_tokens: 0,
		server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
		service_tier: 'standard',
		speed: 'standard',
	};
}

export function makeSystemInitMessage(sessionId: string): SDKSystemMessage {
	return {
		type: 'system',
		subtype: 'init',
		apiKeySource: 'user',
		claude_code_version: '0.0.0-test',
		cwd: '/workspace',
		tools: [],
		mcp_servers: [],
		model: 'claude-test',
		permissionMode: 'default',
		slash_commands: [],
		output_style: 'default',
		skills: [],
		plugins: [],
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}

export function makeResultSuccess(sessionId: string): SDKResultSuccess {
	return {
		type: 'result',
		subtype: 'success',
		duration_ms: 0,
		duration_api_ms: 0,
		is_error: false,
		num_turns: 1,
		result: '',
		stop_reason: 'end_turn',
		total_cost_usd: 0,
		usage: makeNonNullableUsage(),
		modelUsage: {},
		permission_denials: [],
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}

export function makeResultError(sessionId: string, errors: string[]): SDKResultError {
	return {
		type: 'result',
		subtype: 'error_during_execution',
		duration_ms: 0,
		duration_api_ms: 0,
		is_error: true,
		num_turns: 1,
		stop_reason: null,
		total_cost_usd: 0,
		usage: makeNonNullableUsage(),
		modelUsage: {},
		permission_denials: [],
		errors,
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}


export function makeStreamEvent(
	sessionId: string,
	event: SDKPartialAssistantMessage['event'],
): SDKPartialAssistantMessage {
	return {
		type: 'stream_event',
		event,
		parent_tool_use_id: null,
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}

export function makeMessageStart(messageId: string = 'msg_test'): BetaRawMessageStartEvent {
	return {
		type: 'message_start',
		message: {
			id: messageId,
			type: 'message',
			role: 'assistant',
			model: 'claude-test',
			content: [],
			stop_reason: null,
			stop_sequence: null,
			stop_details: null,
			container: null,
			context_management: null,
			usage: {
				cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				inference_geo: 'unknown',
				input_tokens: 0,
				iterations: [],
				output_tokens: 0,
				server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
				service_tier: 'standard',
				speed: 'standard',
			},
		},
	};
}

export function makeContentBlockStartText(index: number): BetaRawContentBlockStartEvent {
	return {
		type: 'content_block_start',
		index,
		content_block: { type: 'text', text: '', citations: null },
	};
}

export function makeContentBlockStartThinking(index: number): BetaRawContentBlockStartEvent {
	return {
		type: 'content_block_start',
		index,
		content_block: { type: 'thinking', thinking: '', signature: '' },
	};
}

export function makeContentBlockStartToolUse(
	index: number,
	id: string,
	name: string,
): BetaRawContentBlockStartEvent {
	return {
		type: 'content_block_start',
		index,
		content_block: { type: 'tool_use', id, name, input: {} },
	};
}

export function makeTextDelta(index: number, text: string): BetaRawContentBlockDeltaEvent {
	return {
		type: 'content_block_delta',
		index,
		delta: { type: 'text_delta', text },
	};
}

export function makeThinkingDelta(index: number, thinking: string): BetaRawContentBlockDeltaEvent {
	return {
		type: 'content_block_delta',
		index,
		delta: { type: 'thinking_delta', thinking },
	};
}

export function makeInputJsonDelta(index: number, partialJson: string): BetaRawContentBlockDeltaEvent {
	return {
		type: 'content_block_delta',
		index,
		delta: { type: 'input_json_delta', partial_json: partialJson },
	};
}

export function makeContentBlockStop(index: number): BetaRawContentBlockStopEvent {
	return {
		type: 'content_block_stop',
		index,
	};
}

export function makeMessageStop(): BetaRawMessageStopEvent {
	return { type: 'message_stop' };
}

export function makeAssistantMessage(
	sessionId: string,
	content: BetaContentBlock[],
): SDKAssistantMessage {
	return {
		type: 'assistant',
		message: {
			id: 'msg_test',
			type: 'message',
			role: 'assistant',
			model: 'claude-test',
			content,
			stop_reason: 'end_turn',
			stop_sequence: null,
			stop_details: null,
			container: null,
			context_management: null,
			usage: {
				cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				inference_geo: 'unknown',
				input_tokens: 0,
				iterations: [],
				output_tokens: 0,
				server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
				service_tier: 'standard',
				speed: 'standard',
			},
		},
		parent_tool_use_id: null,
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}

export function makeUserToolResultMessage(
	sessionId: string,
	toolUseId: string,
	content: string | Array<{ type: 'text'; text: string }>,
	options?: { isError?: boolean },
): SDKUserMessage {
	return {
		type: 'user',
		message: {
			role: 'user',
			content: [
				{
					type: 'tool_result',
					tool_use_id: toolUseId,
					content,
					...(options?.isError ? { is_error: true } : {}),
				},
			],
		},
		parent_tool_use_id: null,
		isSynthetic: true,
		uuid: TEST_UUID,
		session_id: sessionId,
	};
}
