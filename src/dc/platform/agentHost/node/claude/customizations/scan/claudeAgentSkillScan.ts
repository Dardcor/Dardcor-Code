/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { dirname } from '../../../../../../base/common/resources.js';
import { IFileService } from '../../../../../files/common/files.js';
import { detectPluginFormat, readAgentComponents, readSkills, toParsedAgent, toParsedSkill, type INamedPluginResource, type IParsedAgent, type IParsedSkill } from '../../../../../agentPlugins/common/pluginParsers.js';
import { CustomizationType } from '../../../../common/state/protocol/channels-session/state.js';

function scopeRoots(scope: URI): { readonly agents: URI; readonly skills: URI; readonly commands: URI } {
	const base = URI.joinPath(scope, '.claude');
	return {
		agents: URI.joinPath(base, 'agents'),
		skills: URI.joinPath(base, 'skills'),
		commands: URI.joinPath(base, 'commands'),
	};
}

function collectByName<T extends INamedPluginResource>(into: Map<string, T>, items: readonly T[]): void {
	for (const item of items) {
		if (!into.has(item.name)) {
			into.set(item.name, item);
		}
	}
}

async function excludeNativePluginSkills<T extends INamedPluginResource>(skills: readonly T[], fileService: IFileService): Promise<T[]> {
	const isPluginDir = await Promise.all(skills.map(async skill => {
		const dir = dirname(skill.uri);
		const format = await detectPluginFormat(dir, fileService);
		return fileService.exists(URI.joinPath(dir, format.manifestPath));
	}));
	return skills.filter((_, i) => !isPluginDir[i]);
}

export async function scanClaudeCustomizationScope(
	scope: URI,
	fileService: IFileService,
	includeCommands: boolean = true,
): Promise<readonly (IParsedAgent | IParsedSkill)[]> {
	const { agents: agentsDir, skills: skillsDir, commands: commandsDir } = scopeRoots(scope);
	const [agentResources, skillResources, commandResources] = await Promise.all([
		readAgentComponents([agentsDir], fileService),
		readSkills(skillsDir, [skillsDir], fileService),
		includeCommands ? readAgentComponents([commandsDir], fileService) : [],
	]);
	const agents = new Map<string, IParsedAgent>();
	const skills = new Map<string, IParsedSkill>();
	collectByName(agents, agentResources.map(toParsedAgent));
	const standaloneSkills = await excludeNativePluginSkills(skillResources, fileService);
	collectByName(skills, standaloneSkills.map(toParsedSkill));
	collectByName(skills, commandResources.map(toParsedSkill));
	return [...agents.values(), ...skills.values()];
}

export async function scanClaudeDiskCustomizations(
	workingDirectory: URI | undefined,
	userHome: URI,
	fileService: IFileService,
): Promise<readonly (IParsedAgent | IParsedSkill)[]> {
	const scopes = workingDirectory ? [workingDirectory, userHome] : [userHome];
	const agents = new Map<string, IParsedAgent>();
	const skills = new Map<string, IParsedSkill>();

	for (const scope of scopes) {
		const discovered = await scanClaudeCustomizationScope(scope, fileService);
		collectByName(agents, discovered.filter((item): item is IParsedAgent => item.customization.type === CustomizationType.Agent));
		collectByName(skills, discovered.filter((item): item is IParsedSkill => item.customization.type === CustomizationType.Skill));
	}

	return [...agents.values(), ...skills.values()];
}
