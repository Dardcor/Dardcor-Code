/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { registerSynthesizedBuiltinSkill } from '../promptSyntax/builtin/builtinSkills.js';

export interface IDardcorMemoryInsight {
	readonly id: string;
	readonly projectKey: string;
	readonly category: 'architecture' | 'convention' | 'framework' | 'testing' | 'gotcha' | 'preference';
	readonly title: string;
	readonly content: string;
	readonly tags: string[];
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface IDardcorEpisodicErrorLesson {
	readonly id: string;
	readonly projectKey: string;
	readonly errorPattern: string;
	readonly rootCause: string;
	readonly verifiedSolution: string;
	readonly commandOrTool?: string;
	readonly occurrences: number;
	readonly updatedAt: number;
}

export interface IDardcorSynthesizedSkillRecord {
	readonly name: string;
	readonly description: string;
	readonly content: string;
	readonly createdAt: number;
}

interface IDardcorBrainDiskPayload {
	readonly version: 1;
	readonly insights: IDardcorMemoryInsight[];
	readonly episodicLessons: IDardcorEpisodicErrorLesson[];
	readonly synthesizedSkills: IDardcorSynthesizedSkillRecord[];
}

const _memoryInsights = new Map<string, IDardcorMemoryInsight>();
const _episodicLessons = new Map<string, IDardcorEpisodicErrorLesson>();
const _synthesizedSkills = new Map<string, IDardcorSynthesizedSkillRecord>();
let _diskHydrated = false;

function normalizeProjectKey(workspaceRoot?: string): string {
	if (!workspaceRoot || !workspaceRoot.trim()) {
		return 'global';
	}
	return workspaceRoot.trim().replace(/\\/g, '/').toLowerCase();
}

async function resolveBrainStorageUri(pathService?: IPathService): Promise<URI | undefined> {
	try {
		if (!pathService) {
			return undefined;
		}
		const userHome = await pathService.userHome();
		return joinPath(userHome, '.dardcor', 'memory', 'brain', 'omega-memory-ledger.json');
	} catch {
		return undefined;
	}
}

export async function hydrateDardcorSelfImprovingMemory(
	fileService?: IFileService,
	pathService?: IPathService,
): Promise<void> {
	if (_diskHydrated || !fileService || !pathService) {
		return;
	}
	_diskHydrated = true;
	try {
		const ledgerUri = await resolveBrainStorageUri(pathService);
		if (!ledgerUri) {
			return;
		}
		const exists = await fileService.exists(ledgerUri);
		if (!exists) {
			return;
		}
		const raw = (await fileService.readFile(ledgerUri)).value.toString();
		const parsed = JSON.parse(raw) as Partial<IDardcorBrainDiskPayload>;
		if (Array.isArray(parsed.insights)) {
			for (const insight of parsed.insights) {
				if (insight && typeof insight.id === 'string' && typeof insight.title === 'string') {
					_memoryInsights.set(insight.id, insight);
				}
			}
		}
		if (Array.isArray(parsed.episodicLessons)) {
			for (const lesson of parsed.episodicLessons) {
				if (lesson && typeof lesson.id === 'string' && typeof lesson.errorPattern === 'string') {
					_episodicLessons.set(lesson.id, lesson);
				}
			}
		}
		if (Array.isArray(parsed.synthesizedSkills)) {
			for (const skill of parsed.synthesizedSkills) {
				if (skill && typeof skill.name === 'string' && typeof skill.content === 'string') {
					_synthesizedSkills.set(skill.name, skill);
					registerSynthesizedBuiltinSkill(skill.name, skill.description || 'Synthesized Dardcor Skill', skill.content);
				}
			}
		}
	} catch {
		// Ignore corrupted or inaccessible disk ledger; in-memory ledger remains active
	}
}

export async function persistDardcorSelfImprovingMemory(
	fileService?: IFileService,
	pathService?: IPathService,
): Promise<void> {
	if (!fileService || !pathService) {
		return;
	}
	try {
		const ledgerUri = await resolveBrainStorageUri(pathService);
		if (!ledgerUri) {
			return;
		}
		const payload: IDardcorBrainDiskPayload = {
			version: 1,
			insights: Array.from(_memoryInsights.values()).slice(-250),
			episodicLessons: Array.from(_episodicLessons.values()).slice(-200),
			synthesizedSkills: Array.from(_synthesizedSkills.values()).slice(-100),
		};
		await fileService.writeFile(ledgerUri, VSBuffer.fromString(JSON.stringify(payload, null, 2)));
	} catch {
		// Non-fatal background persistence
	}
}

export async function storeDardcorKnowledgeInsight(
	input: {
		workspaceRoot?: string;
		category?: IDardcorMemoryInsight['category'];
		title: string;
		content: string;
		tags?: string[];
	},
	fileService?: IFileService,
	pathService?: IPathService,
): Promise<IDardcorMemoryInsight> {
	await hydrateDardcorSelfImprovingMemory(fileService, pathService);
	const projectKey = normalizeProjectKey(input.workspaceRoot);
	const cleanTitle = input.title.trim();
	const id = `insight-${projectKey}-${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`;
	const now = Date.now();
	const existing = _memoryInsights.get(id);
	const record: IDardcorMemoryInsight = {
		id,
		projectKey,
		category: input.category ?? 'architecture',
		title: cleanTitle,
		content: input.content.trim(),
		tags: Array.isArray(input.tags) ? input.tags.map(t => String(t).trim()).filter(Boolean) : [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	_memoryInsights.set(id, record);
	await persistDardcorSelfImprovingMemory(fileService, pathService);
	return record;
}

export async function storeDardcorEpisodicErrorLesson(
	input: {
		workspaceRoot?: string;
		errorPattern: string;
		rootCause: string;
		verifiedSolution: string;
		commandOrTool?: string;
	},
	fileService?: IFileService,
	pathService?: IPathService,
): Promise<IDardcorEpisodicErrorLesson> {
	await hydrateDardcorSelfImprovingMemory(fileService, pathService);
	const projectKey = normalizeProjectKey(input.workspaceRoot);
	const cleanPattern = input.errorPattern.trim().slice(0, 240);
	const id = `lesson-${ cleanPattern.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 56) }`;
	const existing = _episodicLessons.get(id);
	const record: IDardcorEpisodicErrorLesson = {
		id,
		projectKey,
		errorPattern: cleanPattern,
		rootCause: input.rootCause.trim(),
		verifiedSolution: input.verifiedSolution.trim(),
		commandOrTool: input.commandOrTool?.trim(),
		occurrences: (existing?.occurrences ?? 0) + 1,
		updatedAt: Date.now(),
	};
	_episodicLessons.set(id, record);
	await persistDardcorSelfImprovingMemory(fileService, pathService);
	return record;
}

export function findMatchingEpisodicErrorLessons(
	errorOutput: string,
	workspaceRoot?: string,
): IDardcorEpisodicErrorLesson[] {
	if (!errorOutput || errorOutput.trim().length < 8) {
		return [];
	}
	const lowerError = errorOutput.toLowerCase();
	const projectKey = normalizeProjectKey(workspaceRoot);
	const matches: { lesson: IDardcorEpisodicErrorLesson; score: number }[] = [];

	for (const lesson of _episodicLessons.values()) {
		const patternLower = lesson.errorPattern.toLowerCase();
		let score = 0;
		if (lowerError.includes(patternLower)) {
			score += 10;
		} else {
			const tokens = patternLower.split(/[^a-z0-9_]+/).filter(t => t.length >= 4);
			if (tokens.length > 0) {
				const matchedTokens = tokens.filter(t => lowerError.includes(t));
				const ratio = matchedTokens.length / tokens.length;
				if (ratio >= 0.65) {
					score += Math.round(ratio * 8);
				}
			}
		}
		if (score > 0) {
			if (lesson.projectKey === projectKey || lesson.projectKey === 'global') {
				score += 3;
			}
			matches.push({ lesson, score });
		}
	}

	return matches
		.sort((a, b) => b.score - a.score || b.lesson.updatedAt - a.lesson.updatedAt)
		.slice(0, 3)
		.map(item => item.lesson);
}

export async function queryDardcorSelfImprovingMemory(
	query: string,
	workspaceRoot?: string,
	fileService?: IFileService,
	pathService?: IPathService,
): Promise<{
	insights: IDardcorMemoryInsight[];
	lessons: IDardcorEpisodicErrorLesson[];
	skills: IDardcorSynthesizedSkillRecord[];
}> {
	await hydrateDardcorSelfImprovingMemory(fileService, pathService);
	const projectKey = normalizeProjectKey(workspaceRoot);
	const q = (query || '').trim().toLowerCase();
	const tokens = q.split(/\s+/).filter(Boolean);

	const matchesQuery = (text: string): boolean => {
		if (!q) {
			return true;
		}
		const lower = text.toLowerCase();
		return lower.includes(q) || tokens.some(t => lower.includes(t));
	};

	const insights = Array.from(_memoryInsights.values())
		.filter(item => (item.projectKey === projectKey || item.projectKey === 'global' || !workspaceRoot) && matchesQuery(`${item.title} ${item.content} ${item.tags.join(' ')}`))
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, 15);

	const lessons = Array.from(_episodicLessons.values())
		.filter(item => matchesQuery(`${item.errorPattern} ${item.rootCause} ${item.verifiedSolution}`))
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, 15);

	const skills = Array.from(_synthesizedSkills.values())
		.filter(item => matchesQuery(`${item.name} ${item.description} ${item.content}`))
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, 15);

	return { insights, lessons, skills };
}

export async function synthesizeAndPersistDardcorSkill(
	input: {
		name: string;
		description: string;
		instructions: string;
		triggers?: string[];
	},
	fileService?: IFileService,
	pathService?: IPathService,
): Promise<IDardcorSynthesizedSkillRecord> {
	await hydrateDardcorSelfImprovingMemory(fileService, pathService);
	const cleanName = input.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-skill';
	const cleanDesc = input.description.trim() || `Autonomous synthesized skill: ${cleanName}`;
	const triggersBlock = Array.isArray(input.triggers) && input.triggers.length > 0
		? `\n**Recommended Triggers**: ${input.triggers.join(', ')}\n`
		: '';
	const markdownContent = [
		`---`,
		`name: ${cleanName}`,
		`description: ${cleanDesc}`,
		`---`,
		`# Synthesized Skill: /${cleanName}`,
		triggersBlock,
		input.instructions.trim(),
	].filter(Boolean).join('\n');

	const record: IDardcorSynthesizedSkillRecord = {
		name: cleanName,
		description: cleanDesc,
		content: markdownContent,
		createdAt: Date.now(),
	};
	_synthesizedSkills.set(cleanName, record);
	registerSynthesizedBuiltinSkill(cleanName, cleanDesc, markdownContent);

	if (fileService && pathService) {
		try {
			const userHome = await pathService.userHome();
			const skillFileUri = joinPath(userHome, '.dardcor', 'memory', 'skills', cleanName, 'SKILL.md');
			await fileService.writeFile(skillFileUri, VSBuffer.fromString(markdownContent));
		} catch {
			// Ignore disk write failure
		}
	}
	await persistDardcorSelfImprovingMemory(fileService, pathService);
	return record;
}

export function getDardcorMemoryPromptContext(workspaceRoot?: string): string {
	const projectKey = normalizeProjectKey(workspaceRoot);
	const projectInsights = Array.from(_memoryInsights.values())
		.filter(i => i.projectKey === projectKey || i.projectKey === 'global')
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, 6);
	const recentLessons = Array.from(_episodicLessons.values())
		.filter(l => l.projectKey === projectKey || l.projectKey === 'global')
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, 4);

	if (projectInsights.length === 0 && recentLessons.length === 0) {
		return '';
	}

	const sections: string[] = ['### PERSISTENT SELF-IMPROVING MEMORY LEDGER (ACTIVE PROJECT BRAIN)'];
	if (projectInsights.length > 0) {
		sections.push('**Learned Project Architecture & Conventions**:');
		for (const item of projectInsights) {
			sections.push(`- **[${item.category.toUpperCase()}] ${item.title}**: ${item.content}`);
		}
	}
	if (recentLessons.length > 0) {
		sections.push('**Episodic Error-Resolution Lessons (Avoid Repeating Past Mistakes)**:');
		for (const lesson of recentLessons) {
			sections.push(`- **Pattern**: \`${lesson.errorPattern}\` -> **Fix**: ${lesson.verifiedSolution}`);
		}
	}
	return sections.join('\n');
}
