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

export const GenAiProviderName = {
	GITHUB: 'github',
	OPENAI: 'openai',
	ANTHROPIC: 'anthropic',
	AZURE_AI_OPENAI: 'azure.ai.openai',
	GEMINI: 'gemini',
} as const;

export const GenAiTokenType = {
	INPUT: 'input',
	OUTPUT: 'output',
} as const;

export const GenAiToolType = {
	FUNCTION: 'function',
	EXTENSION: 'extension',
} as const;

export const GenAiAttr = {
	OPERATION_NAME: 'gen_ai.operation.name',
	PROVIDER_NAME: 'gen_ai.provider.name',

	REQUEST_MODEL: 'gen_ai.request.model',
	REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
	REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
	REQUEST_TOP_P: 'gen_ai.request.top_p',
	REQUEST_FREQUENCY_PENALTY: 'gen_ai.request.frequency_penalty',
	REQUEST_PRESENCE_PENALTY: 'gen_ai.request.presence_penalty',
	REQUEST_SEED: 'gen_ai.request.seed',
	REQUEST_STOP_SEQUENCES: 'gen_ai.request.stop_sequences',
	REQUEST_STREAM: 'gen_ai.request.stream',

	RESPONSE_MODEL: 'gen_ai.response.model',
	RESPONSE_ID: 'gen_ai.response.id',
	RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',
	RESPONSE_TIME_TO_FIRST_CHUNK: 'gen_ai.response.time_to_first_chunk',

	USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
	USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
	USAGE_CACHE_READ_INPUT_TOKENS: 'gen_ai.usage.cache_read.input_tokens',
	USAGE_CACHE_CREATION_INPUT_TOKENS: 'gen_ai.usage.cache_creation.input_tokens',
	USAGE_REASONING_TOKENS: 'gen_ai.usage.reasoning_tokens',
	USAGE_REASONING_OUTPUT_TOKENS: 'gen_ai.usage.reasoning.output_tokens',

	CONVERSATION_ID: 'gen_ai.conversation.id',
	OUTPUT_TYPE: 'gen_ai.output.type',

	TOKEN_TYPE: 'gen_ai.token.type',

	AGENT_NAME: 'gen_ai.agent.name',
	AGENT_ID: 'gen_ai.agent.id',
	AGENT_VERSION: 'gen_ai.agent.version',
	AGENT_DESCRIPTION: 'gen_ai.agent.description',

	TOOL_NAME: 'gen_ai.tool.name',
	TOOL_TYPE: 'gen_ai.tool.type',
	TOOL_CALL_ID: 'gen_ai.tool.call.id',
	TOOL_DESCRIPTION: 'gen_ai.tool.description',
	TOOL_CALL_ARGUMENTS: 'gen_ai.tool.call.arguments',
	TOOL_CALL_RESULT: 'gen_ai.tool.call.result',

	INPUT_MESSAGES: 'gen_ai.input.messages',
	OUTPUT_MESSAGES: 'gen_ai.output.messages',
	SYSTEM_INSTRUCTIONS: 'gen_ai.system_instructions',
	TOOL_DEFINITIONS: 'gen_ai.tool.definitions',
} as const;

export const DardcorChatAttr = {
	LOCATION: 'dardcor_chat.location',
	INTENT: 'dardcor_chat.intent',
	TURN_INDEX: 'dardcor_chat.turn.index',
	TURN_COUNT: 'dardcor_chat.turn_count',
	TOOL_CALL_ROUND: 'dardcor_chat.tool_call_round',
	API_TYPE: 'dardcor_chat.api_type',
	FETCHER: 'dardcor_chat.fetcher',
	DEBUG_NAME: 'dardcor_chat.debug_name',
	ENDPOINT_TYPE: 'dardcor_chat.endpoint_type',
	MAX_PROMPT_TOKENS: 'dardcor_chat.request.max_prompt_tokens',
	TIME_TO_FIRST_TOKEN: 'dardcor_chat.time_to_first_token',
	SESSION_ID: 'dardcor_chat.session_id',
	SERVER_REQUEST_ID: 'dardcor_chat.server_request_id',
	CANCELED: 'dardcor_chat.canceled',
	REASONING_CONTENT: 'dardcor_chat.reasoning_content',
	USER_REQUEST: 'dardcor_chat.user_request',
	REQUEST_OPTIONS: 'dardcor_chat.request.options',
	REQUEST_SHAPE: 'dardcor_chat.request.shape',
	PROMPT_CONTEXT: 'dardcor_chat.prompt_context',
	PROMPT_INSTRUCTIONS: 'dardcor_chat.prompt_instructions',
	CHAT_SESSION_ID: 'dardcor_chat.chat_session_id',
	PARENT_CHAT_SESSION_ID: 'dardcor_chat.parent_chat_session_id',
	DEBUG_LOG_LABEL: 'dardcor_chat.debug_log_label',
	MARKDOWN_CONTENT: 'dardcor_chat.markdown_content',
	EDIT_SOURCE: 'dardcor_chat.edit.source',
	EDIT_OUTCOME: 'dardcor_chat.edit.outcome',
	LANGUAGE_ID: 'dardcor_chat.language_id',
	TIME_DELAY_MS: 'dardcor_chat.time_delay_ms',
	HAS_REMAINING_EDITS: 'dardcor_chat.has_remaining_edits',
	REPO_HEAD_BRANCH_NAME: 'dardcor_chat.repo.head_branch_name',
	REPO_HEAD_COMMIT_HASH: 'dardcor_chat.repo.head_commit_hash',
	REPO_REMOTE_URL: 'dardcor_chat.repo.remote_url',
	FILE_RELATIVE_PATH: 'dardcor_chat.file.relative_path',
	HOOK_TYPE: 'dardcor_chat.hook_type',
	HOOK_INPUT: 'dardcor_chat.hook_input',
	HOOK_OUTPUT: 'dardcor_chat.hook_output',
	HOOK_RESULT_KIND: 'dardcor_chat.hook_result_kind',
	MODE_NAME: 'dardcor_chat.mode_name',
	TOTAL_COST_USD: 'dardcor_chat.total_cost_usd',
	DARDCOR_USAGE_NANO_AIU: 'dardcor_chat.dardcor_usage_nano_aiu',
} as const;

export type EditSource = 'inline_chat' | 'chat_editing' | 'chat_editing_hunk' | 'apply_patch' | 'replace_string' | 'code_mapper';
export type EditOutcome = 'accepted' | 'rejected' | 'saved' | 'unknown';

export const StdAttr = {
	ERROR_TYPE: 'error.type',
	SERVER_ADDRESS: 'server.address',
	SERVER_PORT: 'server.port',
} as const;

export const DardcorSdkAttr = {
	HOOK_TYPE: 'github.dardcor.hook.type',
	HOOK_INVOCATION_ID: 'github.dardcor.hook.invocation_id',
} as const;

export const DardcorAttr = {
	AGENT_TYPE: 'github.dardcor.agent.type',

	CLOUD_BACKEND_VERSION: 'github.dardcor.cloud.backend_version',

	GIT_REPOSITORY: 'github.dardcor.git.repository',
	GIT_BRANCH: 'github.dardcor.git.branch',
	GIT_COMMIT_SHA: 'github.dardcor.git.commit_sha',
	GITHUB_ORG: 'github.dardcor.github.org',

	HOOK_DECISION: 'github.dardcor.hook.decision',
	HOOK_DURATION_SECONDS: 'github.dardcor.hook.duration',
	HOOK_TOOL_NAMES: 'github.dardcor.hook.tool_names',

	MCP_SERVER_NAME_HASH: 'github.dardcor.mcp.server.name_hash',
	MCP_SERVER_NAME: 'github.dardcor.mcp.server.name',

	TOOL_PARAM_COMMAND: 'github.dardcor.tool.parameters.command',
	TOOL_PARAM_FILE_PATH: 'github.dardcor.tool.parameters.file_path',
	TOOL_PARAM_EDIT_TYPE: 'github.dardcor.tool.parameters.edit_type',
	TOOL_PARAM_SKILL_NAME: 'github.dardcor.tool.parameters.skill_name',
	TOOL_PARAM_MCP_SERVER_NAME_HASH: 'github.dardcor.tool.parameters.mcp_server_name_hash',
	TOOL_PARAM_MCP_SERVER_NAME: 'github.dardcor.tool.parameters.mcp_server_name',
	TOOL_PARAM_MCP_TOOL_NAME: 'github.dardcor.tool.parameters.mcp_tool_name',
} as const;

export type AgentType = 'builtin' | 'plugin' | 'custom';
export type HookDecision = 'block' | 'approve' | 'non_blocking_error' | 'pass';
export type EditOperationType = 'create' | 'update' | 'str_replace' | 'insert';

export const TOOL_PARAM_COMMAND_MAX_LEN = 256;

export const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
	'bash',
	'powershell',
	'local_shell',
	'runInTerminal',
	'run_in_terminal',
	'Bash',
]);

export const FILE_TOOL_NAMES: ReadonlySet<string> = new Set([
	'view',
	'create',
	'edit',
	'str_replace',
	'str_replace_editor',
	'insert',
	'readFile',
	'createFile',
	'replaceString',
	'applyPatch',
	'read_file',
	'create_file',
	'apply_patch',
	'insert_edit_into_file',
	'replace_string_in_file',
	'multi_replace_string_in_file',
	'edit_notebook_file',
	'Read',
	'Edit',
	'MultiEdit',
	'Write',
	'NotebookEdit',
]);
