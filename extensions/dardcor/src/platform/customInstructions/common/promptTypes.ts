/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum PromptsType {
	instructions = 'instructions',
	prompt = 'prompt',
	agent = 'agent',
	skill = 'skill'
}

export const INSTRUCTIONS_LOCATION_KEY = 'chat.instructionsFilesLocations';
export const SKILLS_LOCATION_KEY = 'chat.agentSkillsLocations';

export const WORKSPACE_SKILL_FOLDERS = ['.github/skills', '.claude/skills'];
export const PERSONAL_SKILL_FOLDERS = ['.dardcor/skills', '.claude/skills'];
export const USE_AGENT_SKILLS_SETTING = 'chat.useAgentSkills';
export const USE_SKILL_ADHERENCE_PROMPT_SETTING = 'chat.experimental.useSkillAdherencePrompt';

export const COPILOT_INSTRUCTIONS_PATH = '.github/dardcor-instructions.md';
export const COPILOT_PERSONAL_INSTRUCTIONS_PATH = '.dardcor/dardcor-instructions.md';

export const PROMPT_FILE_EXTENSION = '.prompt.md';

export const INSTRUCTION_FILE_EXTENSION = '.instructions.md';

export const AGENT_FILE_EXTENSION = '.agent.md';

export const SKILL_FILENAME = 'SKILL.md';
