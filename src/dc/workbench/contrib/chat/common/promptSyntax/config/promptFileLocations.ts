/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { basename, dirname } from '../../../../../../base/common/resources.js';
import { PromptFileSource, PromptsType } from '../promptTypes.js';
import { PromptsStorage } from '../service/promptsService.js';
import { compareIgnoreCase } from '../../../../../../base/common/strings.js';

export const PROMPT_FILE_EXTENSION = '.prompt.md';

export const INSTRUCTION_FILE_EXTENSION = '.instructions.md';

export const LEGACY_MODE_FILE_EXTENSION = '.chatmode.md';

export const AGENT_FILE_EXTENSION = '.agent.md';

export const SKILL_FILENAME = 'SKILL.md';

export function isSkillFilename(filename: string): boolean {
	return compareIgnoreCase(filename, SKILL_FILENAME) === 0;
}

export const VALID_SKILL_NAME_REGEX = /^[a-z0-9-]+$/;

export const AGENT_MD_FILENAME = 'AGENTS.md';

export const CLAUDE_MD_FILENAME = 'CLAUDE.md';

export const CLAUDE_LOCAL_MD_FILENAME = 'CLAUDE.local.md';

export const CLAUDE_CONFIG_FOLDER = '.claude';

export const COPILOT_CONFIG_FOLDER = '.copilot';

export const COPILOT_CUSTOM_INSTRUCTIONS_FILENAME = 'copilot-instructions.md';

export const VOICE_INSTRUCTIONS_FILENAME = 'voice.md';

export const DICTATION_INSTRUCTIONS_FILENAME = 'dictation.md';

export const GITHUB_CONFIG_FOLDER = '.github';

export const PROMPT_DEFAULT_SOURCE_FOLDER = '.github/prompts';

export const INSTRUCTIONS_DEFAULT_SOURCE_FOLDER = '.github/instructions';

export const LEGACY_MODE_DEFAULT_SOURCE_FOLDER = '.github/chatmodes';

export const AGENTS_SOURCE_FOLDER = '.github/agents';

export const CLAUDE_AGENTS_SOURCE_FOLDER = '.claude/agents';

export const COPILOT_USER_AGENTS_SOURCE_FOLDER = '~/.copilot/agents';

export const CLAUDE_RULES_SOURCE_FOLDER = '.claude/rules';

export const HOOKS_SOURCE_FOLDER = '.github/hooks';

export type PromptFolderSource = Exclude<PromptFileSource, PromptFileSource.ExtensionContribution | PromptFileSource.ExtensionAPI | PromptFileSource.Plugin>;

export interface IPromptSourceFolder {
	readonly path: string;
	readonly source: PromptFolderSource;
	readonly storage: PromptsStorage.local | PromptsStorage.user;
}

export interface IResolvedPromptSourceFolder {
	readonly uri: URI;
	readonly searchRoot: URI;
	readonly filePattern: string | undefined;
	readonly source: PromptFolderSource;
	readonly storage: PromptsStorage.local | PromptsStorage.user;
	readonly displayPath?: string;
	readonly isDefault?: boolean;
}

export const DEFAULT_SKILL_SOURCE_FOLDERS: readonly IPromptSourceFolder[] = [
	{ path: '.dardcor/skills', source: PromptFileSource.AgentsWorkspace, storage: PromptsStorage.local },
	{ path: '~/.dardcor/skills', source: PromptFileSource.AgentsPersonal, storage: PromptsStorage.user },
	{ path: '.agents/skills', source: PromptFileSource.AgentsWorkspace, storage: PromptsStorage.local },
	{ path: '.claude/skills', source: PromptFileSource.ClaudeWorkspace, storage: PromptsStorage.local },
	{ path: '~/.agents/skills', source: PromptFileSource.AgentsPersonal, storage: PromptsStorage.user },
	{ path: '~/.copilot/skills', source: PromptFileSource.CopilotPersonal, storage: PromptsStorage.user },
	{ path: '~/.claude/skills', source: PromptFileSource.ClaudePersonal, storage: PromptsStorage.user },
];

export const DEFAULT_INSTRUCTIONS_SOURCE_FOLDERS: readonly IPromptSourceFolder[] = [
	{ path: INSTRUCTIONS_DEFAULT_SOURCE_FOLDER, source: PromptFileSource.GitHubWorkspace, storage: PromptsStorage.local },
	{ path: CLAUDE_RULES_SOURCE_FOLDER, source: PromptFileSource.ClaudeWorkspace, storage: PromptsStorage.local },
	{ path: '~/.copilot/instructions', source: PromptFileSource.CopilotPersonal, storage: PromptsStorage.user },
	{ path: '~/' + CLAUDE_RULES_SOURCE_FOLDER, source: PromptFileSource.ClaudePersonal, storage: PromptsStorage.user },
];

export const DEFAULT_PROMPT_SOURCE_FOLDERS: readonly IPromptSourceFolder[] = [];

export const DEFAULT_AGENT_SOURCE_FOLDERS: readonly IPromptSourceFolder[] = [
	{ path: AGENTS_SOURCE_FOLDER, source: PromptFileSource.GitHubWorkspace, storage: PromptsStorage.local },
	{ path: CLAUDE_AGENTS_SOURCE_FOLDER, source: PromptFileSource.ClaudeWorkspace, storage: PromptsStorage.local },
	{ path: COPILOT_USER_AGENTS_SOURCE_FOLDER, source: PromptFileSource.CopilotPersonal, storage: PromptsStorage.user },
	{ path: '~/' + CLAUDE_AGENTS_SOURCE_FOLDER, source: PromptFileSource.ClaudePersonal, storage: PromptsStorage.user },
];

export const DEFAULT_HOOK_FILE_PATHS: readonly IPromptSourceFolder[] = [
	{ path: '.github/hooks', source: PromptFileSource.GitHubWorkspace, storage: PromptsStorage.local },
	{ path: '.claude/settings.local.json', source: PromptFileSource.ClaudeWorkspaceLocal, storage: PromptsStorage.local },
	{ path: '.claude/settings.json', source: PromptFileSource.ClaudeWorkspace, storage: PromptsStorage.local },
	{ path: '~/.copilot/hooks', source: PromptFileSource.CopilotPersonal, storage: PromptsStorage.user },
	{ path: '~/.claude/settings.json', source: PromptFileSource.ClaudePersonal, storage: PromptsStorage.user },
];

function isInAgentsFolder(fileUri: URI): boolean {
	const dir = dirname(fileUri).path;
	return dir.endsWith('/' + AGENTS_SOURCE_FOLDER) || dir.endsWith('/' + CLAUDE_AGENTS_SOURCE_FOLDER) || isInCopilotAgentsFolder(fileUri);
}

export function isInClaudeAgentsFolder(fileUri: URI): boolean {
	const dir = dirname(fileUri).path;
	return dir.endsWith('/' + CLAUDE_AGENTS_SOURCE_FOLDER);
}

export function isInCopilotAgentsFolder(fileUri: URI): boolean {
	const dir = dirname(fileUri).path;
	return dir.endsWith(COPILOT_USER_AGENTS_SOURCE_FOLDER.substring(1));
}

export function isInClaudeRulesFolder(fileUri: URI): boolean {
	const path = fileUri.path;
	return path.includes('/' + CLAUDE_RULES_SOURCE_FOLDER + '/');
}

export function getPromptFileType(fileUri: URI): PromptsType | undefined {
	const filename = basename(fileUri);

	if (filename.endsWith(PROMPT_FILE_EXTENSION)) {
		return PromptsType.prompt;
	}

	if (filename.endsWith(INSTRUCTION_FILE_EXTENSION) || (filename === COPILOT_CUSTOM_INSTRUCTIONS_FILENAME)) {
		return PromptsType.instructions;
	}

	if (filename.endsWith(LEGACY_MODE_FILE_EXTENSION) || filename.endsWith(AGENT_FILE_EXTENSION)) {
		return PromptsType.agent;
	}

	if (isSkillFilename(filename)) {
		return PromptsType.skill;
	}

	if (filename.endsWith('.md') && filename !== 'README.md' && isInAgentsFolder(fileUri)) {
		return PromptsType.agent;
	}

	if (filename.endsWith('.md') && filename !== 'README.md' && isInClaudeRulesFolder(fileUri)) {
		return PromptsType.instructions;
	}

	if (filename.toLowerCase().endsWith('.json')) {
		return PromptsType.hook;
	}

	return undefined;
}

export function isPromptOrInstructionsFile(fileUri: URI): boolean {
	return getPromptFileType(fileUri) !== undefined;
}

export function getPromptFileExtension(type: PromptsType): string {
	switch (type) {
		case PromptsType.instructions:
			return INSTRUCTION_FILE_EXTENSION;
		case PromptsType.prompt:
			return PROMPT_FILE_EXTENSION;
		case PromptsType.agent:
			return AGENT_FILE_EXTENSION;
		case PromptsType.skill:
			return SKILL_FILENAME;
		case PromptsType.hook:
			return '.json';
		default:
			throw new Error('Unknown prompt type');
	}
}

export function getPromptFileDefaultLocations(type: PromptsType): readonly IPromptSourceFolder[] {
	switch (type) {
		case PromptsType.instructions:
			return DEFAULT_INSTRUCTIONS_SOURCE_FOLDERS;
		case PromptsType.prompt:
			return DEFAULT_PROMPT_SOURCE_FOLDERS;
		case PromptsType.agent:
			return DEFAULT_AGENT_SOURCE_FOLDERS;
		case PromptsType.skill:
			return DEFAULT_SKILL_SOURCE_FOLDERS;
		case PromptsType.hook:
			return DEFAULT_HOOK_FILE_PATHS;
		default:
			throw new Error('Unknown prompt type');
	}
}

export function getSkillFolderName(fileUri: URI): string {
	return basename(dirname(fileUri));
}

export function getCleanPromptName(fileUri: URI): string {
	const fileName = basename(fileUri);

	const extensions = [
		PROMPT_FILE_EXTENSION,
		INSTRUCTION_FILE_EXTENSION,
		LEGACY_MODE_FILE_EXTENSION,
		AGENT_FILE_EXTENSION,
	];

	for (const ext of extensions) {
		if (fileName.endsWith(ext)) {
			return basename(fileUri, ext);
		}
	}

	if (fileName === COPILOT_CUSTOM_INSTRUCTIONS_FILENAME) {
		return basename(fileUri, '.md');
	}

	if (isSkillFilename(fileName)) {
		return getSkillFolderName(fileUri);
	}

	if (fileName.endsWith('.md') && fileName !== 'README.md' && isInAgentsFolder(fileUri)) {
		return basename(fileUri, '.md');
	}

	if (fileName.endsWith('.md') && fileName !== 'README.md' && isInClaudeRulesFolder(fileUri)) {
		return basename(fileUri, '.md');
	}

	return basename(fileUri);
}
