/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const GenAiOperationName = {
	CHAT: 'chat',
	INVOKE_AGENT: 'invoke_agent',
	EXECUTE_TOOL: 'execute_tool',
	EMBEDDINGS: 'embeddings',
	CONTENT_EVENT: 'content_event',
	EXECUTE_HOOK: 'execute_hook',
} as const;

export const GenAiTokenType = {
	INPUT: 'input',
	OUTPUT: 'output',
} as const;

export const GenAiAttr = {
	OPERATION_NAME: 'gen_ai.operation.name',
	PROVIDER_NAME: 'gen_ai.provider.name',

	REQUEST_MODEL: 'gen_ai.request.model',

	RESPONSE_MODEL: 'gen_ai.response.model',
	RESPONSE_ID: 'gen_ai.response.id',
	RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',

	USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
	USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
	USAGE_CACHE_READ_INPUT_TOKENS: 'gen_ai.usage.cache_read.input_tokens',
	USAGE_CACHE_CREATION_INPUT_TOKENS: 'gen_ai.usage.cache_creation.input_tokens',
	USAGE_REASONING_TOKENS: 'gen_ai.usage.reasoning_tokens',

	CONVERSATION_ID: 'gen_ai.conversation.id',

	TOKEN_TYPE: 'gen_ai.token.type',

	AGENT_NAME: 'gen_ai.agent.name',

	TOOL_NAME: 'gen_ai.tool.name',
	TOOL_TYPE: 'gen_ai.tool.type',
	TOOL_CALL_ID: 'gen_ai.tool.call.id',
} as const;

export const CopilotChatAttr = {
	TURN_INDEX: 'copilot_chat.turn.index',
	TIME_TO_FIRST_TOKEN: 'copilot_chat.time_to_first_token',
	CHAT_SESSION_ID: 'copilot_chat.chat_session_id',
	HOOK_TYPE: 'copilot_chat.hook_type',
	HOOK_INPUT: 'copilot_chat.hook_input',
	HOOK_OUTPUT: 'copilot_chat.hook_output',
	HOOK_RESULT_KIND: 'copilot_chat.hook_result_kind',
} as const;

export const CopilotCliSdkAttr = {
	HOOK_TYPE: 'github.copilot.hook.type',
	HOOK_INVOCATION_ID: 'github.copilot.hook.invocation_id',
} as const;
