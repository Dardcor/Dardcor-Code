/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { AGENT_BUILTIN_CUSTOMIZATION_SCHEME } from '../../../common/agentHostCustomizationUri.js';
import { CustomizationType } from '../../../common/state/protocol/channels-session/state.js';
import { CustomizationLoadStatus, customizationId, type DirectoryCustomization, type SkillCustomization } from '../../../common/state/sessionState.js';

interface IClaudeBuiltinCommand {
	readonly name: string;
	readonly description: () => string;
}

const CLAUDE_BUILTIN_COMMANDS: readonly IClaudeBuiltinCommand[] = [
	{ name: 'init', description: () => localize('claude.builtin.init', "(Built-In) Scan the codebase and generate a `CLAUDE.md` file with project structure, conventions, and instructions for future sessions.") },
	{ name: 'review', description: () => localize('claude.builtin.review', "(Built-In) Review a pull request or set of changes.") },
	{ name: 'security-review', description: () => localize('claude.builtin.securityReview', "(Built-In) Complete a security review of the pending changes on the current branch.") },
	{ name: 'code-review', description: () => localize('claude.builtin.codeReview', "(Built-In) Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups at a chosen effort level (low→max). Pass `--comment` to post findings as inline PR comments, or `--fix` to apply them to the working tree.") },
	{ name: 'simplify', description: () => localize('claude.builtin.simplify', "(Built-In) Review changed code for reuse, simplification, efficiency, and altitude cleanups, then apply the fixes. Quality only — it doesn't hunt for bugs (use `/code-review` for that).") },
	{ name: 'verify', description: () => localize('claude.builtin.verify', "(Built-In) Run the app and observe behavior to confirm a code change actually does what it's supposed to. Use to verify a PR, confirm a fix, or validate local changes before pushing.") },
	{ name: 'run', description: () => localize('claude.builtin.run', "(Built-In) Launch and drive the project's app to see a change working — run, start, or screenshot the app, or confirm a change works in the real app (not just tests).") },
	{ name: 'loop', description: () => localize('claude.builtin.loop', "(Built-In) Run a prompt or slash command on a recurring interval (e.g. `/loop 5m /foo`, defaults to 10m). For recurring tasks or polling status — not one-off work.") },
	{ name: 'claude-api', description: () => localize('claude.builtin.claudeApi', "(Built-In) Reference for the Claude API / Anthropic SDK: model IDs, pricing, params, streaming, tool use, MCP, agents, caching, token counting, migration.") },
	{ name: 'fewer-permission-prompts', description: () => localize('claude.builtin.fewerPermissionPrompts', "(Built-In) Scan transcripts for common read-only Bash/MCP calls and add a prioritized allowlist to project `.claude/settings.json` to reduce permission prompts.") },
	{ name: 'update-config', description: () => localize('claude.builtin.updateConfig', "(Built-In) Configure the Claude Code harness via `settings.json`: hooks for automated behaviors, permissions, env vars, and hook troubleshooting.") },
	{ name: 'keybindings-help', description: () => localize('claude.builtin.keybindingsHelp', "(Built-In) Customize keyboard shortcuts, rebind keys, add chord bindings, or modify `~/.claude/keybindings.json`.") },
	{ name: 'write-a-skill', description: () => localize('claude.builtin.writeASkill', "(Built-In) Author a new skill.") },
];

export interface IClaudeBuiltinAgent {
	readonly name: string;
	readonly description: () => string;
}

export const CLAUDE_BUILTIN_AGENTS: readonly IClaudeBuiltinAgent[] = [
	{ name: 'claude', description: () => localize('claude.builtinAgent.claude', "(Built-In) Catch-all for any task that doesn't fit a more specific agent — the default when no agent name is typed.") },
	{ name: 'claude-code-guide', description: () => localize('claude.builtinAgent.claudeCodeGuide', "(Built-In) Answers questions about the Claude Agent SDK, and the Claude/Anthropic API — features, hooks, slash commands, MCP servers, settings, IDE integrations, SDK agent-building, and API usage. Model: Haiku.") },
	{ name: 'Explore', description: () => localize('claude.builtinAgent.explore', "(Built-In) Read-only search agent for broad fan-out searches across many files when you only need the conclusion; it locates code rather than reviewing it. Model: Haiku.") },
	{ name: 'general-purpose', description: () => localize('claude.builtinAgent.generalPurpose', "(Built-In) General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.") },
	{ name: 'Plan', description: () => localize('claude.builtinAgent.plan', "(Built-In) Software architect agent for designing implementation plans — step-by-step plans, critical files, and architectural trade-offs.") },
];

interface IBuiltinSkillEntry {
	readonly name: string;
	readonly description: string;
}

function buildBuiltinSkillsContainer(entries: readonly IBuiltinSkillEntry[]): DirectoryCustomization | undefined {
	if (entries.length === 0) {
		return undefined;
	}

	const children: SkillCustomization[] = entries.map(entry => {
		const uri = URI.from({ scheme: AGENT_BUILTIN_CUSTOMIZATION_SCHEME, path: `/skill/${encodeURIComponent(entry.name)}` }).toString();
		return {
			type: CustomizationType.Skill,
			id: customizationId(uri),
			uri,
			name: entry.name,
			description: entry.description,
		};
	});

	const containerUri = URI.from({ scheme: AGENT_BUILTIN_CUSTOMIZATION_SCHEME, path: '/skills' }).toString();
	return {
		type: CustomizationType.Directory,
		id: customizationId(containerUri),
		uri: containerUri,
		name: 'builtin',
		enabled: true,
		contents: CustomizationType.Skill,
		writable: false,
		load: { kind: CustomizationLoadStatus.Loaded },
		children,
	};
}

export function buildClaudeBuiltinSkillsContainer(diskSkillNames: ReadonlySet<string>): DirectoryCustomization | undefined {
	return buildBuiltinSkillsContainer(
		CLAUDE_BUILTIN_COMMANDS
			.filter(cmd => !diskSkillNames.has(cmd.name))
			.map(cmd => ({ name: cmd.name, description: cmd.description() }))
	);
}

export function buildSdkBuiltinSkillsContainer(
	commands: readonly IBuiltinSkillEntry[],
	diskSkillNames: ReadonlySet<string>,
): DirectoryCustomization | undefined {
	const seen = new Set<string>();
	const entries: IBuiltinSkillEntry[] = [];
	for (const command of commands) {
		if (diskSkillNames.has(command.name) || seen.has(command.name)) {
			continue;
		}
		seen.add(command.name);
		entries.push({ name: command.name, description: command.description });
	}
	return buildBuiltinSkillsContainer(entries);
}
