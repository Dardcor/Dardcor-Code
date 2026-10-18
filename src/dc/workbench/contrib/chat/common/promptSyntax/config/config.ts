/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { URI } from '../../../../../../base/common/uri.js';
import { PromptFileSource, PromptsType } from '../promptTypes.js';
import { getPromptFileDefaultLocations, IPromptSourceFolder } from './promptFileLocations.js';
import { PromptsStorage } from '../service/promptsService.js';

export namespace PromptsConfig {
	export const PROMPT_LOCATIONS_KEY = 'chat.promptFilesLocations';

	export const INSTRUCTIONS_LOCATION_KEY = 'chat.instructionsFilesLocations';
	export const MODE_LOCATION_KEY = 'chat.modeFilesLocations';

	export const AGENTS_LOCATION_KEY = 'chat.agentFilesLocations';

	export const SKILLS_LOCATION_KEY = 'chat.agentSkillsLocations';

	export const HOOKS_LOCATION_KEY = 'chat.hookFilesLocations';

	export const PROMPT_FILES_SUGGEST_KEY = 'chat.promptFilesRecommendations';

	export const USE_COPILOT_INSTRUCTION_FILES = 'github.copilot.chat.codeGeneration.useInstructionFiles';

	export const USE_AGENT_MD = 'chat.useAgentsMdFile';

	export const USE_NESTED_AGENT_MD = 'chat.useNestedAgentsMdFiles';

	export const USE_CLAUDE_MD = 'chat.useClaudeMdFile';

	export const USE_AGENT_SKILLS = 'chat.useAgentSkills';

	export const USE_CHAT_HOOKS = 'chat.useHooks';

	export const USE_CLAUDE_HOOKS = 'chat.useClaudeHooks';

	export const USE_SKILL_ADHERENCE_PROMPT = 'chat.experimental.useSkillAdherencePrompt';

	export const INCLUDE_APPLYING_INSTRUCTIONS = 'chat.includeApplyingInstructions';

	export const INCLUDE_REFERENCED_INSTRUCTIONS = 'chat.includeReferencedInstructions';

	export const USE_CUSTOMIZATIONS_IN_PARENT_REPOS = 'chat.useCustomizationsInParentRepositories';

	export function getLocationsValue(configService: IConfigurationService, type: PromptsType): Record<string, boolean> | undefined {
		const key = getPromptFileLocationsConfigKey(type);
		const configValue = configService.getValue(key);

		if (configValue === undefined || configValue === null || Array.isArray(configValue)) {
			return undefined;
		}

		if (typeof configValue === 'object') {
			const paths: Record<string, boolean> = {};

			for (const [path, value] of Object.entries(configValue)) {
				const cleanPath = path.trim();
				const booleanValue = asBoolean(value);

				if ((booleanValue !== undefined) && cleanPath) {
					paths[cleanPath] = booleanValue;
				}
			}

			return paths;
		}

		return undefined;
	}

	export function promptSourceFolders(configService: IConfigurationService, type: PromptsType): IPromptSourceFolder[] {
		const value = getLocationsValue(configService, type);
		const defaultSourceFolders = getPromptFileDefaultLocations(type);

		if (value && (typeof value === 'object')) {
			const paths: IPromptSourceFolder[] = [];
			const defaultFolderPathsSet = new Set(defaultSourceFolders.map(f => f.path));

			for (const defaultFolder of defaultSourceFolders) {
				if (value[defaultFolder.path] !== false) {
					paths.push(defaultFolder);
				}
			}

			for (const [path, enabledValue] of Object.entries(value)) {
				if ((enabledValue === false) || defaultFolderPathsSet.has(path)) {
					continue;
				}

				const storage = isTildePath(path) ? PromptsStorage.user : PromptsStorage.local;
				paths.push({ path, source: storage === PromptsStorage.local ? PromptFileSource.ConfigWorkspace : PromptFileSource.ConfigPersonal, storage });
			}

			return paths;
		}

		return [];
	}

	export function getPromptFilesRecommendationsValue(configService: IConfigurationService, resource?: URI): Record<string, boolean | string> | undefined {
		const configValue = configService.getValue(PromptsConfig.PROMPT_FILES_SUGGEST_KEY, { resource });

		if (!configValue || typeof configValue !== 'object' || Array.isArray(configValue)) {
			return undefined;
		}

		const suggestions: Record<string, boolean | string> = {};

		for (const [promptName, value] of Object.entries(configValue)) {
			const cleanPromptName = promptName.trim();

			if (!cleanPromptName) {
				continue;
			}

			if (typeof value === 'boolean') {
				suggestions[cleanPromptName] = value;
				continue;
			}

			if (typeof value === 'string') {
				const cleanValue = value.trim();
				if (cleanValue) {
					suggestions[cleanPromptName] = cleanValue;
				}
				continue;
			}

			const booleanValue = asBoolean(value);
			if (booleanValue !== undefined) {
				suggestions[cleanPromptName] = booleanValue;
			}
		}

		return Object.keys(suggestions).length > 0 ? suggestions : undefined;
	}

}

export function getPromptFileLocationsConfigKey(type: PromptsType): string {
	switch (type) {
		case PromptsType.instructions:
			return PromptsConfig.INSTRUCTIONS_LOCATION_KEY;
		case PromptsType.prompt:
			return PromptsConfig.PROMPT_LOCATIONS_KEY;
		case PromptsType.agent:
			return PromptsConfig.AGENTS_LOCATION_KEY;
		case PromptsType.skill:
			return PromptsConfig.SKILLS_LOCATION_KEY;
		case PromptsType.hook:
			return PromptsConfig.HOOKS_LOCATION_KEY;
		default:
			throw new Error('Unknown prompt type');
	}
}

export function asBoolean(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string') {
		const cleanValue = value.trim().toLowerCase();
		if (cleanValue === 'true') {
			return true;
		}

		if (cleanValue === 'false') {
			return false;
		}

		return undefined;
	}

	return undefined;
}

export function isTildePath(path: string): boolean {
	return path.startsWith('~/');
}
