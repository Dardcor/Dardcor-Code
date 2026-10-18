/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


const CAPI = '${capi}';

export interface IStubResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

interface IStubModel {
	readonly id: string;
	readonly vendor: string;
	readonly supportedEndpoints: readonly string[];
	readonly maxContextWindowTokens: number;
	readonly maxOutputTokens: number;
	readonly maxPromptTokens: number;
	readonly vision?: boolean;
	readonly isChatDefault?: boolean;
	readonly isChatFallback?: boolean;
}

const STUB_MODELS: readonly IStubModel[] = [
	{ id: 'gpt-5', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 400000, maxOutputTokens: 128000, maxPromptTokens: 272000, vision: true },
	{ id: 'gpt-5-mini', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 400000, maxOutputTokens: 128000, maxPromptTokens: 272000, vision: true },
	{ id: 'gpt-5-codex', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 400000, maxOutputTokens: 128000, maxPromptTokens: 272000, vision: true },
	{ id: 'gpt-5.1', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 400000, maxOutputTokens: 128000, maxPromptTokens: 272000, vision: true },
	{ id: 'gpt-5.1-codex', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 400000, maxOutputTokens: 128000, maxPromptTokens: 272000, vision: true },
	{ id: 'gpt-5.1-codex-mini', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 400000, maxOutputTokens: 128000, maxPromptTokens: 272000, vision: true },
	{ id: 'gpt-5.6-sol', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 1050000, maxOutputTokens: 128000, maxPromptTokens: 922000, vision: true },
	{ id: 'gpt-5.6-luna', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 1050000, maxOutputTokens: 128000, maxPromptTokens: 922000, vision: true },
	{ id: 'gpt-5.6-terra', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 1050000, maxOutputTokens: 128000, maxPromptTokens: 922000, vision: true },
	{ id: 'claude-haiku-4.5', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 200000, maxOutputTokens: 32000, maxPromptTokens: 168000, vision: true },
	{ id: 'claude-sonnet-4.5', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 200000, maxOutputTokens: 32000, maxPromptTokens: 168000, vision: true },
	{ id: 'claude-opus-4.5', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 1000000, maxOutputTokens: 64000, maxPromptTokens: 936000, vision: true },
	{ id: 'claude-sonnet-4.6', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 1000000, maxOutputTokens: 64000, maxPromptTokens: 936000, vision: true },
	{ id: 'claude-opus-4.6', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 1000000, maxOutputTokens: 64000, maxPromptTokens: 936000, vision: true },
	{ id: 'claude-opus-4.7', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 1000000, maxOutputTokens: 64000, maxPromptTokens: 936000, vision: true },
	{ id: 'claude-opus-4.8', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 1000000, maxOutputTokens: 64000, maxPromptTokens: 936000, vision: true },
	{ id: 'claude-sonnet-5', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 1000000, maxOutputTokens: 64000, maxPromptTokens: 936000, vision: true },
	{ id: 'claude-opus-5', vendor: 'Anthropic', supportedEndpoints: ['/v1/messages', '/chat/completions'], maxContextWindowTokens: 1000000, maxOutputTokens: 64000, maxPromptTokens: 936000, vision: true },
	{ id: 'gemini-2.0-flash', vendor: 'Google', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 1000000, maxOutputTokens: 8192, maxPromptTokens: 128000, vision: true },
	{ id: 'gpt-5.3-codex', vendor: 'OpenAI', supportedEndpoints: ['/responses', 'ws:/responses'], maxContextWindowTokens: 400000, maxOutputTokens: 128000, maxPromptTokens: 272000, vision: true, isChatDefault: true, isChatFallback: true },
	{ id: 'gpt-4o', vendor: 'Azure OpenAI', supportedEndpoints: ['/chat/completions'], maxContextWindowTokens: 128000, maxOutputTokens: 4096, maxPromptTokens: 64000, vision: true },
	{ id: 'gpt-4o-mini', vendor: 'Azure OpenAI', supportedEndpoints: ['/chat/completions'], maxContextWindowTokens: 128000, maxOutputTokens: 4096, maxPromptTokens: 64000 },
];

function expandModel(model: IStubModel): Record<string, unknown> {
	return {
		id: model.id,
		name: model.id,
		object: 'model',
		vendor: model.vendor,
		version: model.id,
		preview: false,
		model_picker_enabled: true,
		is_chat_default: model.isChatDefault ?? false,
		is_chat_fallback: model.isChatFallback ?? false,
		supported_endpoints: model.supportedEndpoints,
		capabilities: {
			type: 'chat',
			family: model.id,
			tokenizer: 'o200k_base',
			object: 'model_capabilities',
			limits: {
				max_context_window_tokens: model.maxContextWindowTokens,
				max_output_tokens: model.maxOutputTokens,
				max_prompt_tokens: model.maxPromptTokens,
			},
			supports: { streaming: true, tool_calls: true, parallel_tool_calls: true, vision: model.vision ?? false, structured_outputs: true },
		},
	};
}

function userStubBody(): string {
	return JSON.stringify({
		login: 'replay-user',
		access_type_sku: 'copilot_for_business_seat',
		copilot_plan: 'enterprise',
		chat_enabled: true,
		cli_enabled: true,
		copilotignore_enabled: true,
		editor_preview_features_enabled: true,
		is_mcp_enabled: true,
		organization_login_list: [],
		organization_list: [],
		codex_agent_enabled: true,
		cloud_session_storage_enabled: true,
		token_based_billing: true,
		endpoints: { api: CAPI, proxy: CAPI, telemetry: CAPI, 'origin-tracker': CAPI },
		quota_snapshots: quotaSnapshots(),
	});
}

function quotaSnapshots(): Record<string, unknown> {
	const snapshot = { unlimited: true, percent_remaining: 100.0, remaining: 0, entitlement: 0, overage_count: 0, overage_permitted: true, has_quota: true, quota_remaining: 0.0, token_based_billing: true };
	return { chat: { ...snapshot, quota_id: 'chat' }, completions: { ...snapshot, quota_id: 'completions' }, premium_interactions: { ...snapshot, quota_id: 'premium_interactions' } };
}

function tokenStubBody(): string {
	return JSON.stringify({
		token: 'replay-copilot-token',
		expires_at: Math.floor(Date.now() / 1000) + 3600,
		refresh_in: 1800,
		endpoints: { api: CAPI, proxy: CAPI, telemetry: CAPI },
	});
}

function utilityChatCompletionStubBody(): string {
	return JSON.stringify({
		choices: [{ message: { role: 'assistant', content: 'Generated utility response' }, finish_reason: 'stop', index: 0 }],
	});
}

const JSON_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'application/json' };

export function getAncillaryStub(method: string, path: string, body?: string): IStubResponse | undefined {
	if (path === '/chat/completions' && method === 'POST' && isNonStreamingChatCompletion(body)) {
		return isCommitMessageCompletion(body)
			? { status: 200, headers: JSON_HEADERS, body: utilityChatCompletionStubBody() }
			: { status: 403, headers: JSON_HEADERS, body: 'Forbidden' };
	}
	if (path === '/models' && method === 'GET') {
		return { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: STUB_MODELS.map(expandModel), object: 'list' }) };
	}
	if (path === '/responses' && method === 'GET') {
		return { status: 400, headers: { 'content-type': 'text/plain' }, body: 'Bad Request' };
	}
	if ((path === '/models/session' || path === '/models/session/intent') && method === 'POST') {
		return { status: 500, headers: { 'content-type': 'text/plain', 'x-should-retry': 'false' }, body: 'auto-mode not available in replay' };
	}
	if (path === '/copilot/mcp_registry' && method === 'GET') {
		return { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ mcp_registries: [] }) };
	}
	if ((path === '/mcp' || path === '/mcp/readonly') && method === 'POST') {
		return { status: 404, headers: { 'content-type': 'text/plain', 'x-should-retry': 'false' }, body: 'GitHub MCP is not available in replay' };
	}
	if (method === 'GET' && (path === '/mcp' || path.startsWith('/.well-known/') || path.includes('/.well-known/'))) {
		return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'OAuth metadata is not available in replay' };
	}
	if (path.startsWith('/copilot_internal/')) {
		if (path.includes('/token') || path.includes('/nltoken')) {
			return { status: 200, headers: JSON_HEADERS, body: tokenStubBody() };
		}
		if (path.includes('/user')) {
			return { status: 200, headers: JSON_HEADERS, body: userStubBody() };
		}
		return { status: 200, headers: JSON_HEADERS, body: '{}' };
	}
	if (path === '/telemetry' || path.startsWith('/agents')) {
		return { status: 200, headers: JSON_HEADERS, body: '{}' };
	}
	return undefined;
}

function isNonStreamingChatCompletion(body: string | undefined): boolean {
	if (!body) {
		return false;
	}
	try {
		return JSON.parse(body).stream === false;
	} catch {
		return false;
	}
}

function isCommitMessageCompletion(body: string | undefined): boolean {
	if (!body) {
		return false;
	}
	try {
		const messages = JSON.parse(body).messages;
		return Array.isArray(messages) && messages.some(message =>
			message?.role === 'system'
			&& typeof message.content === 'string'
			&& message.content.includes('You generate concise Git commit messages.')
		);
	} catch {
		return false;
	}
}
