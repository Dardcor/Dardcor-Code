/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface IUniversalRulesParams {
	action: 'discoverRules' | 'loadRules' | 'toggleRule';
	rulePath?: string;
	enabled?: boolean;
}

export interface IRuleEntry {
	name: string;
	path: string;
	type: 'cursor' | 'windsurf' | 'dardcor' | 'agent' | 'copilot' | 'generic';
	enabled: boolean;
	contentSnippet: string;
}

export class UniversalRulesIngestorTool implements ICopilotTool<IUniversalRulesParams> {
	public static readonly toolName = ToolName.UniversalRulesIngestor;

	private static disabledRules = new Set<string>();

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IUniversalRulesParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { action, rulePath, enabled } = options.input;
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		if (workspaceFolders.length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('No workspace folder open to inspect rules.')
			]);
		}

		const rootPath = workspaceFolders[0].uri.fsPath;

		switch (action) {
			case 'discoverRules': {
				const rules = await this.scanRules(rootPath);
				if (rules.length === 0) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart('No external or custom rule files (.cursorrules, .windsurfrules, .dardcorrules, .agents/rules, .github/copilot-instructions.md) found in this workspace.')
					]);
				}

				const formatted = rules.map(r => {
					const status = r.enabled ? 'ENABLED' : 'DISABLED';
					return `- **${r.name}** [${r.type.toUpperCase()}] (${status})\n  Path: \`${r.path}\`\n  Preview: "${r.contentSnippet}..."`;
				}).join('\n\n');

				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Discovered Project Rules (${rules.length})\n\n${formatted}`)
				]);
			}

			case 'loadRules': {
				const rules = await this.scanRules(rootPath);
				const activeRules = rules.filter(r => r.enabled);
				if (activeRules.length === 0) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart('No active project rules to inject.')
					]);
				}

				const combined = await Promise.all(activeRules.map(async (r) => {
					try {
						const fullContent = await fs.readFile(r.path, 'utf8');
						return `#### Rule: ${r.name} (${r.type})\n${fullContent}`;
					} catch {
						return '';
					}
				}));

				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Ingested Active Workspace Rules\n\n${combined.filter(Boolean).join('\n\n---\n\n')}`)
				]);
			}

			case 'toggleRule': {
				if (!rulePath) throw new Error('rulePath is required for action: toggleRule');
				if (enabled === false) {
					UniversalRulesIngestorTool.disabledRules.add(rulePath);
				} else {
					UniversalRulesIngestorTool.disabledRules.delete(rulePath);
				}
				const state = UniversalRulesIngestorTool.disabledRules.has(rulePath) ? 'DISABLED' : 'ENABLED';
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Rule \`${rulePath}\` is now ${state}.`)
				]);
			}

			default:
				throw new Error(`Unsupported action: ${action}`);
		}
	}

	private async scanRules(root: string): Promise<IRuleEntry[]> {
		const entries: IRuleEntry[] = [];

		const checkFile = async (fileName: string, type: IRuleEntry['type']) => {
			const full = path.join(root, fileName);
			try {
				const stat = await fs.stat(full);
				if (stat.isFile()) {
					const raw = await fs.readFile(full, 'utf8');
					entries.push({
						name: fileName,
						path: full,
						type,
						enabled: !UniversalRulesIngestorTool.disabledRules.has(full),
						contentSnippet: raw.substring(0, 120).replace(/[\r\n]+/g, ' ')
					});
				}
			} catch { }
		};

		await checkFile('.cursorrules', 'cursor');
		await checkFile('.windsurfrules', 'windsurf');
		await checkFile('.dardcorrules', 'dardcor');
		await checkFile('DARDCOR.md', 'dardcor');
		await checkFile('AGENTS.md', 'agent');
		await checkFile('.github/copilot-instructions.md', 'copilot');

		try {
			const cursorRulesDir = path.join(root, '.cursor', 'rules');
			const files = await fs.readdir(cursorRulesDir);
			for (const f of files) {
				if (f.endsWith('.md') || f.endsWith('.mdc') || f.endsWith('.txt')) {
					const fullPath = path.join(cursorRulesDir, f);
					const raw = await fs.readFile(fullPath, 'utf8');
					entries.push({
						name: `.cursor/rules/${f}`,
						path: fullPath,
						type: 'cursor',
						enabled: !UniversalRulesIngestorTool.disabledRules.has(fullPath),
						contentSnippet: raw.substring(0, 120).replace(/[\r\n]+/g, ' ')
					});
				}
			}
		} catch { }

		return entries;
	}
}

ToolRegistry.registerTool(UniversalRulesIngestorTool);
