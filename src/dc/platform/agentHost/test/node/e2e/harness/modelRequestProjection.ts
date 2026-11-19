/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { IReadableAnthropicRequest } from './capiWireCodec.js';
import { normalizeShellToolNameForCapture } from './shellToolNames.js';

export const TOOL_RESULT_PLACEHOLDER = '${tool_result}';

const RUNTIME_ID_PLACEHOLDER = '${uuid}';
const RAW_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ORDINAL_UUID_RE = /\$\{uuid_\d+\}/g;

const PATH_PLACEHOLDER = '${path}';

const CHANGE_NOTICE_RE = /<(tools_changed_notice|mode_changed_notice|working_directory_changed|additional_directories_changed)>[\s\S]*?<\/\1>\n*/g;

function elideChangeNotices(text: string): string {
	return text.replace(CHANGE_NOTICE_RE, '');
}

const PATH_RE = /(?:\$\{(?:workdir|homedir)\}|(?<![A-Za-z])[A-Za-z]:|(?<![A-Za-z0-9])(?=[/\\]))(?:[/\\](?:\$\{[^}]+\}|[^\s"'`,;:*?<>|)$\]}/\\]+))*/g;

function elidePaths(text: string): string {
	return text.replace(PATH_RE, PATH_PLACEHOLDER);
}

const REASONING_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking', 'reasoning']);

function isReasoningBlock(block: unknown): boolean {
	return REASONING_BLOCK_TYPES.has((block as { type?: string })?.type ?? '');
}

export interface IProjectedMessage {
	readonly role: string;
	readonly content: unknown;
}

export interface IProjectedModelRequest {
	readonly system: string;
	readonly messages: readonly IProjectedMessage[];
}

function elideRuntimeIds(text: string): string {
	return elidePaths(elideChangeNotices(text).replace(RAW_UUID_RE, RUNTIME_ID_PLACEHOLDER).replace(ORDINAL_UUID_RE, RUNTIME_ID_PLACEHOLDER));
}

function projectValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return elideRuntimeIds(value);
	}
	if (Array.isArray(value)) {
		return value.map(projectValue);
	}
	if (value && typeof value === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			result[key] = projectValue(item);
		}
		return result;
	}
	return value;
}

function projectContent(content: unknown): unknown {
	if (typeof content === 'string') {
		return elideRuntimeIds(content);
	}
	if (!Array.isArray(content)) {
		return projectValue(content);
	}
	return content.filter(block => !isReasoningBlock(block)).map(block => {
		const b = block as { type?: string; text?: string; name?: string; format?: 'custom'; input?: unknown; tool_use_id?: string };
		switch (b.type) {
			case 'text':
				return { type: 'text', text: elideRuntimeIds(b.text ?? '') };
			case 'tool_use':
				return { type: 'tool_use', name: normalizeShellToolNameForCapture(b.name ?? ''), ...(b.format ? { format: b.format } : {}), input: projectValue(b.input) };
			case 'tool_result':
				return { type: 'tool_result', tool_use_id: elideRuntimeIds(b.tool_use_id ?? ''), content: TOOL_RESULT_PLACEHOLDER };
			default:
				return { type: b.type };
		}
	});
}

export function projectModelRequest(request: IReadableAnthropicRequest): IProjectedModelRequest {
	return {
		system: request.system,
		messages: request.messages.map(message => ({ role: message.role, content: projectContent(message.content) })),
	};
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

export function modelRequestsMatch(expected: IProjectedModelRequest, actual: IProjectedModelRequest): boolean {
	return stableStringify(expected) === stableStringify(actual);
}

export function formatModelRequestMismatch(turnIndex: number, expected: IProjectedModelRequest, actual: IProjectedModelRequest): string {
	return [
		`model request #${turnIndex + 1} does not match the recorded request in the fixture`,
		`  expected (recorded): ${stableStringify(expected)}`,
		`  actual (live):       ${stableStringify(actual)}`,
	].join('\n');
}
