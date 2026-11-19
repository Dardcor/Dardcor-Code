/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export function truncateForOTel(value: string, maxLength: number = 0): string {
	if (maxLength <= 0 || value.length <= maxLength) {
		return value;
	}
	const suffix = `...[truncated, original ${value.length} chars]`;
	if (maxLength <= suffix.length) {
		return value.substring(0, maxLength);
	}
	return value.substring(0, maxLength - suffix.length) + suffix;
}

export interface OTelChatMessage {
	role: string | undefined;
	parts: OTelMessagePart[];
}

export interface OTelOutputMessage extends OTelChatMessage {
	finish_reason?: string;
}

export type OTelMessagePart =
	| { type: 'text'; content: string }
	| { type: 'tool_call'; id: string; name: string; arguments: unknown }
	| { type: 'tool_call_response'; id: string; response: unknown }
	| { type: 'tool_search_output'; id: string; tools?: unknown; status?: string }
	| { type: 'reasoning'; content: string };

export type OTelSystemInstruction = Array<{ type: 'text'; content: string }>;

export interface OTelToolDefinition {
	type: 'function';
	name: string;
	description?: string;
	parameters?: unknown;
}

export function toInputMessages(messages: ReadonlyArray<{ role?: string; content?: string; tool_calls?: ReadonlyArray<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string }>): OTelChatMessage[] {
	return messages.map(msg => {
		const parts: OTelMessagePart[] = [];

		if (msg.role === 'tool' && msg.tool_call_id) {
			parts.push({ type: 'tool_call_response', id: msg.tool_call_id, response: msg.content ?? '' });
			return { role: msg.role, parts };
		}

		if (msg.content) {
			parts.push({ type: 'text', content: msg.content });
		}

		if (msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				let args: unknown;
				try { args = JSON.parse(tc.function.arguments); } catch { args = tc.function.arguments; }
				parts.push({
					type: 'tool_call',
					id: tc.id,
					name: tc.function.name,
					arguments: args,
				});
			}
		}

		return { role: msg.role, parts };
	});
}

export function toOutputMessages(choices: ReadonlyArray<{
	message?: { role?: string; content?: string; tool_calls?: ReadonlyArray<{ id: string; function: { name: string; arguments: string } }> };
	finish_reason?: string;
}>): OTelOutputMessage[] {
	return choices.map(choice => {
		const parts: OTelMessagePart[] = [];
		const msg = choice.message;

		if (msg?.content) {
			parts.push({ type: 'text', content: msg.content });
		}

		if (msg?.tool_calls) {
			for (const tc of msg.tool_calls) {
				let args: unknown;
				try { args = JSON.parse(tc.function.arguments); } catch { args = tc.function.arguments; }
				parts.push({
					type: 'tool_call',
					id: tc.id,
					name: tc.function.name,
					arguments: args,
				});
			}
		}

		return {
			role: msg?.role ?? 'assistant',
			parts,
			finish_reason: choice.finish_reason,
		};
	});
}

export function toSystemInstructions(systemMessage: string | ReadonlyArray<string> | undefined): OTelSystemInstruction | undefined {
	if (systemMessage === undefined) {
		return undefined;
	}
	const inputs = Array.isArray(systemMessage) ? systemMessage : [systemMessage as string];
	const blocks = inputs
		.filter(s => typeof s === 'string' && s.length > 0)
		.map(content => ({ type: 'text' as const, content }));
	return blocks.length > 0 ? blocks : undefined;
}

export function extractTextFromContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map(block => {
				if (typeof block === 'string') { return block; }
				if (block && typeof block === 'object') {
					const b = block as { text?: unknown; content?: unknown };
					if (typeof b.text === 'string') { return b.text; }
					if (typeof b.content === 'string') { return b.content; }
				}
				return '';
			})
			.filter(s => s.length > 0)
			.join('\n');
	}
	return '';
}

export function collectSystemTextsFromRequestBody(requestBody: {
	readonly messages?: ReadonlyArray<{ role?: unknown; content?: unknown }>;
	readonly input?: ReadonlyArray<{ role?: unknown; content?: unknown }>;
	readonly system?: unknown;
	readonly instructions?: unknown;
}): string[] {
	const systemTexts: string[] = [];
	const capiMessages = requestBody.messages ?? requestBody.input;
	if (capiMessages) {
		for (const m of capiMessages) {
			if (m.role === 'system') {
				const t = extractTextFromContent(m.content);
				if (t) { systemTexts.push(t); }
			}
		}
	}
	if (systemTexts.length === 0) {
		const topLevelSystem = extractTextFromContent(requestBody.system ?? requestBody.instructions);
		if (topLevelSystem) { systemTexts.push(topLevelSystem); }
	}
	return systemTexts;
}

export function normalizeProviderMessages(messages: ReadonlyArray<Record<string, unknown>>): OTelChatMessage[] {
	return messages.map(msg => {
		const itemType = msg.type as string | undefined;
		switch (itemType) {
			case 'function_call':
				return normalizeResponsesFunctionCall(msg);
			case 'function_call_output':
				return normalizeResponsesFunctionCallOutput(msg);
			case 'tool_search_output':
				return normalizeResponsesToolSearchOutput(msg);
			case 'reasoning':
				return normalizeResponsesReasoning(msg);
		}

		const role = msg.role as string | undefined;
		const parts: OTelMessagePart[] = [];
		const content = msg.content;

		if (role === 'tool' && typeof msg.tool_call_id === 'string') {
			parts.push({ type: 'tool_call_response', id: msg.tool_call_id, response: content ?? '' });
			return { role, parts };
		}

		if (typeof content === 'string' && content.length > 0) {
			parts.push({ type: 'text', content });
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (!block || typeof block !== 'object') { continue; }
				const b = block as Record<string, unknown>;
				switch (b.type) {
					case 'text':
					case 'input_text':
					case 'output_text':
						if (typeof b.text === 'string') {
							parts.push({ type: 'text', content: b.text });
						}
						break;
					case 'tool_use':
						parts.push({
							type: 'tool_call',
							id: String(b.id ?? ''),
							name: String(b.name ?? ''),
							arguments: b.input,
						});
						break;
					case 'tool_result':
						parts.push({
							type: 'tool_call_response',
							id: String(b.tool_use_id ?? ''),
							response: b.content ?? '',
						});
						break;
					case 'thinking':
						if (typeof b.thinking === 'string') {
							parts.push({ type: 'reasoning', content: b.thinking });
						}
						break;
					default:
						parts.push({ type: 'text', content: JSON.stringify(b) });
						break;
				}
			}
		}

		const toolCalls = msg.tool_calls;
		if (Array.isArray(toolCalls)) {
			for (const tc of toolCalls) {
				if (!tc || typeof tc !== 'object') { continue; }
				const call = tc as Record<string, unknown>;
				const fn = call.function as Record<string, unknown> | undefined;
				if (fn) {
					let args: unknown;
					try { args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments; } catch { args = fn.arguments; }
					parts.push({
						type: 'tool_call',
						id: String(call.id ?? ''),
						name: String(fn.name ?? ''),
						arguments: args,
					});
				}
			}
		}

		return { role, parts };
	});
}

function normalizeResponsesFunctionCall(msg: Record<string, unknown>): OTelChatMessage {
	let args: unknown = msg.arguments;
	if (typeof args === 'string') {
		try { args = JSON.parse(args); } catch { }
	}
	return {
		role: 'assistant',
		parts: [{
			type: 'tool_call',
			id: String(msg.call_id ?? msg.id ?? ''),
			name: String(msg.name ?? ''),
			arguments: args,
		}],
	};
}

function normalizeResponsesFunctionCallOutput(msg: Record<string, unknown>): OTelChatMessage {
	const output = msg.output;
	let response: unknown;
	if (typeof output === 'string') {
		response = output;
	} else if (Array.isArray(output)) {
		response = output
			.map(b => (b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string') ? (b as Record<string, unknown>).text as string : JSON.stringify(b))
			.join('');
	} else {
		response = output ?? '';
	}
	return {
		role: 'tool',
		parts: [{
			type: 'tool_call_response',
			id: String(msg.call_id ?? msg.id ?? ''),
			response,
		}],
	};
}

function normalizeResponsesToolSearchOutput(msg: Record<string, unknown>): OTelChatMessage {
	const hasTools = Object.prototype.hasOwnProperty.call(msg, 'tools') && msg.tools !== undefined;
	const part: { type: 'tool_search_output'; id: string; tools?: unknown; status?: string } = {
		type: 'tool_search_output',
		id: String(msg.call_id ?? msg.id ?? ''),
		status: typeof msg.status === 'string' ? msg.status : undefined,
	};
	if (hasTools) {
		part.tools = msg.tools;
	}
	return { role: 'tool_search', parts: [part] };
}

function normalizeResponsesReasoning(msg: Record<string, unknown>): OTelChatMessage {
	const parts: OTelMessagePart[] = [];
	const summary = msg.summary;
	if (Array.isArray(summary)) {
		for (const s of summary) {
			if (s && typeof s === 'object' && typeof (s as Record<string, unknown>).text === 'string') {
				parts.push({ type: 'reasoning', content: (s as Record<string, unknown>).text as string });
			}
		}
	} else if (typeof summary === 'string') {
		parts.push({ type: 'reasoning', content: summary });
	}
	if (typeof msg.encrypted_content === 'string') {
		parts.push({ type: 'reasoning', content: msg.encrypted_content });
	}
	return { role: 'assistant', parts };
}

export function toToolDefinitions(tools: ReadonlyArray<{
	type?: string;
	name?: string;
	description?: string;
	parameters?: unknown;
	input_schema?: unknown;
	inputSchema?: unknown;
	function?: { name?: string; description?: string; parameters?: unknown };
}> | undefined): OTelToolDefinition[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	const out: OTelToolDefinition[] = [];
	for (const t of tools) {
		const name = t.function?.name ?? t.name;
		if (!name) {
			continue;
		}
		const description = t.function?.description ?? t.description;
		const parameters = t.function?.parameters ?? t.parameters ?? t.input_schema ?? t.inputSchema;
		out.push({
			type: 'function',
			name,
			description,
			parameters,
		});
	}
	return out.length > 0 ? out : undefined;
}


const toolDefsJsonByRef = new WeakMap<object, string>();
const toolsRawJsonByRef = new WeakMap<object, string>();
let lastToolDefsJson: string | undefined;
let lastToolsRawJson: string | undefined;

function internToolDefsString(s: string): string {
	if (lastToolDefsJson !== undefined && lastToolDefsJson === s) {
		return lastToolDefsJson;
	}
	lastToolDefsJson = s;
	return s;
}

function internToolsRawString(s: string): string {
	if (lastToolsRawJson !== undefined && lastToolsRawJson === s) {
		return lastToolsRawJson;
	}
	lastToolsRawJson = s;
	return s;
}

export function stringifyToolDefinitionsForOTel(tools: Parameters<typeof toToolDefinitions>[0]): string | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	const cached = toolDefsJsonByRef.get(tools);
	if (cached !== undefined) {
		return cached;
	}
	const defs = toToolDefinitions(tools);
	if (!defs) {
		return undefined;
	}
	const s = internToolDefsString(JSON.stringify(defs));
	toolDefsJsonByRef.set(tools, s);
	return s;
}

export function stringifyToolsRawForTelemetry(tools: ReadonlyArray<unknown> | undefined): string | undefined {
	if (!tools) {
		return undefined;
	}
	const cached = toolsRawJsonByRef.get(tools);
	if (cached !== undefined) {
		return cached;
	}
	const s = internToolsRawString(JSON.stringify(tools));
	toolsRawJsonByRef.set(tools, s);
	return s;
}
