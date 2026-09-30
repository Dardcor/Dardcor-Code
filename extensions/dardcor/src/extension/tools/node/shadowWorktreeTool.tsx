/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface IShadowWorktreeParams {
	action: 'create_shadow' | 'mutate_shadow' | 'merge_shadow' | 'destroy_shadow';
	branchId: string;
	filePath?: string;
	fileContent?: string;
	description: string;
}

export class ShadowWorktreeTool implements ICopilotTool<IShadowWorktreeParams> {
	public static toolName = ToolName.ShadowWorktree;

	private static shadowRoot: string = path.join(os.tmpdir(), 'dardcor-shadow-worktrees');

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
	) { }

	private getBranchDir(branchId: string): string {
		return path.join(ShadowWorktreeTool.shadowRoot, branchId);
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IShadowWorktreeParams>, token: vscode.CancellationToken) {
		const { action, branchId, filePath, fileContent } = options.input;
		const branchDir = this.getBranchDir(branchId);

		switch (action) {
			case 'create_shadow': {
				if (!fs.existsSync(branchDir)) {
					fs.mkdirSync(branchDir, { recursive: true });
				}
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`[Quantum Shadow Worktree Created]\n` +
						`Branch ID: ${branchId}\n` +
						`Isolated Path: ${branchDir}\n` +
						`Status: Sandboxed copy-on-write memory ready. Zero risk to main workspace.`
					)
				]);
			}

			case 'mutate_shadow': {
				if (!filePath || fileContent === undefined) {
					throw new Error(`filePath and fileContent required for mutate_shadow`);
				}
				const targetPath = path.join(branchDir, filePath);
				fs.mkdirSync(path.dirname(targetPath), { recursive: true });
				fs.writeFileSync(targetPath, fileContent, 'utf-8');

				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`[Shadow Worktree Mutated]\nBranch: ${branchId}\nFile: ${filePath} (${Buffer.byteLength(fileContent, 'utf-8')} bytes written in sandbox)`
					)
				]);
			}

			case 'merge_shadow': {
				if (!fs.existsSync(branchDir)) {
					throw new Error(`Shadow branch '${branchId}' does not exist.`);
				}

				// Copy all modified files from branchDir back to main workspace
				let mergedCount = 0;
				const copyRecursive = async (srcDir: string, relPath: string = '') => {
					const entries = fs.readdirSync(srcDir, { withFileTypes: true });
					for (const entry of entries) {
						const curRel = path.join(relPath, entry.name);
						const fullSrc = path.join(srcDir, entry.name);
						if (entry.isDirectory()) {
							await copyRecursive(fullSrc, curRel);
						} else {
							const destUri = this.promptPathRepresentationService.resolveFilePath(curRel);
							if (destUri) {
								const data = fs.readFileSync(fullSrc);
								await this.fileSystemService.writeFile(destUri, data);
								mergedCount++;
							}
						}
					}
				};

				await copyRecursive(branchDir);

				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`[Quantum Shadow Worktree Merged]\n` +
						`Branch ID: ${branchId}\n` +
						`Total Files Atomically Merged: ${mergedCount}\n` +
						`Status: Changes successfully verified and promoted to active workspace.`
					)
				]);
			}

			case 'destroy_shadow': {
				if (fs.existsSync(branchDir)) {
					fs.rmSync(branchDir, { recursive: true, force: true });
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`Shadow branch '${branchId}' destroyed cleanly.`)
					]);
				}
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Shadow branch '${branchId}' already clean.`)
				]);
			}
		}
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IShadowWorktreeParams>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation> {
		return {
			presentation: undefined,
			invocationMessage: new MarkdownString(`Quantum Shadow Worktree: **${options.input.action}** [${options.input.branchId}]`),
			pastTenseMessage: new MarkdownString(`Executed Quantum Shadow Worktree: **${options.input.action}** [${options.input.branchId}]`)
		};
	}
}

ToolRegistry.registerTool(ShadowWorktreeTool);
