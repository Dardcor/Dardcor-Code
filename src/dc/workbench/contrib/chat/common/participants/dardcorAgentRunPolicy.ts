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
	'read_file', 'list_directory', 'find_files', 'search_code', 'grep_search',
	'get_diagnostics', 'get_file_outline', 'get_terminal_output', 'terminal_selection',
	'terminal_last_command', 'get_task_output', 'read_browser_page', 'read_page',
	'get_browser_console_logs', 'screenshot_browser_page', 'screenshot_page', 'wait_for_browser',
	'manage_todo_list', 'ask_questions', 'review_plan', 'task_completed',
]);

const DARDCORE_COMMAND_TOOLS = new Set([
	'run_command', 'run_in_terminal', 'bash', 'execute_command', 'cmd', 'sh', 'powershell',
	'terminal', 'create_and_run_task', 'run_task', 'send_to_terminal', 'kill_terminal',
]);

const DARDCORE_STATEFUL_TOOLS = new Set([
	'write_file', 'edit_file', 'delete_file', 'rename_file', 'fetch_web_page', 'open_browser_page',
	'navigate_browser', 'navigate_page', 'click_element', 'type_in_page', 'scroll_browser_page',
	'hover_element', 'press_key', 'select_option', 'drag_and_drop', 'execute_browser_script',
	'handle_browser_dialog', 'set_artifacts', 'set_artifact_rules', 'run_subagent', 'confirm_terminal_command',
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

/**
 * In-flight compaction of past tool results and large payloads in messages array,
 * keeping the conversation lean, fast, and safely within context budget.
 */
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

	// Pass 1: Prune multimodal base64 screenshots in older turns
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

	// Pass 2: Compact older tool messages ('role: tool') and text-tool fallback user messages
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

	// Pass 3: Compact large file contents in older assistant tool_calls arguments (e.g. write_file/edit_file)
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

	// If the command does not match any recognized test/verification suite, it is NOT verification evidence
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

	// 1. Script-based high-confidence checks
	if (/[\u0600-\u06FF]/.test(trimmed)) {
		return 'ar';
	}
	// Japanese: Hiragana or Katakana presence is unique to Japanese
	if (/[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed)) {
		return 'ja';
	}
	// Korean: Hangul syllables or jamo
	if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed)) {
		return 'ko';
	}
	// Russian / Cyrillic
	if (/[\u0400-\u04FF]/.test(trimmed)) {
		return 'ru';
	}
	// Chinese: CJK Ideographs without Japanese kana
	if (/[\u4E00-\u9FFF]/.test(trimmed)) {
		return 'zh';
	}

	// 2. Lexical scoring for Latin-script languages
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

	scoreMatches(/\b(saya|kamu|anda|tolong|perbaiki|buat|buatkan|bikin|ganti|ubah|cek|periksa|hapus|tampilkan|nomer|nomor|selesai|belum|jangan|kenapa|mengapa|coba|kerjakan|lanjut|lanjutkan|teruskan|aplikasi|fitur|ada|yang|ini|itu|di|ke|dari|untuk|dengan|dan|atau|sudah|bisa|harus|mau|akan|masih|tapi|namun|bagaimana|apa|semua|secara|otomatis|stiker|jawaban|gambar|kendala|bahasa|dunia|pastikan|mendeteksi|skrip|jalan|jalankan|instal|pasang|tampilan|router|hilang|muncul|terkadang|data|realtime|token|unlimited|baca|project|aslinya|menembus|sempurna|rencana|perbaikan|system|canggih)\b/gi, 'id', 3);
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
	// Localized tool and action confirmation dialog strings
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
	},
};

export function getDardcorLocaleStrings(lang: DardcorSupportedLanguage): IDardcorLocaleStrings {
	return DARDCOR_LOCALE_MAP[lang] ?? DARDCOR_LOCALE_MAP.en;
}

export function getDardcorAutonomousSelfCorrectionDirective(lang: DardcorSupportedLanguage, errorPreview: string): string {
	switch (lang) {
		case 'id':
			return `[Arahan Koreksi Mandiri]: Tindakan alat mengalami kendala (${errorPreview}). Mode Akses Penuh (Full Access) aktif, jangan berhenti atau meminta intervensi pengguna. Analisis penyebab kegagalan alat ini, sesuaikan pendekatan implementasi, dan segera lanjutkan dengan pemanggilan alat korektif berikutnya.`;
		case 'ja':
			return `[自律自己修正指令]: ツールのアクションでエラーが発生しました (${errorPreview})。フルアクセス（自律モード）が有効です。停止したりユーザーに介入を求めたりせず、失敗の原因を分析してアプローチを調整し、次の修正ツール呼び出しを直ちに実行してください。`;
		case 'zh':
			return `[自主自我纠正指令]：工具操作遇到错误 (${errorPreview})。完全访问（自主模式）已启用，请勿停止或请求用户干预。分析此工具调用失败的原因，调整实现方案，并立即进行下一次纠正性工具调用。`;
		case 'ko':
			return `[자율 자기 수정 지침]: 도구 동작 중 오류가 발생했습니다 (${errorPreview}). 전체 액세스(자율 모드)가 활성화되어 있으므로 멈추거나 사용자에게 개입을 요청하지 마십시오. 실패 원인을 분석하고 구현 접근 방식을 조정한 후 즉시 다음 수정 도구를 호출하십시오.`;
		case 'es':
			return `[Directiva de autocorrección autónoma]: Una acción de herramienta encontró un error (${errorPreview}). El modo de acceso completo está activo, no se detenga ni pida la intervención del usuario. Analice la causa del fallo, adapte su enfoque y proceda inmediatamente con la siguiente llamada a la herramienta correctiva.`;
		case 'fr':
			return `[Directive d'autocorrection autonome] : Une action d'outil a rencontré une erreur (${errorPreview}). Le mode d'accès complet est actif, ne vous arrêtez pas et ne demandez pas d'intervention. Analysez la cause de l'échec, adaptez votre approche et procédez immédiatement au prochain appel d'outil correctif.`;
		case 'de':
			return `[Autonome Selbstkorrektur-Anweisung]: Eine Tool-Aktion hat einen Fehler festgestellt (${errorPreview}). Der Vollzugriffsmodus ist aktiv, halten Sie nicht an und fordern Sie kein Eingreifen an. Analysieren Sie die Fehlerursache, passen Sie Ihren Ansatz an und fahren Sie sofort mit dem nächsten korrigierenden Tool-Aufruf fort.`;
		case 'pt':
			return `[Diretiva de autocorreção autónoma]: Uma ação de ferramenta encontrou um erro (${errorPreview}). O modo de acesso total está ativo, não pare nem solicite intervenção do usuário. Analise a causa da falha, adapte sua abordagem e prossiga imediatamente com a próxima chamada de ferramenta corretiva.`;
		case 'ru':
			return `[Директива автономного самоисправления]: Действие инструмента завершилось ошибкой (${errorPreview}). Режим полного доступа активен, не останавливайтесь и не запрашивайте вмешательства пользователя. Проанализируйте причину сбоя, скорректируйте подход и немедленно выполните следующее корректирующее действие.`;
		case 'it':
			return `[Direttiva di autocorrezione autonoma]: Un'azione dello strumento ha riscontrato un errore (${errorPreview}). La modalità di accesso completo è attiva, non fermarti e non chiedere l'intervento dell'utente. Analizza la causa del problema, adatta il tuo approccio e procedi immediatamente con la successiva chiamata di correzione.`;
		case 'ar':
			return `[توجيه التصحيح الذاتي التلقائي]: واجه إجراء الأداة خطأ (${errorPreview}). وضع الوصول الكامل نشط، لا تتوقف أو تطلب تدخل المستخدم. حلل سبب الفشل، وعدّل نهج التنفيذ، وتابع فوراً باستدعاء الأداة التصحيحية التالية.`;
		default:
			return `[Autonomous Self-Correction Directive]: A tool action encountered an error (${errorPreview}). Full Access (Autonomous Mode) is active, so do not stop or ask the user to intervene. Analyze why this tool call failed, adapt your implementation approach, and proceed immediately with the next corrective action tool call.`;
	}
}

export function getDardcorAutonomousMomentumDirective(
	lang: DardcorSupportedLanguage,
	completedCount: number,
	totalCount: number,
	nextItem: { id: string | number; title: string }
): string {
	switch (lang) {
		case 'id':
			return `[Arahan Momentum Mandiri]: Daftar tugas belum selesai (${completedCount}/${totalCount} item selesai). DILARANG berhenti atau hanya mengeluarkan teks percakapan/rencana. Segera lanjutkan implementasi item daftar tugas #${nextItem.id}: "${nextItem.title}". Panggil satu alat aksi konkret sekarang (misalnya write_file, edit_file, run_command, atau manage_todo_list). Jika menulis banyak berkas, tulis satu berkas per pemanggilan write_file agar tidak terpotong.`;
		case 'ja':
			return `[自律モメンタム指令]: タスクチェックリストはまだ完了していません（${completedCount}/${totalCount} 完了）。テキストのみを出力して停止せず、直ちに未完了のチェックリスト項目 #${nextItem.id}: "${nextItem.title}" の実装に進んでください。1回の呼び出しにつき1つの具体的なツール（write_file、edit_file、run_commandなど）を今すぐ呼び出してください。`;
		case 'zh':
			return `[自主推进指令]：任务清单尚未完成（已完成 ${completedCount}/${totalCount} 项）。严禁仅输出对话或计划文本而停止。立即继续执行未完成的清单项 #${nextItem.id}：“${nextItem.title}”。现在立即调用一个具体的操作工具（如 write_file、edit_file、run_command 或 manage_todo_list），每次写入一个文件以防截断。`;
		case 'ko':
			return `[자율 모멘텀 지침]: 체크리스트가 아직 완료되지 않았습니다 (${completedCount}/${totalCount} 항목 완료). 대화 텍스트만 출력하고 멈추지 마십시오. 즉시 미완료 체크리스트 항목 #${nextItem.id}: "${nextItem.title}" 구현을 진행하고 지금 바로 구체적인 도구(write_file, edit_file, run_command 등)를 호출하십시오.`;
		case 'es':
			return `[Directiva de impulso autónomo]: La lista de tareas aún no está terminada (${completedCount}/${totalCount} completadas). No se detenga solo con texto conversacional. Proceda de inmediato con la implementación del elemento #${nextItem.id}: "${nextItem.title}". Llame a una herramienta de acción concreta ahora (write_file, edit_file, run_command).`;
		case 'fr':
			return `[Directive d'élan autonome] : La liste de contrôle n'est pas encore terminée (${completedCount}/${totalCount} éléments terminés). Ne vous arrêtez pas au simple texte conversationnel. Passez immédiatement à l'implémentation de l'élément #${nextItem.id} : "${nextItem.title}". Appelez un outil d'action concret dès maintenant.`;
		case 'de':
			return `[Autonome Impuls-Anweisung]: Die Checkliste ist noch nicht abgeschlossen (${completedCount}/${totalCount} Aufgaben erledigt). Halten Sie nicht mit reinem Text an. Fahren Sie sofort mit der Implementierung des Checklisteneintrags #${nextItem.id} fort: "${nextItem.title}". Rufen Sie jetzt das entsprechende Tool auf.`;
		case 'pt':
			return `[Diretiva de impulso autónomo]: A lista de tarefas ainda não foi concluída (${completedCount}/${totalCount} itens concluídos). Não pare emitindo apenas texto de conversa. Prossiga imediatamente com a implementação do item #${nextItem.id}: "${nextItem.title}". Chame a ferramenta relevante agora.`;
		case 'ru':
			return `[Директива автономного импульса]: Контрольный список еще не завершен (выполнено ${completedCount}/${totalCount}). Не останавливайтесь на простом тексте ответов. Немедленно переходите к выполнению следующего пункта списка #${nextItem.id}: "${nextItem.title}". Вызовите соответствующий инструмент прямо сейчас.`;
		case 'it':
			return `[Direttiva di impulso autonomo]: La lista delle attività non è ancora completata (${completedCount}/${totalCount} elementi completati). Non fermarti con solo testo conversazionale. Procedi immediatamente con l'implementazione della voce #${nextItem.id}: "${nextItem.title}". Chiama subito lo strumento pertinente.`;
		case 'ar':
			return `[توجيه الزخم التلقائي]: قائمة المهام لم تكتمل بعد (${completedCount}/${totalCount} عنصر مكتمل). لا تتوقف عند إخراج نص محادثة فقط. تابع فوراً تنفيذ عنصر القائمة التالي #${nextItem.id}: "${nextItem.title}". استدعِ الأداة المناسبة الآن.`;
		default:
			return `[Autonomous Momentum Directive]: The task checklist is not yet finished (${completedCount}/${totalCount} items complete). Do NOT stop or yield conversational text without calling a tool. Proceed immediately with incomplete checklist item #${nextItem.id}: "${nextItem.title}". Invoke one concrete action tool now (e.g. write_file, edit_file, run_command, or manage_todo_list). When creating multiple files, write one file per write_file call to avoid token truncation.`;
	}
}

export function getDardcorFinalSummaryMandate(lang: DardcorSupportedLanguage): string {
	switch (lang) {
		case 'id':
			return `[Mandat Ringkasan Akhir]: Semua item checklist telah diselesaikan dan bukti verifikasi telah tercatat. Buat ringkasan sintesis akhir yang sangat terstruktur dalam Bahasa Indonesia sesuai protokol Antigravity (Ringkasan Eksekutif, Perubahan Kunci, Bukti Verifikasi, Panduan Menjalankan).`;
		case 'ja':
			return `[最終サマリー指令]: すべてのチェックリスト項目が完了し、検証証拠が記録されました。Antigravityプロトコルに従い、日本語で高度に構造化された最終統合レポート（エグゼクティブサマリー、主な変更点、検証証拠、実行方法）を作成してください。`;
		case 'zh':
			return `[最终总结指令]：所有清单项均已完成并已记录验证证据。请严格按照 Antigravity 协议要求，输出结构化的中文最终综合报告（执行摘要、核心变更、验证证据、运行指南）。`;
		case 'ko':
			return `[최종 요약 지침]: 모든 체크리스트 항목이 완료되었고 검증 증거가 기록되었습니다. Antigravity 프로토콜에 따라 한국어로 체계적인 최종 통합 보고서(요약, 주요 변경 사항, 검증 증거, 실행 가이드)를 작성하십시오.`;
		case 'es':
			return `[Mandato de resumen final]: Todos los elementos de la lista se han completado y se han registrado las pruebas de verificación. Proporcione un informe final de síntesis estructurado en español siguiendo el protocolo Antigravity (Resumen ejecutivo, Cambios clave, Evidencia de verificación, Guía de ejecución).`;
		case 'fr':
			return `[Mandat de synthèse finale] : Tous les éléments de la liste ont été complétés et les preuves de vérification enregistrées. Fournissez un rapport de synthèse final structuré en français selon le protocole Antigravity (Résumé exécutif, Modifications clés, Preuves de vérification, Guide d'exécution).`;
		case 'de':
			return `[Mandat für die Abschlussübersicht]: Alle Punkte der Checkliste wurden abgeschlossen und Verifizierungsnachweise wurden erfasst. Erstellen Sie einen strukturierten Abschlussbericht auf Deutsch nach dem Antigravity-Protokoll (Management-Zusammenfassung, Wichtige Änderungen, Verifizierungsnachweise, Ausführungsanleitung).`;
		case 'pt':
			return `[Mandato de resumo final]: Todos os itens da lista foram concluídos e as evidências de verificação foram registradas. Apresente um relatório final de síntese estruturado em português de acordo com o protocolo Antigravity (Resumo executivo, Principais alterações, Evidências de verificação, Guia de execução).`;
		case 'ru':
			return `[Мандат итоговой сводки]: Все пункты контрольного списка выполнены, и подтверждения проверки зафиксированы. Предоставьте структурированный итоговый отчет на русском языке по протоколу Antigravity (Краткое резюме, Ключевые изменения, Доказательства проверки, Руководство по запуску).`;
		case 'it':
			return `[Mandato di riepilogo finale]: Tutte le voci della lista sono state completate e sono state registrate le evidenze di verifica. Fornisci un rapporto finale di sintesi strutturato in italiano secondo il protocollo Antigravity (Riepilogo esecutivo, Modifiche principali, Evidenze di verifica, Guida all'esecuzione).`;
		case 'ar':
			return `[تكليف الملخص النهائي]: تم الانتهاء من جميع عناصر القائمة وتسجيل أدلة التحقق. قدم تقريراً ختامياً شاملاً باللغة العربية وفقاً لبروتوكول Antigravity (ملخص تنفيذي، التغييرات الرئيسية، أدلة التحقق، دليل التشغيل).`;
		default:
			return `[Final Summary Mandate]: All checklist items have been completed and verified. Deliver an Antigravity-style structured final synthesis report in English (Executive Summary, Key Changes, Verification Evidence, How to Run).`;
	}
}
