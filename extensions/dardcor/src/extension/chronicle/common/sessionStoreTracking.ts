/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenAiAttr } from '../../../platform/otel/common/genAiAttributes';
import type { ICompletedSpanData } from '../../../platform/otel/common/otelService';



export const MAX_USER_MESSAGE_LENGTH = 1000;

export const MAX_ASSISTANT_RESPONSE_LENGTH = 5000;

export const MAX_SUMMARY_LENGTH = 1000;

export function truncateForStore(value: string | undefined, maxLength: number): string | undefined {
	if (!value) {
		return undefined;
	}
	if (value.length <= maxLength) {
		return value;
	}
	const ellipsis = '...';
	if (maxLength <= ellipsis.length) {
		return ellipsis.slice(0, maxLength);
	}
	return value.slice(0, maxLength - ellipsis.length).trimEnd() + ellipsis;
}

export function isTerminalTool(toolName: string): boolean {
	return toolName === 'runInTerminal' || toolName === 'run_in_terminal';
}

export function extractToolArgs(span: ICompletedSpanData): Record<string, unknown> {
	const serialized = span.attributes[GenAiAttr.TOOL_CALL_ARGUMENTS];
	if (typeof serialized === 'string') {
		try {
			return JSON.parse(serialized) as Record<string, unknown>;
		} catch {
		}
	}
	return {};
}

const FILE_TRACKING_TOOLS = new Set([
	'replace_string_in_file',
	'multi_replace_string_in_file',
	'insert_edit_into_file',
	'create_file',
	'create_directory',
	'edit_notebook_file',
	'apply_patch',
	'read_file',
	'view_image',
	'list_dir',
	'str_replace_editor',
	'create',
]);

const GH_MCP_PREFIXES = ['mcp_github_', 'github-mcp-server-'];

export function extractFilePath(toolName: string, toolArgs: unknown): string | undefined {
	if (!FILE_TRACKING_TOOLS.has(toolName)) { return undefined; }
	if (typeof toolArgs !== 'object' || toolArgs === null) { return undefined; }
	const args = toolArgs as Record<string, unknown>;

	const filePath = args.filePath ?? args.path ?? args.dirPath;
	if (typeof filePath === 'string') { return filePath; }

	if (toolName === 'multi_replace_string_in_file' && Array.isArray(args.replacements)) {
		const first = args.replacements[0];
		if (typeof first === 'object' && first !== null) {
			const fp = (first as Record<string, unknown>).filePath;
			if (typeof fp === 'string') { return fp; }
		}
	}

	if (toolName === 'apply_patch' && typeof args.input === 'string') {
		return extractFirstFileFromPatch(args.input);
	}

	return undefined;
}

function extractFirstFileFromPatch(input: string): string | undefined {
	const match = input.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/m);
	return match?.[1]?.trim();
}

function getStringField(obj: unknown, field: string): string | undefined {
	if (typeof obj !== 'object' || obj === null) { return undefined; }
	const val = (obj as Record<string, unknown>)[field];
	return typeof val === 'string' ? val : undefined;
}

function getNumberField(obj: unknown, field: string): number | undefined {
	if (typeof obj !== 'object' || obj === null) { return undefined; }
	const val = (obj as Record<string, unknown>)[field];
	return typeof val === 'number' ? val : undefined;
}

export function extractRefsFromMcpTool(
	toolName: string,
	toolArgs: unknown,
): Array<{ ref_type: 'pr' | 'issue' | 'commit'; ref_value: string }> {
	const refs: Array<{ ref_type: 'pr' | 'issue' | 'commit'; ref_value: string }> = [];

	if (toolName.includes('pull_request')) {
		const pullNumber = getNumberField(toolArgs, 'pullNumber');
		if (pullNumber) {
			refs.push({ ref_type: 'pr', ref_value: String(pullNumber) });
		}
	}

	if (toolName.includes('issue')) {
		const issueNumber = getNumberField(toolArgs, 'issue_number');
		if (issueNumber) {
			refs.push({ ref_type: 'issue', ref_value: String(issueNumber) });
		}
	}

	if (toolName.includes('commit')) {
		const sha = getStringField(toolArgs, 'sha');
		if (sha) {
			refs.push({ ref_type: 'commit', ref_value: sha });
		}
	}

	return refs;
}

export function extractRefsFromTerminal(
	toolArgs: unknown,
	resultText: string | undefined,
): Array<{ ref_type: 'pr' | 'issue' | 'commit'; ref_value: string }> {
	const command = getStringField(toolArgs, 'command');
	if (!command) { return []; }

	const refs: Array<{ ref_type: 'pr' | 'issue' | 'commit'; ref_value: string }> = [];

	if (/\bgh\s+pr\s+(create|checkout|view|merge)\b/.test(command) && resultText) {
		const prMatch = resultText.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
		if (prMatch?.[1]) {
			refs.push({ ref_type: 'pr', ref_value: prMatch[1] });
		}
	}

	if (command.includes('gh issue create') && resultText) {
		const issueMatch = resultText.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
		if (issueMatch?.[1]) {
			refs.push({ ref_type: 'issue', ref_value: issueMatch[1] });
		}
	}

	if (/\bgit\s+commit\b/.test(command) && resultText) {
		const commitMatch = resultText.match(/\[[\w/.-]+\s+([0-9a-f]{7,40})\]/);
		if (commitMatch?.[1]) {
			refs.push({ ref_type: 'commit', ref_value: commitMatch[1] });
		}
	}

	return refs;
}

export function extractRepoFromMcpTool(toolArgs: unknown): string | undefined {
	const owner = getStringField(toolArgs, 'owner');
	const repo = getStringField(toolArgs, 'repo');
	if (owner && repo) { return `${owner}/${repo}`; }
	return undefined;
}

export function isGitHubMcpTool(toolName: string): boolean {
	return GH_MCP_PREFIXES.some(prefix => toolName.startsWith(prefix));
}

const OTEL_TRUNCATION_MARKER = '...[truncated';

export function extractAgentName(span: { name: string; attributes: Record<string, unknown> }): string {
	const attr = span.attributes[GenAiAttr.AGENT_NAME] as string | undefined;
	if (attr?.trim()) {
		return attr.trim();
	}
	const match = span.name.match(/^invoke_agent\s+(.+)/);
	if (match?.[1]?.trim()) {
		return match[1].trim();
	}
	return 'unknown';
}

export function extractPlainTextFromContent(content: string): string | undefined {
	const trimmed = content.trim();
	if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
		return trimmed || undefined;
	}
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			const textPart = parsed.find((p: unknown) => typeof p === 'object' && p !== null && (p as Record<string, unknown>).type === 'text' && typeof (p as Record<string, unknown>).text === 'string');
			if (textPart) {
				return ((textPart as Record<string, unknown>).text as string).trim() || undefined;
			}
			return undefined;
		}
		if (typeof (parsed as Record<string, unknown>).content === 'string') {
			return ((parsed as Record<string, unknown>).content as string).trim() || undefined;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function extractAssistantResponse(outputMessagesRaw: string | undefined): string | undefined {
	if (!outputMessagesRaw) {
		return undefined;
	}

	try {
		const messages = JSON.parse(outputMessagesRaw) as { role: string; parts: { type: string; content: string }[] }[];
		const parts = messages
			.filter(m => m.role === 'assistant')
			.flatMap(m => m.parts)
			.filter(p => p.type === 'text')
			.map(p => p.content);
		return parts.length > 0 ? parts.join('\n') : undefined;
	} catch {
	}

	if (!outputMessagesRaw.includes(OTEL_TRUNCATION_MARKER)) {
		return undefined;
	}
	const assistantTextContentPrefix = '"type":"text","content":"';
	const prefixStart = outputMessagesRaw.indexOf(assistantTextContentPrefix);
	if (prefixStart === -1) {
		return undefined;
	}
	const textStart = prefixStart + assistantTextContentPrefix.length;
	const truncationIdx = outputMessagesRaw.indexOf(OTEL_TRUNCATION_MARKER, textStart);
	if (truncationIdx === -1) {
		return undefined;
	}
	const extracted = outputMessagesRaw.slice(textStart, truncationIdx);
	if (extracted.length === 0) {
		return undefined;
	}
	try {
		return JSON.parse(`"${extracted}"`) as string;
	} catch {
		return extracted;
	}
}
