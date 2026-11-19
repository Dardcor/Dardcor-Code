/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageSelector } from '../../../../../editor/common/languageSelector.js';
import { localize } from '../../../../../nls.js';

export const PROMPT_DOCUMENTATION_URL = 'https://www.dardcor-code.web.id/docs/agent-customization/prompt-files';
export const INSTRUCTIONS_DOCUMENTATION_URL = 'https://www.dardcor-code.web.id/docs/agent-customization/custom-instructions';
export const AGENT_DOCUMENTATION_URL = 'https://www.dardcor-code.web.id/docs/agent-customization/custom-agents';
export const SKILL_DOCUMENTATION_URL = 'https://www.dardcor-code.web.id/docs/agent-customization/agent-skills';
export const HOOK_DOCUMENTATION_URL = 'https://www.dardcor-code.web.id/docs/agent-customization/hooks';

export const PROMPT_LANGUAGE_ID = 'prompt';

export const INSTRUCTIONS_LANGUAGE_ID = 'instructions';

export const AGENT_LANGUAGE_ID = 'chatagent';

export const SKILL_LANGUAGE_ID = 'skill';

export const ALL_PROMPTS_LANGUAGE_SELECTOR: LanguageSelector = [PROMPT_LANGUAGE_ID, INSTRUCTIONS_LANGUAGE_ID, AGENT_LANGUAGE_ID, SKILL_LANGUAGE_ID];

export const AGENT_DEBUG_LOG_ENABLED_SETTING = 'github.copilot.chat.agentDebugLog.enabled';

export const AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING = 'github.copilot.chat.agentDebugLog.fileLogging.enabled';

export const AgentHostAgentDebugLogEnabledSettingId = 'chat.agentHost.agentDebugLog.enabled';

export const AgentHostAgentDebugLogMaxEventsSettingId = 'chat.agentHost.agentDebugLog.maxEventsInMemory';

export const TROUBLESHOOT_COMMAND_NAME = 'troubleshoot';

export const COPILOT_SKILL_URI_SCHEME = 'copilot-skill';

export const TROUBLESHOOT_SKILL_PATH = 'troubleshoot/SKILL.md';

export function getLanguageIdForPromptsType(type: PromptsType): string {
	switch (type) {
		case PromptsType.prompt:
			return PROMPT_LANGUAGE_ID;
		case PromptsType.instructions:
			return INSTRUCTIONS_LANGUAGE_ID;
		case PromptsType.agent:
			return AGENT_LANGUAGE_ID;
		case PromptsType.skill:
			return SKILL_LANGUAGE_ID;
		case PromptsType.hook:
			return 'jsonc';
		default:
			throw new Error(`Unknown prompt type: ${type}`);
	}
}

export function getPromptsTypeForLanguageId(languageId: string): PromptsType | undefined {
	switch (languageId) {
		case PROMPT_LANGUAGE_ID:
			return PromptsType.prompt;
		case INSTRUCTIONS_LANGUAGE_ID:
			return PromptsType.instructions;
		case AGENT_LANGUAGE_ID:
			return PromptsType.agent;
		case SKILL_LANGUAGE_ID:
			return PromptsType.skill;
		default:
			return undefined;
	}
}


export enum PromptsType {
	instructions = 'instructions',
	prompt = 'prompt',
	agent = 'agent',
	skill = 'skill',
	hook = 'hook'
}
export function isValidPromptType(type: string): type is PromptsType {
	return Object.values(PromptsType).includes(type as PromptsType);
}

export enum Target {
	VSCode = 'vscode',
	GitHubCopilot = 'github-copilot',
	Claude = 'claude',
	Undefined = 'undefined',
}

export enum PromptFileSource {
	GitHubWorkspace = 'github-workspace',
	CopilotPersonal = 'copilot-personal',
	ClaudePersonal = 'claude-personal',
	ClaudeWorkspace = 'claude-workspace',
	ClaudeWorkspaceLocal = 'claude-workspace-local',
	AgentsWorkspace = 'agents-workspace',
	AgentsPersonal = 'agents-personal',
	ConfigWorkspace = 'config-workspace',
	ConfigPersonal = 'config-personal',
	UserData = 'user-data',
	ExtensionContribution = 'extension-contribution',
	ExtensionAPI = 'extension-api',
	Plugin = 'plugin',
}

export function getSourceDescription(source: PromptFileSource): string | undefined {
	switch (source) {
		case PromptFileSource.AgentsWorkspace:
			return localize('source.agentsWorkspace', "Workspace");
		case PromptFileSource.AgentsPersonal:
			return localize('source.agentsPersonal', "Global");
		case PromptFileSource.GitHubWorkspace:
			return localize('source.githubWorkspace', "Workspace (only used by Dardcor agents)");
		case PromptFileSource.CopilotPersonal:
			return localize('source.copilotPersonal', "Global (only used by Dardcor agents)");
		case PromptFileSource.ClaudeWorkspace:
			return localize('source.claudeWorkspace', "Workspace (only used by Claude agents)");
		case PromptFileSource.ClaudeWorkspaceLocal:
			return localize('source.claudeWorkspaceLocal', "Workspace (only used by Claude agents, usually git-ignored)");
		case PromptFileSource.ClaudePersonal:
			return localize('source.claudePersonal', "Global (only used by Claude agents)");
		case PromptFileSource.UserData:
			return localize('source.userData', "Global (roams with Settings Sync, only used by Dardcor Code)");
		case PromptFileSource.ConfigWorkspace:
			return localize('source.configWorkspace', "Workspace (contributed from settings)");
		case PromptFileSource.ConfigPersonal:
			return localize('source.configPersonal', "Global (contributed from settings)");
		default:
			return undefined;
	}
}
