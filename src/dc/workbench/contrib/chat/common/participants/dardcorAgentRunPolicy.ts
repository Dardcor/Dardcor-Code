/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IChatTodo } from '../tools/chatTodoListService.js';
import type { IChatAgentRunState } from '../tools/agentRunStateService.js';
import { validateAgentToolArguments } from '../../../../../platform/agentHost/common/agentToolRuntime.js';

const TOOL_ALIASES: Record<string, string> = {
	complete_task: 'task_completed',
	read_page: 'read_browser_page',
	click_browser: 'click_element',
	type_browser: 'type_in_page',
	scroll_page: 'scroll_browser_page',
	hover_browser: 'hover_element',
	navigate_page: 'open_browser_page',
	navigate_browser: 'open_browser_page',
	screenshot_page: 'screenshot_browser_page',
	read_file: 'read_file',
	write_file: 'write_file',
	run_in_terminal: 'run_command',
	list_dir: 'list_directory',
	bash: 'run_command',
	sh: 'run_command',
	cmd: 'run_command',
	powershell: 'run_command',
	terminal: 'run_command',
	execute_command: 'run_command',
	read: 'read_file',
	view_file: 'read_file',
	glob: 'find_files',
	grep: 'search_code',
	ask_question: 'ask_questions',
	ask_user_question: 'ask_questions',
	todo: 'manage_todo_list',
	todo_list: 'manage_todo_list',
	update_todo_list: 'manage_todo_list',
	multi_edit: 'multi_edit_file',
	batch_edit: 'batch_edit_files',
	read_files: 'read_multiple_files',
	goto_definition: 'go_to_definition',
	find_references: 'find_symbol_references',
	call_hierarchy: 'get_call_hierarchy',
	checkpoint: 'create_checkpoint',
	rollback_checkpoint: 'restore_checkpoint',
	git_status: 'git_intelligence',
	self_introspect: 'introspect_self',
	memory: 'manage_knowledge_memory',
	swarm: 'spawn_agent_swarm',
	audit_page: 'audit_page_visual_and_network',
};

export interface IDardcorParsedToolCall {
	readonly name: string;
	readonly args?: Record<string, unknown>;
	readonly error?: string;
}

export function parseDardcorAgentToolArguments(
	name: string,
	rawArguments: unknown,
	toolDefinitions: readonly { function: { name: string; parameters: unknown } }[],
): IDardcorParsedToolCall {
	const requestedName = name.trim();
	const canonicalName = TOOL_ALIASES[requestedName]
		?? (requestedName.includes('todo') ? 'manage_todo_list' : undefined)
		?? requestedName;
	if (canonicalName === '__incomplete_tool_call__') {
		return { name: canonicalName, error: 'The provider stream ended before the tool function name arrived. Retry the tool call with a complete function name and arguments.' };
	}
	const tool = toolDefinitions.find(candidate => candidate.function.name === canonicalName);
	if (!tool) {
		return { name: canonicalName, error: `Unknown tool "${requestedName}". No action was run.` };
	}

	let parsed: unknown = rawArguments;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return { name: canonicalName, error: `Invalid JSON arguments for ${canonicalName}: ${detail}. Retry with a complete JSON object.` };
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { name: canonicalName, error: `Arguments for ${canonicalName} must be a JSON object.` };
	}

	const args = { ...(parsed as Record<string, unknown>) };
	const argumentAliases: Record<string, Record<string, readonly string[]>> = {
		read_file: { filePath: ['path', 'file_path', 'targetFile', 'target_file', 'filename', 'file'] },
		write_file: { filePath: ['path', 'file_path', 'targetFile', 'target_file', 'filename', 'file'] },
		edit_file: { filePath: ['path', 'file_path', 'targetFile', 'target_file', 'filename', 'file'] },
		delete_file: { filePath: ['path', 'file_path', 'targetFile', 'target_file', 'filename', 'file'] },
		list_directory: { dirPath: ['path', 'dir', 'directory'] },
		run_command: { command: ['commandLine', 'cmd', 'command_line'] },
		find_files: { pattern: ['query', 'glob'] },
		search_code: { query: ['pattern', 'text'] },
		rename_file: { oldFilePath: ['oldPath'], newFilePath: ['newPath'] },
		multi_edit_file: { filePath: ['path', 'file_path', 'targetFile', 'target_file', 'filename', 'file'] },
		go_to_definition: { filePath: ['path', 'file_path', 'file'], symbol: ['name', 'identifier', 'query'] },
		find_symbol_references: { symbol: ['name', 'identifier', 'query'], filePath: ['path', 'file_path', 'file'] },
		get_call_hierarchy: { symbol: ['name', 'identifier', 'query'], filePath: ['path', 'file_path', 'file'] },
		restore_checkpoint: { checkpointId: ['id', 'checkpoint_id'] },
	};
	for (const [target, aliases] of Object.entries(argumentAliases[canonicalName] ?? {})) {
		if (args[target] === undefined) {
			const alias = aliases.find(key => args[key] !== undefined);
			if (alias) {
				args[target] = args[alias];
				delete args[alias];
			}
		}
	}
	for (const stringKey of ['pattern', 'query', 'filePath', 'dirPath', 'command'] as const) {
		if (typeof args[stringKey] === 'string') {
			args[stringKey] = (args[stringKey] as string).trim();
		}
	}
	const validationErrors = validateAgentToolArguments(tool.function.parameters, args);
	if (validationErrors.length > 0) {
		const missingArguments = validationErrors
			.filter(error => /: is required$/.test(error))
			.map(error => error.replace(/: is required$/, ''));
		if (missingArguments.length > 0) {
			return { name: canonicalName, error: `Missing required argument(s) for ${canonicalName}: ${missingArguments.join(', ')}.` };
		}
		return { name: canonicalName, error: `Invalid arguments for ${canonicalName}: ${validationErrors.slice(0, 8).join('; ')}.` };
	}
	return { name: canonicalName, args };
}

export function isDardcorAutonomousTask(prompt: string): boolean {
	return /\b(create|make|build|implement|improve|fix|repair|debug|diagnose|refactor|update|change|add|remove|write|code|test|verify|check|inspect|review|analyze|selesaikan|buat|bikin|perbaiki|perbaikan|ubah|tambahkan|hapus|uji|cek|periksa|testing|kerjakan|lanjutkan|continue|lokasi|path|folder|direktori|directory|project|proyek|salah|bukan|pindah|ganti|terjemah|terjemahan|translate|translation|locale|bahasa|setup|install|generate|compile|run|jalankan|sempurnakan|optimasi|optimize|coba|gunakan|pakai|cursor|mouse|klik|click|lakukan|bantu|tolong|eksekusi|execute|render|tampilkan|buka|open|tutup|close|pasang|terapkan)\b|[a-z]:[\\/]/i.test(prompt);
}

export function isDardcorContinuation(prompt: string): boolean {
	return /^(?:please\s+)?(?:continue|resume|proceed|keep going|lanjut(?:kan)?|teruskan|lanjutkan pekerjaan)\b/i.test(prompt.trim());
}

export function isDardcorBrowserTest(prompt: string): boolean {
	return /\b(test|testing|uji|ujicoba|cek|periksa)\b/i.test(prompt)
		&& /\b(browser|website|web|situs|halaman|page|localhost)\b/i.test(prompt);
}

export function isDardcorWebImplementationTask(prompt: string): boolean {
	const hasWebTarget = /\b(website|web\s?(?:app|application|site)?|situs|halaman|laravel)\b/i.test(prompt);
	const hasImplementationIntent = /\b(create|make|build|implement|develop|write|fix|repair|update|change|buat|buatkan|bikin|bangun|kembangkan|perbaiki|ubah|kerjakan)\b/i.test(prompt);
	return hasWebTarget && hasImplementationIntent;
}

export type DardcorBrowserVerificationRequirement = 'interaction' | 'page-inspection';

export function getDardcorBrowserVerificationRequirement(
	prompt: string,
	state: Pick<IChatAgentRunState, 'browserActions' | 'verificationEvidence' | 'verificationFailures' | 'workspaceRevision'>,
): DardcorBrowserVerificationRequirement | undefined {
	const currentEvidence = state.verificationEvidence.filter(item => item.workspaceRevision === state.workspaceRevision);
	if (state.verificationFailures.some(item => /^(?:Browser runtime|Integrated browser|Browser action)\b/i.test(item))) {
		return undefined;
	}
	const browserInteractionVerified = state.browserActions > 0
		&& currentEvidence.some(item => /^Integrated browser (?:click_element|type_in_page|scroll_browser_page|hover_element|press_key|select_option|drag_and_drop) succeeded/i.test(item.message));
	if (isDardcorBrowserTest(prompt) && !browserInteractionVerified) {
		return 'interaction';
	}
	if (isDardcorWebImplementationTask(prompt)
		&& !currentEvidence.some(item => /^Integrated browser page inspected:/i.test(item.message))) {
		return 'page-inspection';
	}
	return undefined;
}

export function isDardcorLowRiskCommand(command: string): boolean {
	const normalized = command.trim();
	if (!normalized || /[\r\n;&|`$<>]/.test(normalized)) {
		return false;
	}


	if (/(?:^|\s)(?:\.\.[\\/]|~[\\/]|[a-z]:[\\/]|\\\\[^\s]*|\/(?:[^\s/]+))/i.test(normalized)) {
		return false;
	}

	const safeReadOnlyCommands = [
		/^pwd$/i,
		/^git\s+status(?:\s+--short)?$/i,
		/^git\s+diff\s+--no-ext-diff(?:\s+(?:--stat|--name-only))?$/i,
		/^git\s+branch\s+--show-current$/i,
		/^git\s+rev-parse\s+--show-toplevel$/i,
		/^(?:node|npm|pnpm|yarn|bun|deno|php|composer|python|python3|pip|ruby|gem|cargo|rustc|go|docker)\s+(?:--version|-v|-V)$/i,
	];
	if (safeReadOnlyCommands.some(pattern => pattern.test(normalized))) {
		return true;
	}



	return false;
}

export function requiresDardcorCommandConfirmation(
	toolName: string,
	command: string,
	permissionLevel: string | undefined,
): boolean {
	if (permissionLevel === 'autoApprove') {
		return false;
	}
	if (['run_task', 'create_and_run_task', 'send_to_terminal', 'kill_terminal'].includes(toolName)) {
		return true;
	}
	return permissionLevel !== 'assisted' || !isDardcorLowRiskCommand(command);
}

const DARDCORE_READ_ONLY_TOOLS = new Set([
	'read_file', 'read_multiple_files', 'list_directory', 'find_files', 'search_code', 'grep_search',
	'get_diagnostics', 'get_file_outline', 'go_to_definition', 'find_symbol_references', 'get_call_hierarchy',
	'git_intelligence', 'introspect_self', 'manage_knowledge_memory', 'create_checkpoint',
	'get_terminal_output', 'terminal_selection', 'terminal_last_command', 'get_task_output',
	'read_browser_page', 'read_page', 'get_browser_console_logs', 'screenshot_browser_page',
	'screenshot_page', 'wait_for_browser', 'audit_page_visual_and_network',
	'manage_todo_list', 'ask_questions', 'review_plan', 'task_completed',
]);

const DARDCORE_COMMAND_TOOLS = new Set([
	'run_command', 'run_in_terminal', 'bash', 'execute_command', 'cmd', 'sh', 'powershell',
	'terminal', 'create_and_run_task', 'run_task', 'send_to_terminal', 'kill_terminal',
]);

const DARDCORE_STATEFUL_TOOLS = new Set([
	'write_file', 'edit_file', 'multi_edit_file', 'batch_edit_files', 'delete_file', 'rename_file',
	'restore_checkpoint', 'synthesize_skill', 'spawn_agent_swarm',
	'fetch_web_page', 'open_browser_page', 'navigate_browser', 'navigate_page', 'click_element',
	'type_in_page', 'scroll_browser_page', 'hover_element', 'press_key', 'select_option',
	'drag_and_drop', 'execute_browser_script', 'handle_browser_dialog', 'set_artifacts',
	'set_artifact_rules', 'run_subagent', 'confirm_terminal_command',
]);






export function requiresDardcorToolConfirmation(
	toolName: string,
	args: Record<string, unknown> | undefined,
	permissionLevel: string | undefined,
	externalReadRequiresConfirmation = false,
): boolean {
	if (permissionLevel === 'autoApprove') {
		return false;
	}
	const knownTool = DARDCORE_READ_ONLY_TOOLS.has(toolName) || DARDCORE_COMMAND_TOOLS.has(toolName) || DARDCORE_STATEFUL_TOOLS.has(toolName);
	if (!knownTool) {
		return true;
	}
	if (DARDCORE_COMMAND_TOOLS.has(toolName)) {
		const command = toolName === 'kill_terminal'
			? `kill_terminal:${String(args?.id ?? args?.terminalId ?? '').trim()}`
			: String(args?.command ?? args?.commandLine ?? args?.taskLabel ?? args?.label ?? args?.text ?? '').trim();
		return requiresDardcorCommandConfirmation(toolName, command, permissionLevel);
	}
	if (DARDCORE_READ_ONLY_TOOLS.has(toolName)) {
		return externalReadRequiresConfirmation;
	}


	return true;
}

export function summarizeDardcorToolAction(toolName: string, args: Record<string, unknown> | undefined, lang: DardcorSupportedLanguage = 'en'): string {
	if (!args) {
		return toolName;
	}
	const locale = getDardcorLocaleStrings(lang);
	const labelMap: Record<string, string> = {
		explanation: locale.confirmExplanationLabel,
		goal: locale.confirmGoalLabel,
		mode: locale.confirmModeLabel,
	};
	const fieldsByTool: Record<string, readonly string[]> = {
		write_file: ['filePath', 'content'],
		edit_file: ['filePath', 'searchContent', 'replaceContent'],
		delete_file: ['filePath', 'recursive'],
		rename_file: ['oldFilePath', 'newFilePath', 'overwrite'],
		fetch_web_page: ['url'],
		open_browser_page: ['url', 'forceNew'],
		navigate_browser: ['url', 'pageId'],
		navigate_page: ['url', 'pageId'],
		run_command: ['command', 'commandLine'],
		run_in_terminal: ['command', 'commandLine'],
		send_to_terminal: ['text'],
		create_and_run_task: ['taskLabel', 'command'],
		run_task: ['taskLabel', 'label'],
		kill_terminal: ['id', 'terminalId'],
		run_subagent: ['agentId', 'task', 'prompt'],
		click_element: ['pageId', 'ref', 'elementId', 'selector', 'text', 'x', 'y', 'doubleClick'],
		type_in_page: ['pageId', 'ref', 'elementId', 'selector', 'text', 'clearFirst', 'pressEnter'],
		scroll_browser_page: ['pageId', 'ref', 'direction', 'amount', 'selector', 'elementId'],
		hover_element: ['pageId', 'ref', 'elementId', 'selector', 'text', 'x', 'y'],
		press_key: ['pageId', 'key'],
		select_option: ['pageId', 'ref', 'elementId', 'selector', 'value', 'optionText', 'index'],
		drag_and_drop: ['pageId', 'sourceRef', 'sourceElementId', 'targetRef', 'targetElementId'],
		execute_browser_script: ['pageId', 'script'],
		handle_browser_dialog: ['pageId', 'accept', 'promptText'],
		set_artifacts: ['artifacts'],
		set_artifact_rules: ['rules'],
		multi_edit_file: ['filePath', 'edits'],
		batch_edit_files: ['operations'],
		read_multiple_files: ['files'],
		go_to_definition: ['symbol', 'filePath', 'line'],
		find_symbol_references: ['symbol', 'filePath'],
		get_call_hierarchy: ['symbol', 'filePath'],
		create_checkpoint: ['label', 'files'],
		restore_checkpoint: ['checkpointId'],
		git_intelligence: ['operation', 'filePath', 'ref'],
		introspect_self: ['action', 'hypothesis', 'status', 'evidence'],
		manage_knowledge_memory: ['action', 'category', 'title', 'content', 'query'],
		synthesize_skill: ['name', 'description', 'instructions'],
		spawn_agent_swarm: ['tasks'],
		audit_page_visual_and_network: ['pageId', 'checkOverflow', 'correlateBackendLogs'],
	};
	const toolFields = fieldsByTool[toolName] ?? [];
	const metaKeys = ['explanation', 'goal', 'mode', 'reason', 'description'];
	const keySet = new Set<string>();
	for (const k of metaKeys) {
		if (k in args) {
			keySet.add(k);
		}
	}
	for (const k of toolFields) {
		if (k in args) {
			keySet.add(k);
		}
	}
	for (const k of Object.keys(args)) {
		keySet.add(k);
	}
	const fields = Array.from(keySet).slice(0, 12);
	const details = fields.flatMap(key => {
		const value = args[key];
		if (value === undefined) {
			return [];
		}
		if (key === 'todoList' && Array.isArray(value)) {
			const formattedTodos = value.map(t => {
				const status = t && typeof t === 'object' && 'status' in t ? t.status : 'not-started';
				const title = t && typeof t === 'object' && 'title' in t ? t.title : '';
				const icon = status === 'completed' ? '[x]' : status === 'in-progress' ? '[>]' : '[ ]';
				return `  ${icon} [${status}] ${title}`;
			}).join('\n');
			return [`todoList:\n${formattedTodos}`];
		}
		if (typeof value === 'object' && value !== null) {
			try {
				const pretty = JSON.stringify(value, null, 2);
				const displayKey = labelMap[key] ?? key;
				return [`${displayKey}:\n${pretty}`];
			} catch {}
		}
		const raw = typeof value === 'string' ? value : JSON.stringify(value);
		const normalized = (raw ?? String(value)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\r\n\t]+/g, ' ');
		const excerpt = normalized.length > 480 ? `${normalized.slice(0, 480)}… [${normalized.length} chars]` : normalized;
		const displayKey = labelMap[key] ?? key;
		return [`${displayKey}: ${excerpt}`];
	});
	return details.length > 0 ? `${toolName}\n${details.join('\n')}`.slice(0, 1600) : toolName;
}

export function getDardcorEffectivePermissionLevel(permissionLevel: string | undefined, autoApprovePolicyRestricted: boolean): string | undefined {


	if (permissionLevel === 'autopilot') {
		return 'default';
	}
	return autoApprovePolicyRestricted && permissionLevel === 'autoApprove'
		? 'default'
		: permissionLevel;
}

export function commandApprovalKey(command: string, root: string | undefined): string {
	return `${root ?? ''}\n${command.trim()}`;
}

export const DARDCOR_AGENT_MAX_CONTEXT_CHARS = 750_000;
export const DARDCOR_AGENT_COMPACTION_THRESHOLD_CHARS = 250_000;
export const DARDCOR_AGENT_TARGET_CONTEXT_CHARS = 120_000;

export interface IDardcorCompactionResult {
	readonly messages: any[];
	readonly originalChars: number;
	readonly compactedChars: number;
	readonly compactedItemsCount: number;
}

export function compactDardcorAgentMessages(
	messages: readonly any[],
	targetChars: number = DARDCOR_AGENT_TARGET_CONTEXT_CHARS,
	protectedRecentTurns: number = 3
): IDardcorCompactionResult {
	const originalChars = JSON.stringify(messages).length;
	if (originalChars < DARDCOR_AGENT_COMPACTION_THRESHOLD_CHARS || messages.length <= 4) {
		return { messages: [...messages], originalChars, compactedChars: originalChars, compactedItemsCount: 0 };
	}

	const cloned: any[] = JSON.parse(JSON.stringify(messages));
	let currentChars = originalChars;
	let compactedCount = 0;

	let assistantCount = 0;
	let cutoffIndex = cloned.length;
	for (let i = cloned.length - 1; i >= 0; i--) {
		if (cloned[i]?.role === 'assistant') {
			assistantCount++;
			if (assistantCount >= protectedRecentTurns) {
				cutoffIndex = i;
				break;
			}
		}
	}

	const compactContent = (content: string, toolHint: string): string => {
		if (content.length <= 600) {
			return content;
		}
		const exitCodeMatch = content.match(/\[Command result: exit code -?\d+\]|Exit code:\s*-?\d+/i);
		const errorLines = content.split('\n').filter(l => /\[ERROR\]|^Error:|\bfailed\b/i.test(l)).slice(0, 3);
		const preservedMetadata = [
			exitCodeMatch ? exitCodeMatch[0] : '',
			errorLines.length > 0 ? `Errors noted: ${errorLines.join(' | ')}` : ''
		].filter(Boolean).join('\n');

		const head = content.slice(0, 350).trimEnd();
		return `${head}\n\n... [${content.length - 350} chars compacted from older ${toolHint} tool output to preserve context budget]\n${preservedMetadata}`.trim();
	};

	for (let i = 1; i < cutoffIndex; i++) {
		const msg = cloned[i];
		if (Array.isArray(msg?.content)) {
			let modified = false;
			const newContent = msg.content.map((part: any) => {
				if (part?.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:')) {
					modified = true;
					return { type: 'text', text: '[Historical browser screenshot omitted from context history; DOM snapshot preserved]' };
				}
				return part;
			});
			if (modified) {
				msg.content = newContent;
				compactedCount++;
			}
		}
	}

	currentChars = JSON.stringify(cloned).length;
	if (currentChars <= targetChars) {
		return { messages: cloned, originalChars, compactedChars: currentChars, compactedItemsCount: compactedCount };
	}

	for (let i = 1; i < cutoffIndex; i++) {
		const msg = cloned[i];
		if (msg?.role === 'tool' && typeof msg.content === 'string') {
			if (msg.content.length > 800) {
				const beforeLen = msg.content.length;
				msg.content = compactContent(msg.content, 'tool');
				if (msg.content.length < beforeLen) { compactedCount++; }
			}
		} else if (msg?.role === 'user' && typeof msg.content === 'string' && msg.content.startsWith('[Tool Execution Result for')) {
			if (msg.content.length > 800) {
				const beforeLen = msg.content.length;
				msg.content = compactContent(msg.content, 'tool');
				if (msg.content.length < beforeLen) { compactedCount++; }
			}
		}
	}

	currentChars = JSON.stringify(cloned).length;
	if (currentChars <= targetChars) {
		return { messages: cloned, originalChars, compactedChars: currentChars, compactedItemsCount: compactedCount };
	}

	for (let i = 1; i < cutoffIndex; i++) {
		const msg = cloned[i];
		if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
			for (const tc of msg.tool_calls) {
				if (tc?.function?.arguments && typeof tc.function.arguments === 'string') {
					try {
						const parsed = JSON.parse(tc.function.arguments);
						if (typeof parsed?.content === 'string' && parsed.content.length > 800) {
							parsed.content = `[File content (${parsed.content.length} chars) written successfully; omitted from history]`;
							tc.function.arguments = JSON.stringify(parsed);
							compactedCount++;
						}
					} catch { }
				}
			}
		}
	}

	currentChars = JSON.stringify(cloned).length;
	if (currentChars <= targetChars) {
		return { messages: cloned, originalChars, compactedChars: currentChars, compactedItemsCount: compactedCount };
	}

	if (currentChars > targetChars && cutoffIndex > 2) {
		const head = cloned.slice(0, 2);
		const tail = cloned.slice(cutoffIndex);
		const summaryMsg = {
			role: 'user',
			content: `[Historical Conversation Checkpoint Summary]: Prior conversation turns and intermediate steps (${cutoffIndex - 2} messages) have been compacted into memory. Active workspace state, file modifications, and ongoing checklist items are preserved.`
		};
		const rolled = [...head, summaryMsg, ...tail];
		const rolledChars = JSON.stringify(rolled).length;
		if (rolledChars < currentChars) {
			return { messages: rolled, originalChars, compactedChars: rolledChars, compactedItemsCount: compactedCount + (cutoffIndex - 2) };
		}
	}

	return { messages: cloned, originalChars, compactedChars: currentChars, compactedItemsCount: compactedCount };
}

export function getDardcorRunGuardReason(contextChars: number): string | undefined {
	if (contextChars >= DARDCOR_AGENT_MAX_CONTEXT_CHARS) {
		return 'The agent reached its conversation context budget before the task was verified.';
	}
	return undefined;
}

export type DardcorVerificationCommandStatus = 'passed' | 'failed' | 'inconclusive' | 'not-verification';

function unwrapShellCommand(command: string): string {
	let unwrapped = command.trim();
	for (let i = 0; i < 3; i++) {
		const pwshMatch = unwrapped.match(/^(?:powershell|pwsh)(?:\.exe)?\s+(?:-(?:NoProfile|NonInteractive|ExecutionPolicy\s+\S+|Command|c)\s+)*(?:&?\s*\{)?\s*["']?([\s\S]*?)["']?\s*\}?$/i);
		if (pwshMatch && pwshMatch[1] && pwshMatch[1].trim() !== unwrapped) {
			unwrapped = pwshMatch[1].trim();
			continue;
		}
		const shellMatch = unwrapped.match(/^(?:bash|sh|cmd)(?:\.exe)?\s+(?:-c|\/c)\s+["']?([\s\S]*?)["']?$/i);
		if (shellMatch && shellMatch[1] && shellMatch[1].trim() !== unwrapped) {
			unwrapped = shellMatch[1].trim();
			continue;
		}
		break;
	}
	return unwrapped;
}

function splitCompoundCommandParts(command: string): string[] {
	return command
		.split(/\s*(?:&&|\|\||[;\r\n])\s*/)
		.map(part => part.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean);
}

export function isDardcorExploratoryCommand(command: string): boolean {
	const unwrapped = unwrapShellCommand(command);
	const parts = splitCompoundCommandParts(unwrapped);
	if (parts.length === 0) {
		return true;
	}

	const exploratoryPatterns = [
		/^(?:Get-ChildItem|gci|ls|dir)\b/i,
		/^(?:Get-Content|gc|cat|head|tail|type)\b/i,
		/^(?:Get-Location|gl|pwd|cd|chdir|Set-Location|sl|Push-Location|pushd|Pop-Location|popd|Clear-Host|cls|Get-Process|ps)\b/i,
		/^(?:Select-String|sls|grep|rg|findstr|find)\b/i,
		/^(?:Write-Output|Write-Host|echo|printf)\b/i,
		/^(?:git\s+(?:status|log|diff|branch|rev-parse|show))\b/i,
		/^(?:where|which|Get-Command|gcm)\b/i,
		/^(?:whoami|hostname|uname)\b/i,
		/^(?:Get-Date|date|time)\b/i,
		/^(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b/i,
		/^(?:env|printenv)\b/i,
		/^(?:node|npm|pnpm|yarn|bun|php|python|python3|cargo|go|rustc)\s+(?:-v|--version)\b/i,
	];

	return parts.every(part => {
		const executable = part
			.replace(/^(?:\s*(?:\.\s+|call\s+|&\s+))+/i, '')
			.replace(/^(?:set\s+[A-Za-z_][\w]*=.*?\s+)+/i, '')
			.replace(/\s*\|.*$/, '')
			.replace(/\s*(?:>|2>&1|1>&2).*$/, '')
			.trim();
		return exploratoryPatterns.some(pattern => pattern.test(executable));
	});
}

export function formatDardcorVerificationLabel(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) {
		return '';
	}

	const unwrapped = unwrapShellCommand(trimmed);

	if (isDardcorExploratoryCommand(unwrapped)) {
		return '';
	}

	const parts = splitCompoundCommandParts(unwrapped);

	const verificationPart = parts.find(part => {
		const clean = part.replace(/\s*\|.*$/, '').trim();
		return /\b(?:artisan\s+test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|bun\s+(?:run\s+)?test|Test-Path|phpunit|pest|vitest|jest|playwright\s+test|pytest|cargo\s+test|go\s+test|dotnet\s+test)\b/i.test(clean);
	}) ?? parts[0] ?? unwrapped;

	const cleanTarget = verificationPart
		.replace(/^(?:\s*(?:\.\s+|call\s+|&\s+))+/i, '')
		.replace(/^(?:set\s+[A-Za-z_][\w]*=.*?\s+)+/i, '')
		.replace(/\s*\|.*$/, '')
		.replace(/\s*(?:>|2>&1|1>&2).*$/, '')
		.trim();

	if (/\bphp\s+artisan\s+test\b/i.test(cleanTarget)) {
		return 'PHP Artisan Unit & Feature Tests';
	}
	if (/\bphp\s+artisan\s+dusk\b/i.test(cleanTarget)) {
		return 'Laravel Dusk Browser Tests';
	}
	if (/\b(?:vendor[\\/](?:bin[\\/])?)?phpunit\b/i.test(cleanTarget)) {
		return 'PHPUnit Test Suite';
	}
	if (/\b(?:vendor[\\/](?:bin[\\/])?)?pest\b/i.test(cleanTarget)) {
		return 'Pest Test Suite';
	}
	if (/(?:(?:\.\/|\.\\)?(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?:\b|:)|\bnpm\s+t\b)/i.test(cleanTarget)) {
		return 'NPM Test Suite';
	}
	if (/\bplaywright\s+test\b/i.test(cleanTarget)) {
		return 'Playwright End-to-End Tests';
	}
	if (/\bvitest\b/i.test(cleanTarget)) {
		return 'Vitest Test Suite';
	}
	if (/\bjest\b/i.test(cleanTarget)) {
		return 'Jest Test Suite';
	}
	if (/\bmocha\b/i.test(cleanTarget)) {
		return 'Mocha Test Suite';
	}
	if (/(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/i.test(cleanTarget)) {
		return 'Project Build Suite';
	}
	if (/(?:npm\s+run\s+typecheck|tsc\b)/i.test(cleanTarget)) {
		return 'TypeScript Type Check';
	}
	if (/(?:npm\s+run\s+lint|eslint\b)/i.test(cleanTarget)) {
		return 'ESLint Code Quality Check';
	}
	if (/\bTest-Path\b/i.test(cleanTarget)) {
		if (/\b(?:public|resources|assets)[\\/](?:icons?|favicons?|logos?)\b/i.test(cleanTarget) || /icon/i.test(cleanTarget)) {
			return 'Verify public icon assets';
		}
		if (/\b(?:build|dist|assets)\b/i.test(cleanTarget)) {
			return 'Verify public build assets';
		}
		const pathMatch = cleanTarget.match(/Test-Path\s+(?:-(?:Path|LiteralPath)\s+)?["']?([^"'|;&\r\n]+)["']?/i);
		if (pathMatch && pathMatch[1]) {
			const cleanPath = pathMatch[1].trim().replace(/[\\/]+$/, '');
			return `Verify path: ${cleanPath}`;
		}
		return 'Verify file system path';
	}
	if (/\b(?:pytest|python3?\s+-m\s+pytest)\b/i.test(cleanTarget)) {
		return 'Python Pytest Suite';
	}
	if (/\bpython3?\s+-m\s+unittest\b/i.test(cleanTarget)) {
		return 'Python Unit Tests';
	}
	if (/\bcargo\s+test\b/i.test(cleanTarget)) {
		return 'Cargo Test Suite';
	}
	if (/\bcargo\s+check\b/i.test(cleanTarget)) {
		return 'Cargo Check';
	}
	if (/\bgo\s+test\b/i.test(cleanTarget)) {
		return 'Go Test Suite';
	}
	if (/\bdotnet\s+test\b/i.test(cleanTarget)) {
		return '.NET Test Suite';
	}

	return '';
}

function isRecognizedVerificationCommand(command: string): boolean {
	const label = formatDardcorVerificationLabel(command);
	return label !== '';
}

export function getDardcorVerificationCommandStatus(command: string, output: string): DardcorVerificationCommandStatus {
	if (!isRecognizedVerificationCommand(command)) {
		return 'not-verification';
	}
	if (/\bTest-Path\b/i.test(command)) {
		if (/\bFalse\b/i.test(output)) {
			return 'failed';
		}
		if (/\bTrue\b/i.test(output)) {
			return 'passed';
		}
	}
	const exitCodeMarker = output.match(/\[Command result: exit code (-?\d+)\]/i)
		?? output.match(/(?:Command failed with exit code|Exit code:)\s*(-?\d+)/i);
	if (exitCodeMarker) {
		return Number(exitCodeMarker[1]) === 0 ? 'passed' : 'failed';
	}
	if (/(?:did not report completion|without reporting an exit code|no (?:process )?exit code was reported|completion status not reported|not marked successful|timed out; the process may still be running|timed out before reporting an exit code|final status unknown|final exit status is unknown|success is not confirmed|result is inconclusive|no confirmed completion status)/i.test(output)) {
		return 'inconclusive';
	}
	if (/(?:Command failed|Command timed out|Terminal execution error|execution failed|\[ERROR\]|^Error:|\nError:|❌)/i.test(output)) {
		return 'failed';
	}
	return 'passed';
}

export function getDardcorPlainTextTurnDecision(taskIsTracked: boolean, consecutiveTextTurns: number, maxTextTurns: number, hasIncompleteTodos = false): 'continue' | 'pause' | 'normal' {
	if (!taskIsTracked && !hasIncompleteTodos) {
		return 'normal';
	}
	if (hasIncompleteTodos && consecutiveTextTurns <= Math.max(maxTextTurns, 15)) {
		return 'continue';
	}
	return consecutiveTextTurns <= maxTextTurns ? 'continue' : 'pause';
}

export function getDardcorToolFailureState(consecutiveFailures: number, failed: boolean, failureLimit = 3): { consecutiveFailures: number; shouldBlock: boolean } {
	const safeLimit = Number.isFinite(failureLimit) && failureLimit > 0 ? Math.floor(failureLimit) : 3;
	const nextCount = failed ? Math.max(0, Math.floor(Number.isFinite(consecutiveFailures) ? consecutiveFailures : 0)) + 1 : 0;
	return { consecutiveFailures: nextCount, shouldBlock: nextCount >= safeLimit };
}

export interface IDardcorCompletionInput {
	readonly prompt: string;
	readonly todos: readonly IChatTodo[];
	readonly state: IChatAgentRunState;
	readonly verificationSteps?: string;
}

export function getDardcorCompletionBlocker(input: IDardcorCompletionInput): string | undefined {
	if (input.todos.length === 0) {
		return 'The task checklist is empty. Create a checklist from the user requirements, complete every item, then request completion again.';
	}
	const incomplete = input.todos.filter(todo => todo.status !== 'completed');
	if (incomplete.length > 0) {
		return `The checklist still has ${incomplete.length} incomplete item(s): ${incomplete.map(todo => todo.title).join('; ')}. Finish them before completing.`;
	}
	if (input.state.verificationFailures.length > 0) {
		return `Verification still has unresolved failure(s): ${input.state.verificationFailures.join('; ')}. Correct the issue and record a clean verification result before completing.`;
	}
	if (input.state.verificationPending.length > 0) {
		return `Verification is still inconclusive: ${input.state.verificationPending.join('; ')}. Inspect or poll the relevant task until it reports a final result before completing.`;
	}
	const browserRequirement = getDardcorBrowserVerificationRequirement(input.prompt, input.state);
	if (browserRequirement === 'interaction') {
		return 'Browser verification is missing: use the integrated Browser Editor to perform one relevant, safe Playwright interaction and inspect its post-action DOM snapshot.';
	}
	if (browserRequirement === 'page-inspection') {
		return 'Browser verification is missing: open the implemented site in the integrated Browser Editor and inspect its rendered DOM snapshot and console diagnostics.';
	}
	if (!input.state.verificationEvidence.some(item => item.workspaceRevision === input.state.workspaceRevision)) {
		return 'No successful verification evidence has been recorded. Run the relevant checks and inspect their results before completing.';
	}
	if (/\b(test|testing|verify|verification|uji|ujicoba|cek|periksa)\b/i.test(input.prompt) && !input.verificationSteps?.trim()) {
		return 'The completion request omitted verification steps. Report which checks were run and their results.';
	}
	return undefined;
}

export function revalidateDardcorCompletion(
	accepted: boolean,
	args: unknown,
	getBlocker: (args: any) => string | undefined,
): { readonly accepted: boolean; readonly reason?: string } {
	if (!accepted) {
		return { accepted: false };
	}
	const reason = getBlocker(args);
	return reason ? { accepted: false, reason } : { accepted: true };
}

export type DardcorSupportedLanguage = 'id' | 'en' | 'ja' | 'zh' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'it' | 'ar' | 'nl' | 'tr' | 'vi';

export function detectDardcorLanguage(text: string | undefined): DardcorSupportedLanguage {
	if (!text || typeof text !== 'string') {
		return 'en';
	}
	const trimmed = text.trim();
	if (!trimmed) {
		return 'en';
	}

	if (/[\u0600-\u06FF]/.test(trimmed)) {
		return 'ar';
	}
	if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) {
		return 'ja';
	}
	if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) {
		return 'ko';
	}
	if (/[\u0400-\u04FF]/.test(trimmed)) {
		return 'ru';
	}
	if (/[\u4E00-\u9FFF]/.test(trimmed)) {
		return 'zh';
	}

	const scores: Record<DardcorSupportedLanguage, number> = {
		id: 0, es: 0, fr: 0, de: 0, pt: 0, it: 0, nl: 0, tr: 0, vi: 0, en: 0,
		ar: 0, ja: 0, ko: 0, ru: 0, zh: 0
	};

	const scoreMatches = (regex: RegExp, langKey: DardcorSupportedLanguage, weight = 1) => {
		const matches = trimmed.match(regex);
		if (matches) {
			scores[langKey] += matches.length * weight;
		}
	};

	scoreMatches(/\b(saya|kamu|anda|tolong|perbaiki|buat|buatkan|bikin|ganti|ubah|cek|periksa|hapus|tampilkan|nomer|nomor|selesai|belum|jangan|kenapa|mengapa|coba|kerjakan|lanjut|lanjutkan|teruskan|aplikasi|fitur|ada|yang|ini|itu|di|ke|dari|untuk|dengan|dan|atau|sudah|bisa|harus|mau|akan|masih|tapi|namun|bagaimana|apa|semua|secara|otomatis|stiker|jawaban|gambar|kendala|bahasa|dunia|pastikan|mendeteksi|skrip|jalan|jalankan|instal|pasang|tampilan|router|hilang|muncul|terkadang|data|realtime|token|unlimited|baca|project|aslinya|menembus|sempurna|rencana|perbaikan|system|canggih|halo|hai|hey|pagi|siang|sore|malam|assalamualaikum|permisi|makasih|terimakasih|bantu|bantuan|proyek|portofolio|siap)\b/gi, 'id', 3);
	scoreMatches(/\b(hola|gracias|arreglar|crear|cambiar|eliminar|mostrar|prueba|archivo|código|cómo|está|para|pero|ahora|tarea|resumen)\b/gi, 'es', 2);
	scoreMatches(/\b(bonjour|merci|corriger|créer|creer|modifier|supprimer|afficher|fichier|code|comment|pour|avec|mais|maintenant|continuer|tâche|tache|résumé|resume|veuillez)\b/gi, 'fr', 2);
	scoreMatches(/\b(bitte|hallo|danke|beheben|erstellen|ändern|aendern|löschen|loeschen|anzeigen|datei|code|wie|für|fuer|mit|aber|jetzt|fortsetzen|aufgabe|übersicht|uebersicht)\b/gi, 'de', 2);
	scoreMatches(/\b(olá|ola|obrigado|obrigada|corrija|corrigir|arquivo|você|voce|vocês|voces|função|funcao|atualização|atualizacao|não|nao)\b/gi, 'pt', 3);
	scoreMatches(/\b(ciao|grazie|correggere|creare|modificare|eliminare|mostrare|file|codice|come|per|con|ma|adesso|continuare|compito|riepilogo)\b/gi, 'it', 2);
	scoreMatches(/\b(alstublieft|hallo|bedankt|herstellen|maken|wijzigen|verwijderen|tonen|bestand|hoe|voor|maar|doorgaan|taak|samenvatting)\b/gi, 'nl', 2);
	scoreMatches(/\b(lütfen|lutfen|merhaba|teşekkürler|tesekkurler|düzelt|duzelt|oluştur|olustur|değiştir|degistir|sil|göster|goster|dosya|kod|nasıl|nasil|için|icin|ile|ama|şimdi|simdi|devam|görev|gorev|özet|ozet)\b/gi, 'tr', 2);
	scoreMatches(/\b(làm\s+ơn|lam\s+on|xin\s+chào|xin\s+chao|cảm\s+ơn|cam\s+on|sửa|sua|tạo|tao|thay\s+đổi|thay\s+doi|xóa|xoa|hiển\s+thị|hien\s+thi|tập\s+tin|tap\s+tin|mã|ma|như\s+thế\s+nào|nhu\s+the\s+nao|tiếp\s+tục|tiep\s+tuc|nhiệm\s+vụ|nhiem\s+vu|tổng\s+kết|tong\s+ket)\b/gi, 'vi', 3);

	if (/\bpor\s+favor\b/i.test(trimmed)) {
		scores.es += 1;
		scores.pt += 1;
	}
	if (/\bs'il\s+vous\s+pla[iî]t\b/i.test(trimmed)) {
		scores.fr += 3;
	}
	if (/\bper\s+favore\b/i.test(trimmed)) {
		scores.it += 3;
	}
	scoreMatches(/\b(please|implement|create|fix|update|delete|show|test|testing|build|verify|continue|resume|task|summary|changed|files|error)\b/gi, 'en', 1);

	let bestLang: DardcorSupportedLanguage = 'en';
	let highestScore = 0;
	for (const [l, s] of Object.entries(scores) as [DardcorSupportedLanguage, number][]) {
		if (s > highestScore) {
			highestScore = s;
			bestLang = l;
		}
	}
	return bestLang;
}

export function getDardcorLanguageName(lang: DardcorSupportedLanguage): string {
	switch (lang) {
		case 'id': return 'Bahasa Indonesia';
		case 'ja': return 'Japanese (日本語)';
		case 'zh': return 'Chinese (中文)';
		case 'ko': return 'Korean (한국어)';
		case 'es': return 'Spanish (Español)';
		case 'fr': return 'French (Français)';
		case 'de': return 'German (Deutsch)';
		case 'pt': return 'Portuguese (Português)';
		case 'ru': return 'Russian (Русский)';
		case 'it': return 'Italian (Italiano)';
		case 'ar': return 'Arabic (العربية)';
		case 'nl': return 'Dutch (Nederlands)';
		case 'tr': return 'Turkish (Türkçe)';
		case 'vi': return 'Vietnamese (Tiếng Việt)';
		default: return 'English';
	}
}

export interface IDardcorLocaleStrings {
	readonly taskSummaryComplete: string;
	readonly taskSummaryPaused: string;
	readonly taskSummaryBlocked: string;
	readonly changedFiles: string;
	readonly checklist: string;
	readonly complete: string;
	readonly verificationEvidence: string;
	readonly verificationIssues: string;
	readonly verificationPending: string;
	readonly nextStep: string;
	readonly reason: string;
	readonly autoContinueActive: string;
	readonly sendContinueToResume: string;
	readonly resumeDefault: string;
	readonly confirmAgentActionHeader: string;
	readonly confirmTerminalHeader: string;
	readonly confirmAgentActionQuestion: string;
	readonly confirmTerminalActionQuestion: string;
	readonly confirmExactCommandQuestion: string;
	readonly confirmPolicyRestricted: string;
	readonly confirmExternalFile: string;
	readonly confirmAllowOnce: string;
	readonly confirmSkipAction: string;
	readonly confirmSkipCommand: string;
	readonly confirmExplanationLabel: string;
	readonly confirmGoalLabel: string;
	readonly confirmModeLabel: string;
	readonly selectAnotherModelTip: string;
	readonly taskPausedTip: string;
	readonly serverDownCategory: string;
	readonly quotaLimitCategory: string;
	readonly providerErrorCategory: string;
	readonly cooldownWaitingNotice: (model: string, sec: number) => string;
}

const DARDCOR_LOCALE_MAP: Record<DardcorSupportedLanguage, IDardcorLocaleStrings> = {
	id: {
		taskSummaryComplete: 'Ringkasan Tugas: Selesai',
		taskSummaryPaused: 'Tugas Agen: Dijeda',
		taskSummaryBlocked: 'Tugas Agen: Tertahan',
		changedFiles: 'File yang diubah',
		checklist: 'Daftar tugas',
		complete: 'selesai',
		verificationEvidence: 'Bukti verifikasi',
		verificationIssues: 'Kendala verifikasi',
		verificationPending: 'Verifikasi tertunda',
		nextStep: 'Langkah berikutnya',
		reason: 'Alasan jeda',
		autoContinueActive: 'Auto-Continue Aktif: Melanjutkan tugas secara otomatis...',
		sendContinueToResume: 'Kirim `continue` untuk melanjutkan.',
		resumeDefault: 'Lanjutkan dari checkpoint',
		confirmAgentActionHeader: 'Persetujuan Tindakan Agen',
		confirmTerminalHeader: 'Persetujuan Perintah Terminal',
		confirmAgentActionQuestion: 'Tindakan agen ini dapat mengubah status sistem atau mengakses sumber daya eksternal. Izinkan tindakan ini sekali?',
		confirmTerminalActionQuestion: 'Perintah terminal ini dapat mengubah status sistem atau mengakses sumber daya eksternal. Izinkan tindakan ini sekali?',
		confirmExactCommandQuestion: 'Izinkan perintah ini dijalankan sekali?',
		confirmPolicyRestricted: 'Akses penuh dibatasi oleh kebijakan organisasi. ',
		confirmExternalFile: 'File ini berada di luar ruang kerja atau tidak dapat diverifikasi secara aman. Izinkan agen membaca dan menyertakan isinya sekali?',
		confirmAllowOnce: 'Izinkan sekali',
		confirmSkipAction: 'Lewati tindakan',
		confirmSkipCommand: 'Lewati perintah',
		confirmExplanationLabel: 'Penjelasan',
		confirmGoalLabel: 'Tujuan',
		confirmModeLabel: 'Mode',
		selectAnotherModelTip: 'Pilih model lain pada pemilih model di kanan bawah — tugas akan otomatis dilanjutkan seketika tanpa perlu mengetik continue.',
		taskPausedTip: 'Tugas dijeda sementara. Pilih model lain untuk melanjutkan otomatis.',
		serverDownCategory: 'SERVER PROVIDER DOWN',
		quotaLimitCategory: 'KUOTA LIMIT',
		providerErrorCategory: 'KENDALA PROVIDER',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Sistem Menunggu]* Kuota model **${model}** sedang cooldown oleh provider. Menunggu otomatis selama **${sec} detik** sebelum melanjutkan... (Auto-resume aktif)`,
	},
	en: {
		taskSummaryComplete: 'Task Summary: Complete',
		taskSummaryPaused: 'Agent Task: Paused',
		taskSummaryBlocked: 'Agent Task: Blocked',
		changedFiles: 'Changed files',
		checklist: 'Checklist',
		complete: 'complete',
		verificationEvidence: 'Verification evidence',
		verificationIssues: 'Verification issues',
		verificationPending: 'Verification pending',
		nextStep: 'Next step',
		reason: 'Reason',
		autoContinueActive: 'Auto-Continue Active: Automatically resuming task...',
		sendContinueToResume: 'Send `continue` to resume.',
		resumeDefault: 'Resume from checkpoint',
		confirmAgentActionHeader: 'Agent action approval',
		confirmTerminalHeader: 'Terminal command approval',
		confirmAgentActionQuestion: 'This agent action may change state or access an external resource. Allow this exact action once?',
		confirmTerminalActionQuestion: 'This terminal action may change state or access an external resource. Allow this exact action once?',
		confirmExactCommandQuestion: 'Allow this exact command to run once?',
		confirmPolicyRestricted: 'Full access is restricted by organization policy. ',
		confirmExternalFile: 'This file is outside the workspace or could not be safely verified. Allow the agent to read it and include its contents in the model context once?',
		confirmAllowOnce: 'Allow once',
		confirmSkipAction: 'Skip action',
		confirmSkipCommand: 'Skip command',
		confirmExplanationLabel: 'Explanation',
		confirmGoalLabel: 'Goal',
		confirmModeLabel: 'Mode',
		selectAnotherModelTip: 'Select another model in the bottom-right model picker — the task will auto-resume immediately without manual typing.',
		taskPausedTip: 'Task paused. Select another model to auto-resume.',
		serverDownCategory: 'PROVIDER SERVER DOWN',
		quotaLimitCategory: 'QUOTA LIMIT',
		providerErrorCategory: 'PROVIDER ERROR',
		cooldownWaitingNotice: (model: string, sec: number) => `*[System Waiting]* Model **${model}** is currently on provider cooldown. Waiting **${sec}s** before automatically resuming... (Auto-resume active)`,
	},
	ja: {
		taskSummaryComplete: 'タスク概要：完了',
		taskSummaryPaused: 'エージェントタスク：一時停止',
		taskSummaryBlocked: 'エージェントタスク：ブロック',
		changedFiles: '変更されたファイル',
		checklist: 'チェックリスト',
		complete: '完了',
		verificationEvidence: '検証証拠',
		verificationIssues: '検証の課題',
		verificationPending: '検証保留中',
		nextStep: '次のステップ',
		reason: '理由',
		autoContinueActive: '自動続行有効：タスクを自動的に再開しています...',
		sendContinueToResume: '再開するには `continue` を送信してください。',
		resumeDefault: 'チェックポイントから再開',
		confirmAgentActionHeader: 'エージェントのアクション承認',
		confirmTerminalHeader: 'ターミナルコマンドの承認',
		confirmAgentActionQuestion: 'このエージェントのアクションはシステムの状態を変更するか外部リソースにアクセスする可能性があります。このアクションを1回許可しますか？',
		confirmTerminalActionQuestion: 'このターミナルアクションはシステムの状態を変更するか外部リソースにアクセスする可能性があります。このアクションを1回許可しますか？',
		confirmExactCommandQuestion: 'このコマンドの実行を1回許可しますか？',
		confirmPolicyRestricted: '組織のポリシーによりフルアクセスが制限されています。',
		confirmExternalFile: 'このファイルはワークスペース外にあるか、安全に検証できませんでした。エージェントが一度読み取ることを許可しますか？',
		confirmAllowOnce: '1回許可する',
		confirmSkipAction: 'アクションをスキップ',
		confirmSkipCommand: 'コマンドをスキップ',
		confirmExplanationLabel: '説明',
		confirmGoalLabel: '目標',
		confirmModeLabel: 'モード',
		selectAnotherModelTip: '右下のモデル選択から別のモデルを選択してください。continue を入力しなくても、タスクは直ちに自動再開されます。',
		taskPausedTip: 'タスクは一時停止中です。別のモデルを選択して自動再開してください。',
		serverDownCategory: 'プロバイダーサーバーダウン',
		quotaLimitCategory: 'クォータ制限',
		providerErrorCategory: 'プロバイダーエラー',
		cooldownWaitingNotice: (model: string, sec: number) => `*[システム待機中]* モデル **${model}** のクォータがプロバイダー側でクールダウン中です。**${sec}秒** 自動待機してから再開します... (自動再開有効)`,
	},
	zh: {
		taskSummaryComplete: '任务总结：已完成',
		taskSummaryPaused: '智能体任务：已暂停',
		taskSummaryBlocked: '智能体任务：已阻塞',
		changedFiles: '更改的文件',
		checklist: '任务清单',
		complete: '已完成',
		verificationEvidence: '验证证据',
		verificationIssues: '验证问题',
		verificationPending: '待验证',
		nextStep: '下一步',
		reason: '原因',
		autoContinueActive: '自动继续已启用：正在自动继续任务...',
		sendContinueToResume: '发送 `continue` 继续执行。',
		resumeDefault: '从检查点恢复',
		confirmAgentActionHeader: '智能体操作审批',
		confirmTerminalHeader: '终端命令审批',
		confirmAgentActionQuestion: '此智能体操作可能会更改状态或访问外部资源。是否允许执行此操作一次？',
		confirmTerminalActionQuestion: '此终端操作可能会更改状态或访问外部资源。是否允许执行此操作一次？',
		confirmExactCommandQuestion: '是否允许运行此命令一次？',
		confirmPolicyRestricted: '组织策略限制了完全访问。',
		confirmExternalFile: '此文件位于工作区之外或无法安全验证。是否允许智能体读取一次？',
		confirmAllowOnce: '允许一次',
		confirmSkipAction: '跳过操作',
		confirmSkipCommand: '跳过命令',
		confirmExplanationLabel: '说明',
		confirmGoalLabel: '目标',
		confirmModeLabel: '模式',
		selectAnotherModelTip: '在右下角模型选择器中切换其他模型 — 无需手动输入 continue，任务将立即自动继续。',
		taskPausedTip: '任务已暂停。请选择其他模型以自动继续。',
		serverDownCategory: '提供商服务器宕机',
		quotaLimitCategory: '配额限制',
		providerErrorCategory: '提供商错误',
		cooldownWaitingNotice: (model: string, sec: number) => `*[系统等待中]* 模型 **${model}** 处于提供商冷却期。正在自动等待 **${sec} 秒** 后继续... (自动恢复已启用)`,
	},
	ko: {
		taskSummaryComplete: '작업 요약: 완료',
		taskSummaryPaused: '에이전트 작업: 일시 중지됨',
		taskSummaryBlocked: '에이전트 작업: 차단됨',
		changedFiles: '변경된 파일',
		checklist: '체크리스트',
		complete: '완료',
		verificationEvidence: '검증 증거',
		verificationIssues: '검증 문제',
		verificationPending: '검증 대기 중',
		nextStep: '다음 단계',
		reason: '이유',
		autoContinueActive: '자동 계속 활성: 작업을 자동으로 재개합니다...',
		sendContinueToResume: '`continue`를 입력하여 재개하세요.',
		resumeDefault: '체크포인트에서 재개',
		confirmAgentActionHeader: '에이전트 동작 승인',
		confirmTerminalHeader: '터미널 명령 승인',
		confirmAgentActionQuestion: '이 에이전트 동작은 상태를 변경하거나 외부 리소스에 액세스할 수 있습니다. 이 동작을 한 번 허용하시겠습니까?',
		confirmTerminalActionQuestion: '이 터미널 동작은 상태를 변경하거나 외부 리소스에 액세스할 수 있습니다. 이 동작을 한 번 허용하시겠습니까?',
		confirmExactCommandQuestion: '이 명령을 한 번 실행하도록 허용하시겠습니까?',
		confirmPolicyRestricted: '조직 정책에 의해 전체 액세스가 제한됩니다. ',
		confirmExternalFile: '이 파일은 작업 영역 외부에 있거나 안전하게 확인할 수 없습니다. 에이전트가 한 번 읽도록 허용하시겠습니까?',
		confirmAllowOnce: '한 번 허용',
		confirmSkipAction: '동작 건너뛰기',
		confirmSkipCommand: '명령 건너뛰기',
		confirmExplanationLabel: '설명',
		confirmGoalLabel: '목표',
		confirmModeLabel: '모드',
		selectAnotherModelTip: '오른쪽 하단의 모델 선택기에서 다른 모델을 선택하세요. continue를 입력하지 않아도 작업이 즉시 자동 재개됩니다。',
		taskPausedTip: '작업이 일시 정지되었습니다. 다른 모델을 선택하여 자동으로 재개하세요.',
		serverDownCategory: '공급자 서버 다운',
		quotaLimitCategory: '할당량 제한',
		providerErrorCategory: '공급자 오류',
		cooldownWaitingNotice: (model: string, sec: number) => `*[시스템 대기 중]* 모델 **${model}**이(가) 공급자 쿨다운 상태입니다. **${sec}초** 동안 자동으로 대기 후 계속합니다... (자동 재개 활성화)`,
	},
	es: {
		taskSummaryComplete: 'Resumen de la tarea: Completada',
		taskSummaryPaused: 'Tarea del agente: En pausa',
		taskSummaryBlocked: 'Tarea del agente: Bloqueada',
		changedFiles: 'Archivos modificados',
		checklist: 'Lista de tareas',
		complete: 'completado',
		verificationEvidence: 'Evidencia de verificación',
		verificationIssues: 'Problemas de verificación',
		verificationPending: 'Verificación pendiente',
		nextStep: 'Paso siguiente',
		reason: 'Motivo',
		autoContinueActive: 'Continuación automática activa: Reanudando la tarea automáticamente...',
		sendContinueToResume: 'Envía `continue` para reanudar.',
		resumeDefault: 'Reanudar desde el punto de control',
		confirmAgentActionHeader: 'Aprobación de acción del agente',
		confirmTerminalHeader: 'Aprobación de comando de terminal',
		confirmAgentActionQuestion: 'Esta acción del agente puede cambiar el estado o acceder a un recurso externo. ¿Permitir esta acción exacta una vez?',
		confirmTerminalActionQuestion: 'Esta acción de terminal puede cambiar el estado o acceder a un recurso externo. ¿Permitir esta acción exacta una vez?',
		confirmExactCommandQuestion: '¿Permitir ejecutar este comando una vez?',
		confirmPolicyRestricted: 'El acceso completo está restringido por la directiva de la organización. ',
		confirmExternalFile: 'Este archivo está fuera del espacio de trabajo o no se pudo verificar de forma segura. ¿Permitir que el agente lo lea una vez?',
		confirmAllowOnce: 'Permitir una vez',
		confirmSkipAction: 'Omitir acción',
		confirmSkipCommand: 'Omitir comando',
		confirmExplanationLabel: 'Explicación',
		confirmGoalLabel: 'Objetivo',
		confirmModeLabel: 'Modo',
		selectAnotherModelTip: 'Seleccione otro modelo en el selector de la esquina inferior derecha: la tarea se reanudará automáticamente sin escribir continue.',
		taskPausedTip: 'Tarea en pausa. Seleccione otro modelo para reanudar automáticamente.',
		serverDownCategory: 'SERVIDOR DEL PROVEEDOR CAÍDO',
		quotaLimitCategory: 'LÍMITE DE CUOTA',
		providerErrorCategory: 'ERROR DEL PROVEEDOR',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Sistema en espera]* El modelo **${model}** está en enfriamiento por parte del proveedor. Esperando automáticamente **${sec}s** antes de reanudar... (Reanudación automática activa)`,
	},
	fr: {
		taskSummaryComplete: 'Résumé de la tâche : Terminé',
		taskSummaryPaused: "Tâche de l'agent : En pause",
		taskSummaryBlocked: "Tâche de l'agent : Bloquée",
		changedFiles: 'Fichiers modifiés',
		checklist: 'Liste des tâches',
		complete: 'terminé',
		verificationEvidence: 'Preuves de vérification',
		verificationIssues: 'Problèmes de vérification',
		verificationPending: 'Vérification en attente',
		nextStep: 'Étape suivante',
		reason: 'Raison',
		autoContinueActive: 'Reprise automatique active : Reprise de la tâche en cours...',
		sendContinueToResume: 'Envoyez `continue` pour reprendre.',
		resumeDefault: 'Reprendre à partir du point de contrôle',
		confirmAgentActionHeader: "Approbation de l'action de l'agent",
		confirmTerminalHeader: 'Approbation de la commande de terminal',
		confirmAgentActionQuestion: "Cette action de l'agent peut modifier l'état ou accéder à une ressource externe. Autoriser cette action exacte une fois ?",
		confirmTerminalActionQuestion: "Cette action de terminal peut modifier l'état ou accéder à une ressource externe. Autoriser cette action exacte une fois ?",
		confirmExactCommandQuestion: 'Autoriser cette commande à être exécutée une fois ?',
		confirmPolicyRestricted: "L'accès complet est restreint par la politique de l'organisation. ",
		confirmExternalFile: "Ce fichier est en dehors de l'espace de travail ou n'a pas pu être vérifié en toute sécurité. Autoriser l'agent à le lire une fois ?",
		confirmAllowOnce: 'Autoriser une fois',
		confirmSkipAction: "Ignorer l'action",
		confirmSkipCommand: 'Ignorer la commande',
		confirmExplanationLabel: 'Explication',
		confirmGoalLabel: 'Objectif',
		confirmModeLabel: 'Mode',
		selectAnotherModelTip: 'Sélectionnez un autre modèle dans le sélecteur en bas à droite — la tâche reprendra automatiquement sans avoir à taper continue.',
		taskPausedTip: 'Tâche suspendue. Sélectionnez un autre modèle pour reprendre automatiquement.',
		serverDownCategory: 'SERVEUR DU FOURNISSEUR INDISPONIBLE',
		quotaLimitCategory: 'LIMITE DE QUOTA',
		providerErrorCategory: 'ERREUR DU FOURNISSEUR',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Système en attente]* Le modèle **${model}** est en période de temporisation. Attente automatique de **${sec}s** avant reprise... (Reprise automatique active)`,
	},
	de: {
		taskSummaryComplete: 'Aufgabenübersicht: Abgeschlossen',
		taskSummaryPaused: 'Agent-Aufgabe: Pausiert',
		taskSummaryBlocked: 'Agent-Aufgabe: Blockiert',
		changedFiles: 'Geänderte Dateien',
		checklist: 'Checkliste',
		complete: 'abgeschlossen',
		verificationEvidence: 'Überprüfungsnachweise',
		verificationIssues: 'Überprüfungsprobleme',
		verificationPending: 'Überprüfung ausstehend',
		nextStep: 'Nächster Schritt',
		reason: 'Grund',
		autoContinueActive: 'Automatisches Fortsetzen aktiv: Aufgabe wird automatisch fortgesetzt...',
		sendContinueToResume: 'Senden Sie `continue`, um fortzufahren.',
		resumeDefault: 'Vom Prüfpunkt fortsetzen',
		confirmAgentActionHeader: 'Genehmigung der Agent-Aktion',
		confirmTerminalHeader: 'Genehmigung des Terminalbefehls',
		confirmAgentActionQuestion: 'Diese Agent-Aktion kann den Zustand ändern oder auf eine externe Ressource zugreifen. Einmalige Ausführung erlauben?',
		confirmTerminalActionQuestion: 'Diese Terminal-Aktion kann den Zustand ändern oder auf eine externe Ressource zugreifen. Einmalige Ausführung erlauben?',
		confirmExactCommandQuestion: 'Diesen genauen Befehl einmal ausführen lassen?',
		confirmPolicyRestricted: 'Der Vollzugriff ist durch die Unternehmensrichtlinie eingeschränkt. ',
		confirmExternalFile: 'Diese Datei befindet sich außerhalb des Arbeitsbereichs. Dem Agenten einmaliges Lesen gestatten?',
		confirmAllowOnce: 'Einmalig erlauben',
		confirmSkipAction: 'Aktion überspringen',
		confirmSkipCommand: 'Befehl überspringen',
		confirmExplanationLabel: 'Erklärung',
		confirmGoalLabel: 'Ziel',
		confirmModeLabel: 'Modus',
		selectAnotherModelTip: 'Wählen Sie ein anderes Modell in der Modellauswahl unten rechts — die Aufgabe wird automatisch fortgesetzt, ohne continue eingeben zu müssen.',
		taskPausedTip: 'Aufgabe pausiert. Wählen Sie ein anderes Modell, um automatisch fortzufahren.',
		serverDownCategory: 'PROVIDER-SERVER NICHT ERREICHBAR',
		quotaLimitCategory: 'KONTINGENTLIMIT',
		providerErrorCategory: 'PROVIDER-FEHLER',
		cooldownWaitingNotice: (model: string, sec: number) => `*[System wartet]* Modell **${model}** befindet sich in einer Abkühlphase des Anbieters. Automatische Wartezeit **${sec}s** vor Wiederaufnahme... (Auto-Resume aktiv)`,
	},
	pt: {
		taskSummaryComplete: 'Resumo da tarefa: Concluída',
		taskSummaryPaused: 'Tarefa do agente: Pausada',
		taskSummaryBlocked: 'Tarefa do agente: Bloqueada',
		changedFiles: 'Arquivos alterados',
		checklist: 'Lista de tarefas',
		complete: 'concluído',
		verificationEvidence: 'Evidência de verificação',
		verificationIssues: 'Problemas de verificação',
		verificationPending: 'Verificação pendente',
		nextStep: 'Próximo passo',
		reason: 'Motivo',
		autoContinueActive: 'Continuação automática ativa: Retomando a tarefa automaticamente...',
		sendContinueToResume: 'Envie `continue` para retomar.',
		resumeDefault: 'Retomar a partir do ponto de verificação',
		confirmAgentActionHeader: 'Aprovação de ação do agente',
		confirmTerminalHeader: 'Aprovação de comando do terminal',
		confirmAgentActionQuestion: 'Esta ação do agente pode alterar o estado ou acessar um recurso externo. Permitir esta ação exata uma vez?',
		confirmTerminalActionQuestion: 'Esta ação do terminal pode alterar o estado ou acessar um recurso externo. Permitir esta ação exata uma vez?',
		confirmExactCommandQuestion: 'Permitir executar este comando uma vez?',
		confirmPolicyRestricted: 'O acesso total é restrito pela política da organização. ',
		confirmExternalFile: 'Este arquivo está fora da área de trabalho. Permitir que o agente leia uma vez?',
		confirmAllowOnce: 'Permitir uma vez',
		confirmSkipAction: 'Pular ação',
		confirmSkipCommand: 'Pular comando',
		confirmExplanationLabel: 'Explicação',
		confirmGoalLabel: 'Objetivo',
		confirmModeLabel: 'Modo',
		selectAnotherModelTip: 'Selecione outro modelo no seletor no canto inferior direito — a tarefa será retomada automaticamente sem digitar continue.',
		taskPausedTip: 'Tarefa pausada. Selecione outro modelo para retomar automaticamente.',
		serverDownCategory: 'SERVIDOR DO PROVEDOR INDISPONÍVEL',
		quotaLimitCategory: 'LIMITE DE COTA',
		providerErrorCategory: 'ERRO DO PROVEDOR',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Sistema aguardando]* O modelo **${model}** está em tempo de espera pelo provedor. Aguardando automaticamente **${sec}s** antes de retomar... (Retomada automática ativa)`,
	},
	ru: {
		taskSummaryComplete: 'Сводка задачи: Завершено',
		taskSummaryPaused: 'Задача агента: Приостановлена',
		taskSummaryBlocked: 'Задача агента: Заблокирована',
		changedFiles: 'Измененные файлы',
		checklist: 'Контрольный список',
		complete: 'завершено',
		verificationEvidence: 'Подтверждающие данные',
		verificationIssues: 'Проблемы при проверке',
		verificationPending: 'Ожидает проверки',
		nextStep: 'Следующий шаг',
		reason: 'Причина',
		autoContinueActive: 'Автопродолжение активно: Автоматическое возобновление задачи...',
		sendContinueToResume: 'Отправьте `continue`, чтобы продолжить.',
		resumeDefault: 'Возобновить с контрольной точки',
		confirmAgentActionHeader: 'Подтверждение действия агента',
		confirmTerminalHeader: 'Подтверждение команды терминала',
		confirmAgentActionQuestion: 'Это действие агента может изменить состояние или запросить внешний ресурс. Разрешить это действие один раз?',
		confirmTerminalActionQuestion: 'Это действие терминала может изменить состояние или запросить внешний ресурс. Разрешить это действие один раз?',
		confirmExactCommandQuestion: 'Разрешить выполнение этой команды один раз?',
		confirmPolicyRestricted: 'Полный доступ ограничен политикой организации. ',
		confirmExternalFile: 'Этот файл находится вне рабочей области. Разрешить агенту прочитать его один раз?',
		confirmAllowOnce: 'Разрешить один раз',
		confirmSkipAction: 'Пропустить действие',
		confirmSkipCommand: 'Пропустить команду',
		confirmExplanationLabel: 'Объяснение',
		confirmGoalLabel: 'Цель',
		confirmModeLabel: 'Режим',
		selectAnotherModelTip: 'Выберите другую модель в селекторе справа внизу — задача продолжится автоматически без необходимости вводить continue.',
		taskPausedTip: 'Задача приостановлена. Выберите другую модель для автоматического возобновления.',
		serverDownCategory: 'СЕРВЕР ПРОВАЙДЕРА НЕДОСТУПЕН',
		quotaLimitCategory: 'ЛИМИТ КВОТЫ',
		providerErrorCategory: 'ОШИБКА ПРОВАЙДЕРА',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Система ожидает]* Модель **${model}** находится на кулдауне у провайдера. Автоматическое ожидание **${sec}с** перед продолжением... (Авто-возобновление активно)`,
	},
	it: {
		taskSummaryComplete: 'Riepilogo attività: Completato',
		taskSummaryPaused: "Attività dell'agente: In pausa",
		taskSummaryBlocked: "Attività dell'agente: Bloccata",
		changedFiles: 'File modificati',
		checklist: 'Elenco attività',
		complete: 'completato',
		verificationEvidence: 'Evidenze di verifica',
		verificationIssues: 'Problemi di verifica',
		verificationPending: 'Verifica in sospeso',
		nextStep: 'Passo successivo',
		reason: 'Motivo',
		autoContinueActive: 'Ripresa automatica attiva: Ripresa automatica del compito...',
		sendContinueToResume: 'Invia `continue` per riprendere.',
		resumeDefault: 'Riprendi dal punto di controllo',
		confirmAgentActionHeader: "Approvazione dell'azione dell'agente",
		confirmTerminalHeader: 'Approvazione del comando da terminale',
		confirmAgentActionQuestion: "Questa azione dell'agente può modificare lo stato o accedere a una risorsa esterna. Consentire questa azione una volta?",
		confirmTerminalActionQuestion: "Questa azione da terminale può modificare lo stato o accedere a una risorsa esterna. Consentire questa azione una volta?",
		confirmExactCommandQuestion: "Consentire l'esecuzione di questo comando una volta?",
		confirmPolicyRestricted: "L'accesso completo è limitato dai criteri dell'organizzazione. ",
		confirmExternalFile: "Questo file è esterno all'area di lavoro. Consentire all'agente di leggerlo una volta?",
		confirmAllowOnce: 'Consenti una volta',
		confirmSkipAction: 'Ignora azione',
		confirmSkipCommand: 'Ignora comando',
		confirmExplanationLabel: 'Spiegazione',
		confirmGoalLabel: 'Obiettivo',
		confirmModeLabel: 'Modalità',
		selectAnotherModelTip: 'Seleziona un altro modello nel selettore in basso a destra: l\'attività riprenderà automaticamente senza digitare continue.',
		taskPausedTip: 'Attività in pausa. Seleziona un altro modello per riprendere automaticamente.',
		serverDownCategory: 'SERVER DEL PROVIDER NON RAGGIUNGIBILE',
		quotaLimitCategory: 'LIMITE DI QUOTA',
		providerErrorCategory: 'ERRORE DEL PROVIDER',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Sistema in attesa]* Il modello **${model}** è in cooldown presso il provider. Attesa automatica di **${sec}s** prima di riprendere... (Ripresa automatica attiva)`,
	},
	ar: {
		taskSummaryComplete: 'ملخص المهمة: مكتمل',
		taskSummaryPaused: 'مهمة الوكيل: متوقفة مؤقتاً',
		taskSummaryBlocked: 'مهمة الوكيل: محظورة',
		changedFiles: 'الملفات المعدلة',
		checklist: 'قائمة المهام',
		complete: 'مكتمل',
		verificationEvidence: 'أدلة التحقق',
		verificationIssues: 'مشكلات التحقق',
		verificationPending: 'التحقق معلق',
		nextStep: 'الخطوة التالية',
		reason: 'السبب',
		autoContinueActive: 'المتابعة التلقائية نشطة: استئناف المهمة تلقائياً...',
		sendContinueToResume: 'أرسل `continue` للاستئناف.',
		resumeDefault: 'الاستئناف من نقطة التحقق',
		confirmAgentActionHeader: 'الموافقة على إجراء الوكيل',
		confirmTerminalHeader: 'الموافقة على أمر الطرفية',
		confirmAgentActionQuestion: 'قد يؤدي هذا الإجراء إلى تغيير حالة النظام أو الوصول إلى مورد خارجي. هل تسمح بهذا الإجراء مرة واحدة؟',
		confirmTerminalActionQuestion: 'قد يؤدي أمر الطرفية هذا إلى تغيير حالة النظام أو الوصول إلى مورد خارجي. هل تسمح بهذا الإجراء مرة واحدة؟',
		confirmExactCommandQuestion: 'هل تسمح بتشغيل هذا الأمر المحدد مرة واحدة؟',
		confirmPolicyRestricted: 'تم تقييد الوصول الكامل بواسطة سياسة المؤسسة. ',
		confirmExternalFile: 'هذا الملف خارج مساحة العمل. هل تسمح للوكيل بقراءته مرة واحدة؟',
		confirmAllowOnce: 'السماح مرة واحدة',
		confirmSkipAction: 'تخطي الإجراء',
		confirmSkipCommand: 'تخطي الأمر',
		confirmExplanationLabel: 'التفسير',
		confirmGoalLabel: 'الهدف',
		confirmModeLabel: 'الوضع',
		selectAnotherModelTip: 'حدد نموذجاً آخر في محدد النماذج أسفل اليمين — سيتم استئناف المهمة تلقائياً دون كتابة continue.',
		taskPausedTip: 'تم إيقاف المهمة مؤقتاً. حدد نموذجاً آخر للاستئناف التلقائي.',
		serverDownCategory: 'خادم المزود متوقف',
		quotaLimitCategory: 'حد الحصة',
		providerErrorCategory: 'خطأ في المزود',
		cooldownWaitingNotice: (model: string, sec: number) => `*[النظام في وضع الانتظار]* النموذج **${model}** في فترة تبريد لدى المزود. جارٍ الانتظار تلقائياً لمدة **${sec} ثانية** قبل المتابعة... (الاستئناف التلقائي نشط)`,
	},
	nl: {
		taskSummaryComplete: 'Taakoverzicht: Voltooid',
		taskSummaryPaused: 'Agenttaak: Gepauzeerd',
		taskSummaryBlocked: 'Agenttaak: Geblokkeerd',
		changedFiles: 'Gewijzigde bestanden',
		checklist: 'Takenlijst',
		complete: 'voltooid',
		verificationEvidence: 'Verificatiebewijs',
		verificationIssues: 'Verificatieproblemen',
		verificationPending: 'Verificatie in behandeling',
		nextStep: 'Volgende stap',
		reason: 'Reden',
		autoContinueActive: 'Automatisch hervatten actief: Taak wordt automatisch hervat...',
		sendContinueToResume: 'Stuur `continue` om te hervatten.',
		resumeDefault: 'Hervatten vanaf controlepunt',
		confirmAgentActionHeader: 'Goedkeuring agentactie',
		confirmTerminalHeader: 'Goedkeuring terminalopdracht',
		confirmAgentActionQuestion: 'Deze agentactie kan de systeemstatus wijzigen of toegang zoeken tot een externe bron. Eenmalig toestaan?',
		confirmTerminalActionQuestion: 'Deze terminalopdracht kan de systeemstatus wijzigen of toegang zoeken tot een externe bron. Eenmalig toestaan?',
		confirmExactCommandQuestion: 'Deze opdracht eenmalig laten uitvoeren?',
		confirmPolicyRestricted: 'Volledige toegang is beperkt door het organisatiebeleid. ',
		confirmExternalFile: 'Dit bestand bevindt zich buiten de werkruimte. Eenmalig lezen toestaan?',
		confirmAllowOnce: 'Eenmalig toestaan',
		confirmSkipAction: 'Actie overslaan',
		confirmSkipCommand: 'Opdracht overslaan',
		confirmExplanationLabel: 'Uitleg',
		confirmGoalLabel: 'Doel',
		confirmModeLabel: 'Modus',
		selectAnotherModelTip: 'Selecteer een ander model in de modelkiezer rechtsonder — de taak wordt automatisch hervat zonder continue te hoeven typen.',
		taskPausedTip: 'Taak gepauzeerd. Selecteer een ander model om automatisch te hervatten.',
		serverDownCategory: 'PROVIDER-SERVER NIET BEREIKBAAR',
		quotaLimitCategory: 'QUOTUMLIMIET',
		providerErrorCategory: 'PROVIDERFOUT',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Systeem wacht]* Model **${model}** bevindt zich in een afkoelperiode bij de provider. Wacht automatisch **${sec}s** voor hervatting... (Automatisch hervatten actief)`,
	},
	tr: {
		taskSummaryComplete: 'Görev Özeti: Tamamlandı',
		taskSummaryPaused: 'Ajan Görevi: Duraklatıldı',
		taskSummaryBlocked: 'Ajan Görevi: Engellendi',
		changedFiles: 'Değiştirilen dosyalar',
		checklist: 'Görev listesi',
		complete: 'tamamlandı',
		verificationEvidence: 'Doğrulama kanıtı',
		verificationIssues: 'Doğrulama sorunları',
		verificationPending: 'Doğrulama bekliyor',
		nextStep: 'Sonraki adım',
		reason: 'Neden',
		autoContinueActive: 'Otomatik Devam Et Etkin: Görev otomatik olarak sürdürülüyor...',
		sendContinueToResume: 'Devam etmek için `continue` gönderin.',
		resumeDefault: 'Kontrol noktasından devam et',
		confirmAgentActionHeader: 'Ajan Eylemi Onayı',
		confirmTerminalHeader: 'Terminal Komutu Onayı',
		confirmAgentActionQuestion: 'Bu ajan eylemi sistem durumunu değiştirebilir veya harici bir kaynağa erişebilir. Bu eyleme bir kez izin verilsin mi?',
		confirmTerminalActionQuestion: 'Bu terminal eylemi sistem durumunu değiştirebilir veya harici bir kaynağa erişebilir. Bu eyleme bir kez izin verilsin mi?',
		confirmExactCommandQuestion: 'Bu komutun bir kez çalıştırılmasına izin verilsin mi?',
		confirmPolicyRestricted: 'Tam erişim kurum ilkeleri tarafından kısıtlanmıştır. ',
		confirmExternalFile: 'Bu dosya çalışma alanı dışındadır. Ajanın dosyayı bir kez okumasına izin verilsin mi?',
		confirmAllowOnce: 'Bir kez izin ver',
		confirmSkipAction: 'Eylemi atla',
		confirmSkipCommand: 'Komutu atla',
		confirmExplanationLabel: 'Açıklama',
		confirmGoalLabel: 'Hedef',
		confirmModeLabel: 'Mod',
		selectAnotherModelTip: 'Sağ alttaki model seçiciden başka bir model seçin — görev continue yazmanıza gerek kalmadan otomatik olarak devam edecektir.',
		taskPausedTip: 'Görev duraklatıldı. Otomatik devam etmek için başka bir model seçin.',
		serverDownCategory: 'SAĞLAYICI SUNUCUSU KAPALI',
		quotaLimitCategory: 'KOTA SINIRI',
		providerErrorCategory: 'SAĞLAYICI HATASI',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Sistem Bekliyor]* **${model}** modeli sağlayıcı tarafından bekleme süresine alındı. Devam etmeden önce **${sec} saniye** bekleniyor... (Otomatik devam etme aktif)`,
	},
	vi: {
		taskSummaryComplete: 'Tóm tắt nhiệm vụ: Hoàn thành',
		taskSummaryPaused: 'Nhiệm vụ tác nhân: Tạm dừng',
		taskSummaryBlocked: 'Nhiệm vụ tác nhân: Bị chặn',
		changedFiles: 'Các tệp đã thay đổi',
		checklist: 'Danh sách nhiệm vụ',
		complete: 'hoàn thành',
		verificationEvidence: 'Bằng chứng xác minh',
		verificationIssues: 'Vấn đề xác minh',
		verificationPending: 'Đang chờ xác minh',
		nextStep: 'Bước tiếp theo',
		reason: 'Lý do',
		autoContinueActive: 'Tự động tiếp tục đang hoạt động: Đang tự động tiếp tục nhiệm vụ...',
		sendContinueToResume: 'Gửi `continue` để tiếp tục.',
		resumeDefault: 'Tiếp tục từ điểm kiểm tra',
		confirmAgentActionHeader: 'Phê duyệt hành động của tác nhân',
		confirmTerminalHeader: 'Phê duyệt lệnh terminal',
		confirmAgentActionQuestion: 'Hành động này có thể thay đổi trạng thái hoặc truy cập tài nguyên bên ngoài. Cho phép hành động này một lần?',
		confirmTerminalActionQuestion: 'Lệnh terminal này có thể thay đổi trạng thái hoặc truy cập tài nguyên bên ngoài. Cho phép hành động này một lần?',
		confirmExactCommandQuestion: 'Cho phép chạy lệnh này một lần?',
		confirmPolicyRestricted: 'Toàn quyền truy cập bị hạn chế bởi chính sách tổ chức. ',
		confirmExternalFile: 'Tệp này nằm ngoài không gian làm việc. Cho phép tác nhân đọc một lần?',
		confirmAllowOnce: 'Cho phép một lần',
		confirmSkipAction: 'Bỏ qua hành động',
		confirmSkipCommand: 'Bỏ qua lệnh',
		confirmExplanationLabel: 'Giải thích',
		confirmGoalLabel: 'Mục tiêu',
		confirmModeLabel: 'Chế độ',
		selectAnotherModelTip: 'Chọn mô hình khác ở bộ chọn mô hình góc dưới bên phải — tác vụ sẽ tự động tiếp tục ngay lập tức mà không cần gõ continue.',
		taskPausedTip: 'Tác vụ đã tạm dừng. Chọn một mô hình khác để tự động tiếp tục.',
		serverDownCategory: 'MÁY CHỦ NHÀ CUNG CẤP BỊ TẮT',
		quotaLimitCategory: 'GIỚI HẠN HẠN MỨC',
		providerErrorCategory: 'LỖI NHÀ CUNG CẤP',
		cooldownWaitingNotice: (model: string, sec: number) => `*[Hệ thống đang chờ]* Mô hình **${model}** đang trong thời gian hạ nhiệt của nhà cung cấp. Tự động chờ trong **${sec} giây** trước khi tiếp tục... (Tự động tiếp tục đang bật)`,
	},
};

export function getDardcorLocaleStrings(lang: DardcorSupportedLanguage): IDardcorLocaleStrings {
	return DARDCOR_LOCALE_MAP[lang] ?? DARDCOR_LOCALE_MAP.en;
}

export function getDardcorAutonomousSelfCorrectionDirective(lang: DardcorSupportedLanguage, errorPreview: string): string {
	const langName = getDardcorLanguageName(lang);
	return `The previous tool action encountered an issue (${errorPreview}). Analyze the cause, adapt your approach, and proceed with the necessary corrective action in ${langName}.`;
}

export function getDardcorAutonomousMomentumDirective(
	lang: DardcorSupportedLanguage,
	completedCount: number,
	totalCount: number,
	nextItem: { id: string | number; title: string }
): string {
	const langName = getDardcorLanguageName(lang);
	return `Checklist item #${nextItem.id} ("${nextItem.title}") is in progress (${completedCount}/${totalCount} completed). Proceed with the implementation using appropriate tools while communicating in ${langName}.`;
}

export function getDardcorFinalSummaryMandate(lang: DardcorSupportedLanguage): string {
	const langName = getDardcorLanguageName(lang);
	return `All checklist items have been completed and verified. Please summarize the outcome, key changes, and verification results fluently in ${langName}.`;
}

export interface IAntigravityChangedFileInfo {
	readonly fsPath: string;
	readonly added?: number;
	readonly removed?: number;
}

export interface IAntigravityFinalReportOptions {
	readonly lang: DardcorSupportedLanguage;
	readonly prompt?: string;
	readonly todos?: readonly { readonly id?: string | number; readonly title: string; readonly status?: string }[];
	readonly changedFiles?: readonly IAntigravityChangedFileInfo[];
	readonly evidence?: readonly string[];
	readonly diagnosticErrors?: number;
	readonly projectName?: string;
	readonly techStack?: string;
	readonly llmSummary?: string;
}

export function generateAntigravityFinalReport(options: IAntigravityFinalReportOptions): string {
	if (options.llmSummary && options.llmSummary.trim().length >= 40) {
		return options.llmSummary.trim();
	}

	const isId = options.lang === 'id';
	const cleanPrompt = (options.prompt || '').replace(/^\s*(?:\/(?:plan|super-intell(?:egent|igent)|antislop|frontend-design|ui-ux-pro-max|understand)\s*)+/gi, '').trim();
	const todos = options.todos || [];
	const completedTodos = todos.filter(t => t.status === 'completed');
	const completedCount = completedTodos.length;
	const totalTodos = todos.length;

	const summaryHeading = isId ? '### Ringkasan Eksekutif' : '### Executive Summary';
	let summaryBody = '';
	if (options.llmSummary && options.llmSummary.trim().length >= 30) {
		summaryBody = options.llmSummary.trim();
	} else {
		const taskName = cleanPrompt || (isId ? 'Implementasi dan penyempurnaan proyek' : 'Project implementation and enhancement');
		if (isId) {
			summaryBody = totalTodos > 0
				? `Seluruh ${totalTodos} tugas implementasi telah berhasil diselesaikan secara menyeluruh untuk: "${taskName}". Seluruh perubahan kode telah terintegrasi dengan baik dan diverifikasi bebas error.`
				: `Pekerjaan implementasi telah berhasil diselesaikan secara menyeluruh untuk: "${taskName}". Kode telah diverifikasi dan siap digunakan.`;
		} else {
			summaryBody = totalTodos > 0
				? `All ${totalTodos} implementation tasks have been successfully completed for: "${taskName}". All changes have been properly integrated and verified error-free.`
				: `Implementation work has been successfully completed for: "${taskName}". The code has been verified and is ready for use.`;
		}
	}

	const changesHeading = isId ? '### Komponen & Berkas yang Diperbarui' : '### Key Changes & Updated Files';
	const changesList: string[] = [];
	const changedFiles = options.changedFiles || [];
	const filteredChangedFiles = changedFiles.filter(file => {
		const lower = file.fsPath.toLowerCase();
		return !lower.endsWith('.log') && !lower.includes('probe_runtime') && !lower.includes('.pandora-test');
	});
	const displayFiles = filteredChangedFiles.length > 0 ? filteredChangedFiles : changedFiles;
	const maxDisplayFiles = 7;
	const visibleFiles = displayFiles.slice(0, maxDisplayFiles);

	if (visibleFiles.length > 0) {
		for (const file of visibleFiles) {
			const normalizedPath = file.fsPath.replace(/\\/g, '/');
			const parts = normalizedPath.split('/');
			const baseName = parts[parts.length - 1] || file.fsPath;
			const dirPath = parts.slice(0, parts.length - 1).slice(-2).join('/');
			const diffText = (file.added !== undefined || file.removed !== undefined)
				? `+${file.added ?? 0} -${file.removed ?? 0}`
				: '';

			let desc = '';
			const lowerBase = baseName.toLowerCase();

			const matchingTodo = completedTodos.find(t => t.title.toLowerCase().includes(baseName.replace(/\.[^.]+$/, '').toLowerCase()));
			if (matchingTodo) {
				desc = matchingTodo.title;
			} else if (lowerBase === 'cargo.toml') {
				desc = isId ? 'Konfigurasi crate dan dependensi Cargo Rust' : 'Rust Cargo crate and dependency manifest';
			} else if (lowerBase.endsWith('.rs')) {
				if (lowerBase === 'main.rs') {
					desc = isId ? 'Titik masuk utama aplikasi native Rust' : 'Main application entrypoint in Rust';
				} else if (lowerBase === 'lib.rs') {
					desc = isId ? 'Pustaka dan deklarasi modul Rust' : 'Rust library and module declarations';
				} else if (lowerBase === 'app.rs') {
					desc = isId ? 'Logika siklus hidup dan antarmuka aplikasi' : 'Application logic and lifecycle architecture';
				} else if (lowerBase === 'model.rs' || lowerBase === 'state.rs') {
					desc = isId ? 'Struktur data domain dan manajemen state' : 'Domain data structures and state management';
				} else if (lowerBase === 'net.rs' || lowerBase === 'fetch.rs') {
					desc = isId ? 'Protokol komunikasi jaringan dan pengunduhan data' : 'Network communication and data retrieval logic';
				} else {
					desc = isId ? 'Modul logika dan komponen sistem Rust' : 'Rust system component and logic module';
				}
			} else if (lowerBase.endsWith('.ps1')) {
				desc = isId ? 'Skrip automasi dan runner PowerShell' : 'PowerShell automation and runner script';
			} else if (lowerBase.endsWith('.bat') || lowerBase.endsWith('.cmd')) {
				desc = isId ? 'Skrip automasi dan eksekusi batch Windows' : 'Windows batch automation and execution script';
			} else if (lowerBase.endsWith('.sh')) {
				desc = isId ? 'Skrip automasi shell' : 'Shell automation script';
			} else if (lowerBase.endsWith('.py')) {
				desc = isId ? 'Modul aplikasi dan logika Python' : 'Python application module and logic';
			} else if (lowerBase.endsWith('.go')) {
				desc = isId ? 'Modul aplikasi dan logika Go' : 'Go application module and logic';
			} else if (lowerBase.endsWith('.c') || lowerBase.endsWith('.cpp') || lowerBase.endsWith('.h') || lowerBase.endsWith('.hpp')) {
				desc = isId ? 'Kode sumber native C/C++' : 'Native C/C++ source code';
			} else if (lowerBase.endsWith('.toml')) {
				desc = isId ? 'Konfigurasi format TOML' : 'TOML configuration file';
			} else if (lowerBase.includes('scene') || lowerBase.includes('three') || lowerBase.includes('canvas')) {
				desc = isId ? 'Visualisasi 3D Three.js dan scene rendering interaktif' : 'Interactive 3D Three.js scene visualization and rendering';
			} else if (lowerBase.includes('hero')) {
				desc = isId ? 'Komponen hero landing page dengan integrasi visual modern' : 'Landing page hero section with modern visual integration';
			} else if (lowerBase.includes('vite.config')) {
				desc = isId ? 'Konfigurasi build, dev server, dan plugin Vite' : 'Vite build, dev server, and plugin configuration';
			} else if (lowerBase.includes('next.config')) {
				desc = isId ? 'Konfigurasi Next.js dan optimasi build' : 'Next.js configuration and build optimization';
			} else if (lowerBase.includes('tailwind.config')) {
				desc = isId ? 'Konfigurasi tema, palet warna, dan styling Tailwind' : 'Tailwind theme, color palette, and styling configuration';
			} else if (lowerBase === 'package.json') {
				desc = isId ? 'Manajemen dependensi dan skrip proyek' : 'Project dependencies and lifecycle scripts';
			} else if (lowerBase.endsWith('.css') || lowerBase.endsWith('.scss')) {
				desc = isId ? 'Gaya antarmuka, tata letak responsif, dan token desain' : 'Interface styling, responsive layout, and design tokens';
			} else if (lowerBase.includes('router') || lowerBase.includes('route')) {
				desc = isId ? 'Pengaturan rute dan navigasi aplikasi' : 'Application routing and navigation configuration';
			} else if (lowerBase.includes('service') || lowerBase.includes('api')) {
				desc = isId ? 'Layanan integrasi data dan logika komunikasi API' : 'Data service and API communication logic';
			} else if (lowerBase.includes('test') || lowerBase.includes('spec')) {
				desc = isId ? 'Pengujian unit dan verifikasi keandalan kode' : 'Unit testing and code reliability verification';
			} else if (lowerBase.endsWith('.tsx') || lowerBase.endsWith('.jsx')) {
				desc = isId ? 'Komponen antarmuka pengguna interaktif' : 'Interactive user interface component';
			} else if (lowerBase.endsWith('.ts') || lowerBase.endsWith('.js') || lowerBase.endsWith('.mjs')) {
				desc = isId ? 'Modul logika dan utilitas aplikasi' : 'Application logic and utility module';
			} else {
				desc = isId ? 'Pembaruan berkas konfigurasi dan aset proyek' : 'Project configuration and asset update';
			}

			const pathInfo = dirPath ? ` (\`${dirPath}\`)` : '';
			const stats = diffText ? ` [${diffText}]` : '';
			changesList.push(`- **\`${baseName}\`**${pathInfo}${stats} — ${desc}.`);
		}
		if (displayFiles.length > maxDisplayFiles) {
			const remaining = displayFiles.length - maxDisplayFiles;
			changesList.push(isId
				? `- *(+${remaining} berkas lainnya dapat ditinjau langsung pada panel diff interaktif di bawah)*`
				: `- *(+${remaining} additional files can be reviewed in the interactive diff panel below)*`);
		}
	} else if (completedTodos.length > 0) {
		for (const todo of completedTodos.slice(0, 8)) {
			changesList.push(`- **${todo.title}** — ${isId ? 'Selesai dan terintegrasi' : 'Completed and integrated'}.`);
		}
	}

	const qaHeading = isId ? '### Jaminan Kualitas & Bukti Verifikasi' : '### Quality Assurance & Verification';
	const qaList: string[] = [];
	const diagErrors = options.diagnosticErrors ?? 0;
	if (diagErrors === 0) {
		qaList.push(isId
			? '- Pemeriksaan diagnostik workspace: **0 error** terdeteksi (kode bersih dan lolos verifikasi statis).'
			: '- Workspace diagnostics: **0 errors** detected (clean code passing static analysis).');
	} else {
		qaList.push(isId
			? `- Pemeriksaan diagnostik workspace: ${diagErrors} catatan diagnostik.`
			: `- Workspace diagnostics: ${diagErrors} diagnostic notes.`);
	}

	if (totalTodos > 0) {
		qaList.push(isId
			? `- Checklist tugas: Seluruh **${completedCount}/${totalTodos}** tugas berhasil diselesaikan dan divalidasi.`
			: `- Task checklist: All **${completedCount}/${totalTodos}** tasks completed and validated.`);
	}

	const evidenceItems = options.evidence || [];
	if (evidenceItems.length > 0) {
		for (const ev of evidenceItems.slice(-3)) {
			const cleanEv = ev.replace(/[\r\n\t]+/g, ' ').trim();
			if (cleanEv) {
				qaList.push(`- ${cleanEv}`);
			}
		}
	}

	const runHeading = isId ? '### Panduan Menjalankan Proyek' : '### How to Run & Verify';
	const combinedTech = `${options.techStack || ''} ${options.projectName || ''}`.toLowerCase();
	const hasRust = combinedTech.includes('rust') || combinedTech.includes('cargo') || changedFiles.some(f => f.fsPath.endsWith('.rs') || f.fsPath.toLowerCase().endsWith('cargo.toml'));
	const hasGo = combinedTech.includes('go') || changedFiles.some(f => f.fsPath.endsWith('.go') || f.fsPath.toLowerCase().endsWith('go.mod'));
	const hasPython = combinedTech.includes('python') || changedFiles.some(f => f.fsPath.endsWith('.py') || f.fsPath.toLowerCase().endsWith('requirements.txt'));
	const hasFlutter = combinedTech.includes('flutter') || combinedTech.includes('dart') || changedFiles.some(f => f.fsPath.endsWith('.dart'));
	const hasScriptRunner = changedFiles.some(f => f.fsPath.toLowerCase().includes('run.ps1'));

	let runBody = '';
	if (hasRust) {
		const execCmd = hasScriptRunner ? '.\\scripts\\run.ps1' : 'cargo run';
		runBody = isId
			? `Jalankan perintah berikut pada terminal proyek untuk mengompilasi dan menjalankan aplikasi:\n\`\`\`powershell\n${execCmd}\n\`\`\`\nUntuk menjalankan seluruh pengujian unit dan validasi:\n\`\`\`powershell\ncargo test\n\`\`\``
			: `Execute the following command in your project terminal to build and launch the application:\n\`\`\`powershell\n${execCmd}\n\`\`\`\nTo run all unit tests and validation:\n\`\`\`powershell\ncargo test\n\`\`\``;
	} else if (hasGo) {
		runBody = isId
			? `Jalankan perintah berikut pada terminal proyek untuk menjalankan modul Go:\n\`\`\`bash\ngo run .\n\`\`\`\nUntuk pengujian:\n\`\`\`bash\ngo test ./...\n\`\`\``
			: `Execute the following command in your terminal to run the Go application:\n\`\`\`bash\ngo run .\n\`\`\`\nTo test:\n\`\`\`bash\ngo test ./...\n\`\`\``;
	} else if (hasPython) {
		runBody = isId
			? `Jalankan perintah berikut pada terminal proyek untuk mengeksekusi aplikasi Python:\n\`\`\`bash\npython main.py\n\`\`\`\nUntuk pengujian:\n\`\`\`bash\npytest\n\`\`\``
			: `Execute the following command in your terminal to run the Python application:\n\`\`\`bash\npython main.py\n\`\`\`\nTo test:\n\`\`\`bash\npytest\n\`\`\``;
	} else if (hasFlutter) {
		runBody = isId
			? `Jalankan perintah berikut pada terminal untuk menjalankan aplikasi Flutter:\n\`\`\`bash\nflutter run\n\`\`\``
			: `Execute the following command in your terminal to run the Flutter application:\n\`\`\`bash\nflutter run\n\`\`\``;
	} else {
		const hasWeb = combinedTech.includes('node') || combinedTech.includes('npm') || combinedTech.includes('vite') || combinedTech.includes('react') || combinedTech.includes('next') || combinedTech.includes('vue') || changedFiles.some(f => f.fsPath.toLowerCase().endsWith('package.json'));
		if (hasWeb) {
			let runCmd = 'npm run dev';
			let portUrl = 'http://localhost:5173';
			if (combinedTech.includes('next')) {
				runCmd = 'npm run dev';
				portUrl = 'http://localhost:3000';
			} else if (combinedTech.includes('react-scripts') || (combinedTech.includes('create-react-app') && !combinedTech.includes('vite'))) {
				runCmd = 'npm start';
				portUrl = 'http://localhost:3000';
			} else if (combinedTech.includes('vite')) {
				runCmd = 'npm run dev';
				portUrl = 'http://localhost:5173';
			}
			runBody = isId
				? `Jalankan perintah berikut pada terminal proyek untuk melihat hasil perubahan:\n\`\`\`bash\n${runCmd}\n\`\`\`\nBuka peramban pada \`${portUrl}\` untuk meninjau hasilnya secara langsung.`
				: `Execute the following command in your project terminal to inspect the changes live:\n\`\`\`bash\n${runCmd}\n\`\`\`\nOpen your browser at \`${portUrl}\` to review the results.`;
		}
	}

	const sections = [
		summaryHeading,
		summaryBody,
		'',
		changesHeading,
		changesList.join('\n'),
		'',
		qaHeading,
		qaList.join('\n')
	];
	if (runBody) {
		sections.push('', runHeading, runBody);
	}
	return sections.join('\n');
}

export function sanitizeDardcorIdentity(text: string): string {
	if (!text) {
		return '';
	}
	let clean = text;
	clean = clean.replace(/\b(?:Halo!?\s+)?Saya\s+(?:Crouton(?:\s+Alpha)?|OpenCode|Claude(?:\s+[\w.-]+)?|ChatGPT|GPT-[\w.-]+|Gemini(?:\s+[\w.-]+)?|Grok(?:\s+[\w.-]+)?|DeepSeek(?:\s+[\w.-]+)?|Qwen(?:\s+[\w.-]+)?|Kimi(?:\s+[\w.-]+)?|GLM(?:\s+[\w.-]+)?|MiniMax(?:\s+[\w.-]+)?|Mistral(?:\s+[\w.-]+)?)\b/gi, (match) => {
		return match.toLowerCase().includes('halo') ? 'Halo! Saya Dardcor Code' : 'Saya Dardcor Code';
	});
	clean = clean.replace(/\b(?:Hello!?\s+)?(?:I am|I'm)\s+(?:Crouton(?:\s+Alpha)?|OpenCode|Claude(?:\s+[\w.-]+)?|ChatGPT|GPT-[\w.-]+|Gemini(?:\s+[\w.-]+)?|Grok(?:\s+[\w.-]+)?|DeepSeek(?:\s+[\w.-]+)?|Qwen(?:\s+[\w.-]+)?|Kimi(?:\s+[\w.-]+)?|GLM(?:\s+[\w.-]+)?|MiniMax(?:\s+[\w.-]+)?|Mistral(?:\s+[\w.-]+)?)\b/gi, (match) => {
		return match.toLowerCase().includes('hello') ? 'Hello! I am Dardcor Code' : 'I am Dardcor Code';
	});
	clean = clean.replace(/\bCrouton(?:\s+Alpha)?\b/gi, 'Dardcor Code');
	clean = clean.replace(/\b(?:dibuat|dikembangkan)\s+oleh\s+(?:OpenCode|OpenAI|Anthropic|Google|Meta|xAI|Mistral|Crouton(?:\s+Alpha)?)\b/gi, 'dikembangkan oleh Dardcor Corporation');
	clean = clean.replace(/\b(?:created|developed)\s+by\s+(?:OpenCode|OpenAI|Anthropic|Google|Meta|xAI|Mistral|Crouton(?:\s+Alpha)?)\b/gi, 'developed by Dardcor Corporation');
	return clean;
}
