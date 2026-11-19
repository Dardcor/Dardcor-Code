/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { Schemas } from '../../../../base/common/network.js';
import { isAbsolute, normalize } from '../../../../base/common/path.js';
import { basename, extUriBiasedIgnorePathCase } from '../../../../base/common/resources.js';
import { compare } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { CustomizationLoadStatus, CustomizationType, customizationId, type DirectoryCustomization, type HookCustomization, type RuleCustomization, type SkillCustomization } from '../../common/state/sessionState.js';
import { readAgentComponents, readSkills, toParsedAgent, toParsedSkill, type IParsedAgent } from '../../../agentPlugins/common/pluginParsers.js';
import type { IFileService } from '../../../files/common/files.js';
import type { HookMetadata } from './protocol/generated/v2/HookMetadata.js';
import type { HooksListResponse } from './protocol/generated/v2/HooksListResponse.js';
import type { SelectedCapabilityRoot } from './protocol/generated/v2/SelectedCapabilityRoot.js';
import type { SkillMetadata } from './protocol/generated/v2/SkillMetadata.js';
import type { SkillScope } from './protocol/generated/v2/SkillScope.js';
import type { SkillsListResponse } from './protocol/generated/v2/SkillsListResponse.js';


const CODEX_SKILLS_SCHEME = 'codex-skills';
const CODEX_HOOKS_SCHEME = 'codex-hooks';

export interface ICodexWorkspaceAgentDiscovery {
	readonly agents: readonly IParsedAgent[];
	readonly containers: readonly DirectoryCustomization[];
}

export async function discoverCodexWorkspaceAgents(
	workingDirectories: readonly URI[],
	fileService: IFileService,
): Promise<ICodexWorkspaceAgentDiscovery> {
	const agents: IParsedAgent[] = [];
	const containers: DirectoryCustomization[] = [];
	const seenDirectories = new Set<string>();
	const seenNames = new Set<string>();

	for (const workingDirectory of workingDirectories) {
		const directory = URI.joinPath(workingDirectory, '.github', 'agents');
		const directoryKey = extUriBiasedIgnorePathCase.getComparisonKey(directory);
		if (seenDirectories.has(directoryKey)) {
			continue;
		}
		seenDirectories.add(directoryKey);

		let candidateFiles: readonly URI[];
		try {
			const stat = await fileService.resolve(directory);
			candidateFiles = stat.children
				?.filter(child => {
					const filename = basename(child.resource);
					return child.isFile && filename.endsWith('.md') && filename !== 'README.md';
				})
				.map(child => child.resource) ?? [];
		} catch {
			continue;
		}

		const children: IParsedAgent[] = [];
		for (const resource of await readAgentComponents(candidateFiles, fileService)) {
			if (seenNames.has(resource.name)) {
				continue;
			}
			seenNames.add(resource.name);
			const agent = toParsedAgent(resource);
			agents.push(agent);
			children.push(agent);
		}

		if (children.length === 0) {
			continue;
		}
		const uri = directory.toString();
		containers.push({
			type: CustomizationType.Directory,
			id: customizationId(uri),
			uri,
			name: '.github',
			enabled: true,
			contents: CustomizationType.Agent,
			writable: true,
			load: { kind: CustomizationLoadStatus.Loaded },
			children: children.map(agent => agent.customization),
		});
	}

	return { agents, containers };
}

export async function discoverCodexWorkspaceSkills(
	workingDirectories: readonly URI[],
	fileService: IFileService,
): Promise<readonly DirectoryCustomization[]> {
	const containers: DirectoryCustomization[] = [];
	const seenDirectories = new Set<string>();
	const seenNames = new Set<string>();
	for (const workingDirectory of workingDirectories) {
		const directory = URI.joinPath(workingDirectory, '.github', 'skills');
		const directoryKey = extUriBiasedIgnorePathCase.getComparisonKey(directory);
		if (seenDirectories.has(directoryKey)) {
			continue;
		}
		seenDirectories.add(directoryKey);
		const skills = [...await readSkills(workingDirectory, [directory], fileService, { childDirectoriesOnly: true, deduplicateByName: false })]
			.sort((left, right) => left.name.localeCompare(right.name) || compare(left.uri.toString(), right.uri.toString()))
			.filter(skill => {
				if (seenNames.has(skill.name)) {
					return false;
				}
				seenNames.add(skill.name);
				return true;
			});
		if (skills.length === 0) {
			continue;
		}
		const uri = directory.toString();
		containers.push({
			type: CustomizationType.Directory,
			id: customizationId(uri),
			uri,
			name: '.github',
			enabled: true,
			contents: CustomizationType.Skill,
			writable: true,
			load: { kind: CustomizationLoadStatus.Loaded },
			children: skills.map(skill => toParsedSkill(skill).customization),
		});
	}
	return containers;
}

export function excludeCodexWorkspaceSkillDuplicates(
	nativeContainers: readonly DirectoryCustomization[],
	workspaceSkills: readonly DirectoryCustomization[],
): DirectoryCustomization[] {
	const workspaceSkillIds = new Set(workspaceSkills.flatMap(container => container.children?.map(child => child.id) ?? []));
	return nativeContainers.flatMap(container => {
		if (container.contents !== CustomizationType.Skill) {
			return [container];
		}
		const children = container.children?.filter(child => !workspaceSkillIds.has(child.id));
		if (!children || children.length === container.children?.length) {
			return [container];
		}
		return children.length > 0 ? [{ ...container, children }] : [];
	});
}

export async function discoverCodexWorkspaceInstructions(
	workingDirectories: readonly URI[],
	fileService: IFileService,
): Promise<readonly DirectoryCustomization[]> {
	const containers: DirectoryCustomization[] = [];
	const seenDirectories = new Set<string>();
	for (const workingDirectory of workingDirectories) {
		const directoryKey = extUriBiasedIgnorePathCase.getComparisonKey(workingDirectory);
		if (seenDirectories.has(directoryKey)) {
			continue;
		}
		seenDirectories.add(directoryKey);
		const resource = URI.joinPath(workingDirectory, 'AGENTS.md');
		try {
			if (!(await fileService.stat(resource)).isFile) {
				continue;
			}
		} catch {
			continue;
		}
		const ruleUri = resource.toString();
		const rule: RuleCustomization = {
			type: CustomizationType.Rule,
			id: customizationId(ruleUri),
			uri: ruleUri,
			name: 'AGENTS.md',
			alwaysApply: true,
		};
		const directoryUri = workingDirectory.toString();
		containers.push({
			type: CustomizationType.Directory,
			id: customizationId(directoryUri),
			uri: directoryUri,
			name: basename(workingDirectory),
			enabled: true,
			contents: CustomizationType.Rule,
			writable: false,
			load: { kind: CustomizationLoadStatus.Loaded },
			children: [rule],
		});
	}
	return containers;
}

function localFileComparisonKey(resource: URI): { readonly key: string; readonly resource: URI } | undefined {
	if (resource.scheme !== Schemas.file || !resource.path.startsWith('/') || !isAbsolute(resource.fsPath)) {
		return undefined;
	}
	const normalized = extUriBiasedIgnorePathCase.removeTrailingPathSeparator(URI.file(normalize(resource.fsPath)));
	return {
		key: extUriBiasedIgnorePathCase.getComparisonKey(normalized),
		resource: normalized,
	};
}

function capabilityRootId(comparisonKey: string): string {
	const digest = createHash('sha256')
		.update('codex-selected-capability-root-v1\0')
		.update(comparisonKey)
		.digest('hex');
	return `codex-selected-capability-root-v1-${digest}`;
}

export function codexSelectedCapabilityRootCandidates(workingDirectories: readonly URI[]): SelectedCapabilityRoot[] {
	const primaryKey = workingDirectories.length > 0 ? localFileComparisonKey(workingDirectories[0])?.key : undefined;
	const seenRoots = new Set<string>();
	const seenCandidates = new Set<string>();
	const result: SelectedCapabilityRoot[] = [];

	for (const workingDirectory of workingDirectories.slice(1)) {
		const root = localFileComparisonKey(workingDirectory);
		if (!root || root.key === primaryKey || seenRoots.has(root.key)) {
			continue;
		}
		seenRoots.add(root.key);

		for (const segments of [['.agents', 'skills'], ['.codex', 'skills']] as const) {
			const candidate = localFileComparisonKey(URI.joinPath(root.resource, ...segments));
			if (!candidate || seenCandidates.has(candidate.key)) {
				continue;
			}
			seenCandidates.add(candidate.key);
			result.push({
				id: capabilityRootId(candidate.key),
				location: {
					type: 'environment',
					environmentId: 'local',
					path: candidate.resource.fsPath,
				},
			});
		}
	}

	return result;
}

function skillScopeContainerName(scope: SkillScope): string {
	switch (scope) {
		case 'repo': return 'Repository';
		case 'user': return 'User';
		case 'system': return 'Built-in';
		case 'admin': return 'Admin';
		default: return scope;
	}
}

const SKILL_SCOPE_ORDER: readonly SkillScope[] = ['repo', 'user', 'system', 'admin'];

function skillToCustomization(skill: SkillMetadata): SkillCustomization {
	const uri = URI.file(skill.path).toString();
	return {
		type: CustomizationType.Skill,
		id: customizationId(uri),
		uri,
		name: skill.name,
		description: skill.description,
		enabled: skill.enabled,
	};
}

export function codexSkillsToContainers(response: SkillsListResponse | undefined): DirectoryCustomization[] {
	const byScope = new Map<SkillScope, Map<string, SkillMetadata>>();
	for (const entry of response?.data ?? []) {
		for (const skill of entry.skills ?? []) {
			let scoped = byScope.get(skill.scope);
			if (!scoped) {
				scoped = new Map();
				byScope.set(skill.scope, scoped);
			}
			if (!scoped.has(skill.path)) {
				scoped.set(skill.path, skill);
			}
		}
	}
	const containers: DirectoryCustomization[] = [];
	for (const scope of SKILL_SCOPE_ORDER) {
		const scoped = byScope.get(scope);
		if (!scoped || scoped.size === 0) {
			continue;
		}
		const children = [...scoped.values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(skillToCustomization);
		const containerUri = URI.from({ scheme: CODEX_SKILLS_SCHEME, path: `/${scope}` }).toString();
		containers.push({
			type: CustomizationType.Directory,
			id: customizationId(containerUri),
			uri: containerUri,
			name: skillScopeContainerName(scope),
			enabled: true,
			contents: CustomizationType.Skill,
			writable: false,
			load: { kind: CustomizationLoadStatus.Loaded },
			children,
		});
	}
	return containers;
}

function hookToCustomization(hook: HookMetadata): HookCustomization {
	const uri = URI.file(hook.sourcePath).with({ fragment: hook.key }).toString();
	return {
		type: CustomizationType.Hook,
		id: customizationId(uri),
		uri,
		name: hook.eventName,
		enabled: hook.enabled,
	};
}

export function codexHooksToContainers(response: HooksListResponse | undefined): DirectoryCustomization[] {
	const byKey = new Map<string, HookMetadata>();
	for (const entry of response?.data ?? []) {
		for (const hook of entry.hooks ?? []) {
			if (!byKey.has(hook.key)) {
				byKey.set(hook.key, hook);
			}
		}
	}
	if (byKey.size === 0) {
		return [];
	}
	const children = [...byKey.values()]
		.sort((a, b) => Number(a.displayOrder - b.displayOrder) || a.key.localeCompare(b.key))
		.map(hookToCustomization);
	const containerUri = URI.from({ scheme: CODEX_HOOKS_SCHEME, path: '/hooks' }).toString();
	return [{
		type: CustomizationType.Directory,
		id: customizationId(containerUri),
		uri: containerUri,
		name: 'Hooks',
		enabled: true,
		contents: CustomizationType.Hook,
		writable: false,
		load: { kind: CustomizationLoadStatus.Loaded },
		children,
	}];
}
