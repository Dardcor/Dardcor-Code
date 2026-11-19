/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { appendEscapedMarkdownInlineCode, escapeMarkdownLinkLabel } from '../../../../base/common/htmlContent.js';
import { basename } from '../../../../base/common/resources.js';
import { truncate } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { getStreamingCreateMessage, getStreamingEditMessage, getStreamingReplaceMessage, streamingToolTextLineCount } from '../../common/streamingToolCallDisplay.js';
import { toToolCallMeta, type IToolCallMeta, type ToolKind } from '../../common/meta/agentToolCallMeta.js';
import type { StringOrMarkdown } from '../../common/state/protocol/state.js';
import { getServerToolDisplay } from '../shared/serverToolGroups.js';


export type ClaudePermissionKind =
	| 'shell'
	| 'write'
	| 'mcp'
	| 'read'
	| 'url'
	| 'skill'
	| 'custom-tool';

export type ClaudeToolKind = ToolKind;

type ClaudeToolPathField = 'file_path' | 'notebook_path' | 'path' | 'url';














interface ClaudeToolRow {
	readonly permissionKind: ClaudePermissionKind;
	readonly pathField?: ClaudeToolPathField;
	readonly isFileEdit?: true;
	readonly interactive?: true;
	readonly toolKind?: ClaudeToolKind;
}

const TOOL_ROWS: { readonly [toolName: string]: ClaudeToolRow } = {
	Bash: { permissionKind: 'shell', toolKind: 'terminal' },
	BashOutput: { permissionKind: 'shell', toolKind: 'terminal' },
	KillBash: { permissionKind: 'shell', toolKind: 'terminal' },

	Read: { permissionKind: 'read', pathField: 'file_path', toolKind: 'read' },
	Glob: { permissionKind: 'read', pathField: 'path', toolKind: 'search' },
	Grep: { permissionKind: 'read', pathField: 'path', toolKind: 'search' },
	LS: { permissionKind: 'read', pathField: 'path' },
	NotebookRead: { permissionKind: 'read', pathField: 'notebook_path', toolKind: 'read' },

	Write: { permissionKind: 'write', pathField: 'file_path', isFileEdit: true },
	Edit: { permissionKind: 'write', pathField: 'file_path', isFileEdit: true },
	MultiEdit: { permissionKind: 'write', pathField: 'file_path', isFileEdit: true },
	NotebookEdit: { permissionKind: 'write', pathField: 'notebook_path', isFileEdit: true },
	TodoWrite: { permissionKind: 'write' },

	WebFetch: { permissionKind: 'url', pathField: 'url' },

	Task: { permissionKind: 'custom-tool', toolKind: 'subagent' },
	Agent: { permissionKind: 'custom-tool', toolKind: 'subagent' },
	ExitPlanMode: { permissionKind: 'custom-tool', interactive: true },
	AskUserQuestion: { permissionKind: 'custom-tool', interactive: true },

	Skill: { permissionKind: 'skill' },
	TaskCreate: { permissionKind: 'custom-tool' },
	TaskUpdate: { permissionKind: 'custom-tool' },
	TaskList: { permissionKind: 'custom-tool' },
	TaskGet: { permissionKind: 'custom-tool' },
};

const MCP_TOOL_PREFIX = 'mcp__';

export function getClaudePermissionKind(toolName: string): ClaudePermissionKind {
	const row = TOOL_ROWS[toolName];
	if (row) {
		return row.permissionKind;
	}
	if (toolName.startsWith(MCP_TOOL_PREFIX)) {
		return 'mcp';
	}
	return 'custom-tool';
}

export function getClaudeToolDisplayName(toolName: string): string {
	const serverDisplay = getServerToolDisplay(toolName, undefined)?.displayName;
	if (serverDisplay !== undefined) {
		return serverDisplay;
	}
	switch (toolName) {
		case 'Bash': return localize('claude.tool.bash', "Run shell command");
		case 'BashOutput': return localize('claude.tool.bashOutput', "Read shell output");
		case 'KillBash': return localize('claude.tool.killBash', "Kill shell command");
		case 'Read': return localize('claude.tool.read', "Read file");
		case 'Glob': return localize('claude.tool.glob', "Find files");
		case 'Grep': return localize('claude.tool.grep', "Search files");
		case 'LS': return localize('claude.tool.ls', "List directory");
		case 'NotebookRead': return localize('claude.tool.notebookRead', "Read notebook");
		case 'Write': return localize('claude.tool.write', "Write file");
		case 'Edit': return localize('claude.tool.edit', "Edit file");
		case 'MultiEdit': return localize('claude.tool.multiEdit', "Edit file");
		case 'NotebookEdit': return localize('claude.tool.notebookEdit', "Edit notebook");
		case 'TodoWrite': return localize('claude.tool.todoWrite', "Update todo list");
		case 'WebFetch': return localize('claude.tool.webFetch', "Fetch URL");
		case 'Task':
		case 'Agent': return localize('claude.tool.task', "Run subagent task");
		case 'ExitPlanMode': return localize('claude.tool.exitPlanMode', "Ready to code?");
		case 'AskUserQuestion': return localize('claude.tool.askUserQuestion', "Ask user a question");
		case 'Skill': return localize('claude.tool.skill', "Run skill");
		case 'TaskCreate': return localize('claude.tool.taskCreate', "Create task");
		case 'TaskUpdate': return localize('claude.tool.taskUpdate', "Update task");
		case 'TaskList': return localize('claude.tool.taskList', "List tasks");
		case 'TaskGet': return localize('claude.tool.taskGet', "Read task");
	}
	if (toolName.startsWith(MCP_TOOL_PREFIX)) {
		return localize('claude.tool.mcp', "Run MCP tool {0}", toolName.slice(MCP_TOOL_PREFIX.length));
	}
	return toolName;
}

export function getClaudeToolPath(toolName: string, input: unknown): string | undefined {
	const row = TOOL_ROWS[toolName];
	if (!row?.pathField || typeof input !== 'object' || input === null) {
		return undefined;
	}
	const value = (input as Record<string, unknown>)[row.pathField];
	return typeof value === 'string' ? value : undefined;
}

export function isClaudeFileEditTool(toolName: string): boolean {
	return TOOL_ROWS[toolName]?.isFileEdit === true;
}

export const INTERACTIVE_CLAUDE_TOOLS: ReadonlySet<string> = new Set(
	Object.entries(TOOL_ROWS)
		.filter(([, row]) => row.interactive)
		.map(([name]) => name),
);

export function getClaudeConfirmationTitle(toolName: string): string {
	switch (getClaudePermissionKind(toolName)) {
		case 'shell':
			return localize('claude.permission.shell.title', "Run in terminal?");
		case 'write':
			return localize('claude.permission.write.title', "Edit file?");
		case 'read':
			return localize('claude.permission.read.title', "Read file?");
		case 'url':
			return localize('claude.permission.url.title', "Fetch URL?");
		case 'skill':
			return localize('claude.permission.skill.title', "Run skill?");
		case 'mcp': {
			const serverName = toolName.startsWith(MCP_TOOL_PREFIX)
				? toolName.slice(MCP_TOOL_PREFIX.length).split('__')[0]
				: undefined;
			return serverName
				? localize('claude.permission.mcp.title', "Allow tool from {0}?", serverName)
				: localize('claude.permission.default.title', "Allow tool call?");
		}
		case 'custom-tool':
		default:
			return localize('claude.permission.default.title', "Allow tool call?");
	}
}


export function getClaudeToolKind(toolName: string): ClaudeToolKind | undefined {
	return TOOL_ROWS[toolName]?.toolKind;
}

export function buildClaudeToolMeta(toolName: string): Record<string, unknown> | undefined {
	const meta = buildClaudeToolCallMeta(toolName);
	return meta ? toToolCallMeta(meta) : undefined;
}

export function buildClaudeToolCallMeta(toolName: string): IToolCallMeta | undefined {
	const row = TOOL_ROWS[toolName];
	if (!row?.toolKind) {
		return undefined;
	}
	return { toolKind: row.toolKind };
}

function md(value: string): StringOrMarkdown {
	return { markdown: value };
}

function formatPathAsMarkdownLink(path: string): string {
	const uri = URI.file(path);
	return `[${escapeMarkdownLinkLabel(basename(uri))}](${uri})`;
}

function readStringField(input: unknown, field: string): string | undefined {
	if (input === null || typeof input !== 'object') {
		return undefined;
	}
	const value = (input as Record<string, unknown>)[field];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstShellLine(input: unknown): string | undefined {
	const command = readStringField(input, 'command');
	return command ? command.split('\n')[0] : undefined;
}

function readTaskUpdateStatus(input: unknown): 'in_progress' | 'completed' | 'deleted' | undefined {
	const status = readStringField(input, 'status');
	return status === 'in_progress' || status === 'completed' || status === 'deleted' ? status : undefined;
}

export function getClaudeInvocationMessage(
	toolName: string,
	displayName: string,
	input: unknown,
): StringOrMarkdown {
	const serverDisplay = getServerToolDisplay(toolName, input)?.invocationMessage;
	if (serverDisplay !== undefined) {
		return serverDisplay;
	}
	switch (toolName) {
		case 'Bash': {
			const firstLine = firstShellLine(input);
			if (firstLine) {
				return md(localize('claude.toolInvoke.bashCmd', "Running {0}", appendEscapedMarkdownInlineCode(truncate(firstLine, 80))));
			}
			return localize('claude.toolInvoke.bash', "Running shell command");
		}
		case 'BashOutput':
			return localize('claude.toolInvoke.bashOutput', "Reading shell output");
		case 'KillBash':
			return localize('claude.toolInvoke.killBash', "Kill shell command");
		case 'Read':
		case 'NotebookRead': {
			const path = getClaudeToolPath(toolName, input);
			if (path) {
				return md(localize('claude.toolInvoke.readFile', "Read {0}", formatPathAsMarkdownLink(path)));
			}
			return localize('claude.toolInvoke.read', "Read file");
		}
		case 'LS': {
			const path = getClaudeToolPath(toolName, input);
			if (path) {
				return md(localize('claude.toolInvoke.lsPath', "List {0}", formatPathAsMarkdownLink(path)));
			}
			return localize('claude.toolInvoke.ls', "List directory");
		}
		case 'Write':
		case 'Edit':
		case 'MultiEdit':
		case 'NotebookEdit': {
			const path = getClaudeToolPath(toolName, input);
			if (path) {
				return md(localize('claude.toolInvoke.editFile', "Edit {0}", formatPathAsMarkdownLink(path)));
			}
			return localize('claude.toolInvoke.edit', "Edit file");
		}
		case 'TodoWrite':
			return localize('claude.toolInvoke.todoWrite', "Update todo list");
		case 'Grep': {
			const pattern = readStringField(input, 'pattern');
			if (pattern) {
				return md(localize('claude.toolInvoke.grepPattern', "Search for {0}", appendEscapedMarkdownInlineCode(truncate(pattern, 80))));
			}
			return localize('claude.toolInvoke.grep', "Search files");
		}
		case 'Glob': {
			const pattern = readStringField(input, 'pattern');
			if (pattern) {
				return md(localize('claude.toolInvoke.globPattern', "Find files matching {0}", appendEscapedMarkdownInlineCode(truncate(pattern, 80))));
			}
			return localize('claude.toolInvoke.glob', "Find files");
		}
		case 'WebFetch': {
			const url = readStringField(input, 'url');
			if (url) {
				return md(localize('claude.toolInvoke.webFetch', "Fetching {0}", `[${escapeMarkdownLinkLabel(truncate(url, 80))}](${url})`));
			}
			return localize('claude.toolInvoke.webFetchGeneric', "Fetching URL");
		}
		case 'Task':
		case 'Agent': {
			const description = readStringField(input, 'description');
			if (description) {
				return description;
			}
			return displayName;
		}
		case 'Skill': {
			const skill = readStringField(input, 'skill');
			if (skill) {
				return md(localize('claude.toolInvoke.skillNamed', "Running skill {0}", appendEscapedMarkdownInlineCode(truncate(skill, 80))));
			}
			return localize('claude.toolInvoke.skill', "Running skill");
		}
		case 'TaskCreate': {
			const subject = readStringField(input, 'subject');
			if (subject) {
				return localize('claude.toolInvoke.taskCreateNamed', "Create task: {0}", truncate(subject, 80));
			}
			return localize('claude.toolInvoke.taskCreate', "Create task");
		}
		case 'TaskUpdate':
			switch (readTaskUpdateStatus(input)) {
				case 'in_progress': return localize('claude.toolInvoke.taskStart', "Start task");
				case 'completed': return localize('claude.toolInvoke.taskComplete', "Complete task");
				case 'deleted': return localize('claude.toolInvoke.taskDelete', "Delete task");
				default: return localize('claude.toolInvoke.taskUpdate', "Update task");
			}
		case 'TaskList':
			return localize('claude.toolInvoke.taskList', "Read task list");
		case 'TaskGet':
			return localize('claude.toolInvoke.taskGet', "Read task");
		default:
			return displayName;
	}
}

export function getClaudeStreamingInvocationMessage(toolName: string, input: Record<string, unknown> | undefined): StringOrMarkdown | undefined {
	switch (toolName) {
		case 'Write':
			return getStreamingCreateMessage(input?.['file_path'], streamingToolTextLineCount(input?.['content']));
		case 'Edit':
			return getStreamingReplaceMessage(
				input?.['file_path'],
				streamingToolTextLineCount(input?.['old_string']),
				streamingToolTextLineCount(input?.['new_string']),
			);
		case 'MultiEdit': {
			const edits = Array.isArray(input?.['edits']) ? input['edits'] : [];
			let oldLineCount: number | undefined;
			let newLineCount: number | undefined;
			for (const edit of edits) {
				if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
					continue;
				}
				const oldLines = streamingToolTextLineCount((edit as Record<string, unknown>)['old_string']);
				const newLines = streamingToolTextLineCount((edit as Record<string, unknown>)['new_string']);
				if (oldLines !== undefined) {
					oldLineCount = (oldLineCount ?? 0) + oldLines;
				}
				if (newLines !== undefined) {
					newLineCount = (newLineCount ?? 0) + newLines;
				}
			}
			return getStreamingReplaceMessage(input?.['file_path'], oldLineCount, newLineCount);
		}
		case 'NotebookEdit':
			return getStreamingEditMessage(input?.['notebook_path'], streamingToolTextLineCount(input?.['new_source']));
		default:
			return undefined;
	}
}

export function getClaudePastTenseMessage(
	toolName: string,
	displayName: string,
	input: unknown,
	success: boolean,
	resultText?: string,
): StringOrMarkdown {
	if (!success) {
		return localize('claude.toolComplete.failed', "\"{0}\" failed", displayName);
	}
	const serverDisplay = getServerToolDisplay(toolName, input, { text: resultText, success })?.pastTenseMessage;
	if (serverDisplay !== undefined) {
		return serverDisplay;
	}
	switch (toolName) {
		case 'Bash': {
			const firstLine = firstShellLine(input);
			if (firstLine) {
				return md(localize('claude.toolComplete.bashCmd', "Ran {0}", appendEscapedMarkdownInlineCode(truncate(firstLine, 80))));
			}
			return localize('claude.toolComplete.bash', "Ran shell command");
		}
		case 'BashOutput':
			return localize('claude.toolComplete.bashOutput', "Read shell output");
		case 'WebFetch': {
			const url = readStringField(input, 'url');
			if (url) {
				return md(localize('claude.toolComplete.webFetch', "Fetched {0}", `[${escapeMarkdownLinkLabel(truncate(url, 80))}](${url})`));
			}
			return localize('claude.toolComplete.webFetchGeneric', "Fetched URL");
		}
		case 'Task':
		case 'Agent':
			return localize('claude.toolComplete.task', "Ran subagent");
		case 'Skill': {
			const skill = readStringField(input, 'skill');
			if (skill) {
				return md(localize('claude.toolComplete.skillNamed', "Ran skill {0}", appendEscapedMarkdownInlineCode(truncate(skill, 80))));
			}
			return localize('claude.toolComplete.skill', "Ran skill");
		}
		default:
			return getClaudeInvocationMessage(toolName, displayName, input);
	}
}

export function getClaudeToolInputString(toolName: string, input: unknown): string | undefined {
	if (input === undefined) {
		return undefined;
	}
	if (toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'KillBash') {
		const command = readStringField(input, 'command');
		if (command) {
			return command;
		}
	}
	if (toolName === 'Grep' || toolName === 'Glob') {
		const pattern = readStringField(input, 'pattern');
		if (pattern) {
			return pattern;
		}
	}
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return undefined;
	}
}

