/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs/promises';

export interface IProjectRules {
	global: string[];
	contextual: Array<{ name: string; content: string }>;
	hierarchical: Array<{ dir: string; content: string }>;
}

export class ProjectRulesLoader {
	private static instance: ProjectRulesLoader | undefined;

	public static getInstance(): ProjectRulesLoader {
		if (!ProjectRulesLoader.instance) {
			ProjectRulesLoader.instance = new ProjectRulesLoader();
		}
		return ProjectRulesLoader.instance;
	}

	public async loadRules(workspaceRoot: string, targetFilePath?: string): Promise<IProjectRules> {
		const rules: IProjectRules = {
			global: [],
			contextual: [],
			hierarchical: [],
		};

		// 1. Scan root rule files
		const rootCandidates = [
			'.dardcorrules',
			'.cursorrules',
			'.windsurfrules',
			'DARDCOR.md',
			'AGENTS.md',
			path.join('.github', 'copilot-instructions.md'),
		];

		for (const cand of rootCandidates) {
			const fullPath = path.join(workspaceRoot, cand);
			try {
				const stat = await fs.stat(fullPath);
				if (stat.isFile()) {
					const content = await fs.readFile(fullPath, 'utf8');
					if (content.trim()) {
						rules.global.push(`### Rule File: ${cand}\n${content.trim()}`);
					}
				}
			} catch {
				// Ignore non-existent files
			}
		}

		// 2. Scan contextual rules folders: .dardcor/rules/ and .dc/rules/
		const ruleDirs = [
			path.join(workspaceRoot, '.dardcor', 'rules'),
			path.join(workspaceRoot, '.dc', 'rules'),
			path.join(workspaceRoot, '.cursor', 'rules'),
		];

		for (const dir of ruleDirs) {
			try {
				const stat = await fs.stat(dir);
				if (stat.isDirectory()) {
					const files = await fs.readdir(dir);
					for (const file of files) {
						if (file.endsWith('.md') || file.endsWith('.mdc') || file.endsWith('.rule') || file.endsWith('.txt')) {
							const filePath = path.join(dir, file);
							const content = await fs.readFile(filePath, 'utf8');
							if (content.trim()) {
								rules.contextual.push({
									name: `${path.basename(dir)}/${file}`,
									content: content.trim(),
								});
							}
						}
					}
				}
			} catch {
				// Ignore non-existent directories
			}
		}

		// 3. Hierarchical traversal from targetFilePath to workspaceRoot
		if (targetFilePath && path.isAbsolute(targetFilePath)) {
			let currentDir = path.dirname(targetFilePath);
			const normalizedRoot = path.normalize(workspaceRoot).toLowerCase();

			while (path.normalize(currentDir).toLowerCase().startsWith(normalizedRoot) && path.normalize(currentDir).toLowerCase() !== normalizedRoot) {
				const localRuleFile = path.join(currentDir, '.dardcorrules');
				try {
					const stat = await fs.stat(localRuleFile);
					if (stat.isFile()) {
						const content = await fs.readFile(localRuleFile, 'utf8');
						if (content.trim()) {
							const relDir = path.relative(workspaceRoot, currentDir);
							rules.hierarchical.unshift({
								dir: relDir || '.',
								content: content.trim(),
							});
						}
					}
				} catch {
					// Ignore
				}

				const parent = path.dirname(currentDir);
				if (parent === currentDir) {
					break;
				}
				currentDir = parent;
			}
		}

		return rules;
	}

	public compileToSystemPrompt(rules: IProjectRules): string {
		const sections: string[] = [];

		if (rules.global.length > 0) {
			sections.push(`## Global Project Guidelines\n${rules.global.join('\n\n---\n\n')}`);
		}

		if (rules.contextual.length > 0) {
			const contextFormatted = rules.contextual
				.map((c) => `### Contextual Rule: ${c.name}\n${c.content}`)
				.join('\n\n---\n\n');
			sections.push(`## Contextual Rules\n${contextFormatted}`);
		}

		if (rules.hierarchical.length > 0) {
			const hierFormatted = rules.hierarchical
				.map((h) => `### Subdirectory Rule (${h.dir})\n${h.content}`)
				.join('\n\n---\n\n');
			sections.push(`## Hierarchical Directory Rules\n${hierFormatted}`);
		}

		if (sections.length === 0) {
			return '';
		}

		return `<PROJECT_RULES>\n${sections.join('\n\n')}\n</PROJECT_RULES>`;
	}
}
