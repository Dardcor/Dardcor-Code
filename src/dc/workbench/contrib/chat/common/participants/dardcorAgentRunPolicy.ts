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
	const canonicalName = TOOL_ALIASES[requestedName] ?? requestedName;
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
	return /\b(create|make|build|implement|improve|fix|repair|debug|diagnose|refactor|update|change|add|remove|write|code|test|verify|check|inspect|review|analyze|selesaikan|buat|bikin|perbaiki|perbaikan|ubah|tambahkan|hapus|uji|cek|periksa|testing|kerjakan|lanjutkan|continue)\b/i.test(prompt);
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
	// Even a read command must stay inside the workspace and avoid shell-level
	// paths that can escape it. The terminal sandbox remains an additional layer.
	if (/(?:^|\s)(?:\.\.[\\/]|~[\\/]|[a-z]:[\\/]|\\\\[^\s]*|\/(?:[^\s/]+))/i.test(normalized)) {
		return false;
	}

	const safeReadOnlyCommands = [
		/^pwd$/i,
		/^git\s+status(?:\s+--short)?$/i,
		/^git\s+diff\s+--no-ext-diff(?:\s+(?:--stat|--name-only))?$/i,
		/^git\s+branch\s+--show-current$/i,
		/^git\s+rev-parse\s+--show-toplevel$/i,
		/^(?:node|npm|pnpm|yarn)\s+--version$/i,
	];
	if (safeReadOnlyCommands.some(pattern => pattern.test(normalized))) {
		return true;
	}

	// Package scripts execute repository-controlled code, so even familiar
	// verification commands are not safe to auto-approve as read-only actions.
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

/**
 * Applies the chat-session access mode to every Router tool before it runs.
 * Unknown and state-changing tools fail closed; only explicitly read-only tools
 * and a small safe-command allowlist can proceed without a confirmation.
 */
export function requiresDardcorToolConfirmation(
	toolName: string,
	args: Record<string, unknown> | undefined,
	permissionLevel: string | undefined,
): boolean {
	const knownTool = DARDCORE_READ_ONLY_TOOLS.has(toolName) || DARDCORE_COMMAND_TOOLS.has(toolName) || DARDCORE_STATEFUL_TOOLS.has(toolName);
	if (!knownTool) {
		return true;
	}
	if (permissionLevel === 'autoApprove') {
		return false;
	}
	if (DARDCORE_COMMAND_TOOLS.has(toolName)) {
		const command = toolName === 'kill_terminal'
			? `kill_terminal:${String(args?.id ?? args?.terminalId ?? '').trim()}`
			: String(args?.command ?? args?.commandLine ?? args?.taskLabel ?? args?.label ?? args?.text ?? '').trim();
		return requiresDardcorCommandConfirmation(toolName, command, permissionLevel);
	}
	if (DARDCORE_READ_ONLY_TOOLS.has(toolName)) {
		return false;
	}
	// Network access, browser interactions, file writes, subagents, and unknown
	// tools can have side effects and therefore need a one-time user decision.
	return true;
}

export function summarizeDardcorToolAction(toolName: string, args: Record<string, unknown> | undefined): string {
	if (!args) {
		return toolName;
	}
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
		click_element: ['pageId', 'elementId', 'selector', 'text', 'x', 'y', 'doubleClick'],
		type_in_page: ['pageId', 'elementId', 'selector', 'text', 'clearFirst', 'pressEnter'],
		scroll_browser_page: ['pageId', 'direction', 'amount', 'selector', 'elementId'],
		hover_element: ['pageId', 'elementId', 'selector', 'text', 'x', 'y'],
		press_key: ['pageId', 'key'],
		select_option: ['pageId', 'elementId', 'selector', 'value', 'optionText', 'index'],
		drag_and_drop: ['pageId', 'sourceElementId', 'targetElementId'],
		execute_browser_script: ['pageId', 'script'],
		handle_browser_dialog: ['pageId', 'accept', 'promptText'],
		set_artifacts: ['artifacts'],
		set_artifact_rules: ['rules'],
	};
	const fields = fieldsByTool[toolName] ?? Object.keys(args).slice(0, 8);
	const details = fields.flatMap(key => {
		const value = args[key];
		if (value === undefined) {
			return [];
		}
		const raw = typeof value === 'string' ? value : JSON.stringify(value);
		const normalized = (raw ?? String(value)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\r\n\t]+/g, ' ');
		const excerpt = normalized.length > 480 ? `${normalized.slice(0, 480)}… [${normalized.length} chars]` : normalized;
		return [`${key}: ${excerpt}`];
	});
	return details.length > 0 ? `${toolName}\n${details.join('\n')}`.slice(0, 1200) : toolName;
}

export function getDardcorEffectivePermissionLevel(permissionLevel: string | undefined, autoApprovePolicyRestricted: boolean): string | undefined {
	// Legacy Autopilot represents task continuation. It must not silently grant
	// Full access; the separate access picker controls action permissions.
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

export function getDardcorRunGuardReason(contextChars: number): string | undefined {
	if (contextChars >= DARDCOR_AGENT_MAX_CONTEXT_CHARS) {
		return 'The agent reached its conversation context budget before the task was verified.';
	}
	return undefined;
}

export type DardcorVerificationCommandStatus = 'passed' | 'failed' | 'inconclusive' | 'not-verification';

function isRecognizedVerificationCommand(command: string): boolean {
	const normalized = command.trim().replace(/^["']|["']$/g, '');
	if (!normalized) {
		return false;
	}
	const commands = normalized.split(/\s*(?:&&|\|\||[;|])\s*/).map(part => part.trim()).filter(Boolean);
	const verificationCommand = /^(?:(?:\.\/|\.\\)?(?:npm|pnpm|yarn|bun)\s+(?:(?:run|exec)\s+)?(?:test|tests|testing|build|compile|lint|typecheck|check|verify|coverage)(?:[-:.][\w-]+)*(?:\s|$)|(?:npx|pnpx|bunx)\s+(?:--yes\s+)?(?:vitest|jest|mocha|playwright|tsc|eslint|stylelint|phpunit)(?:\s|$)|(?:vitest|jest|mocha|pytest|phpunit)(?:\s|$)|playwright\s+test(?:\s|$)|python(?:3)?\s+-m\s+(?:pytest|unittest)(?:\s|$)|php\s+artisan\s+test(?:\s|$)|cargo\s+test(?:\s|$)|go\s+test(?:\s|$)|dotnet\s+test(?:\s|$)|(?:mvn|gradle|gradlew)\s+(?:.*\s)?(?:test|check|build)(?:\s|$))/i;
	return commands.some(part => {
		const executable = part.replace(/^(?:\s*(?:\.\s+|call\s+|&\s+))+/i, '').replace(/^(?:set\s+[A-Za-z_][\w]*=.*?\s+)+/i, '');
		return verificationCommand.test(executable);
	});
}

export function getDardcorVerificationCommandStatus(command: string, output: string): DardcorVerificationCommandStatus {
	if (!isRecognizedVerificationCommand(command)) {
		return 'not-verification';
	}
	const exitCodeMarker = output.match(/\[Command result: exit code (-?\d+)\]/i)
		?? output.match(/(?:Command failed with exit code|Exit code:)\s*(-?\d+)/i);
	if (exitCodeMarker) {
		return Number(exitCodeMarker[1]) === 0 ? 'passed' : 'failed';
	}
	if (/(?:did not report completion|without reporting an exit code|completion status not reported|not marked successful|timed out; the process may still be running|timed out before reporting an exit code|final status unknown|final exit status is unknown|success is not confirmed|result is inconclusive|no confirmed completion status)/i.test(output)) {
		return 'inconclusive';
	}
	if (/(?:Command failed|Command timed out|Terminal execution error|execution failed|\[ERROR\]|^Error:|\nError:|❌)/i.test(output)) {
		return 'failed';
	}
	return 'inconclusive';
}

export function getDardcorPlainTextTurnDecision(taskIsTracked: boolean, consecutiveTextTurns: number, maxTextTurns: number): 'continue' | 'pause' | 'normal' {
	if (!taskIsTracked) {
		return 'normal';
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
