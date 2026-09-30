/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

const execAsync = promisify(exec);

export interface IShadowSnapshotParams {
	action: 'createCheckpoint' | 'restoreCheckpoint' | 'listCheckpoints' | 'diffCheckpoint' | 'getLatestCheckpoint';
	checkpointId?: string;
	description?: string;
}

export class ShadowSnapshotCheckpointTool implements ICopilotTool<IShadowSnapshotParams> {
	public static readonly toolName = ToolName.ShadowSnapshotCheckpoint;

	private getShadowGitDir(workspaceRoot: string): string {
		const hash = crypto.createHash('sha256').update(workspaceRoot).digest('hex').substring(0, 16);
		return path.join(os.homedir(), '.dardcor', 'shadow_snapshots', hash);
	}

	private async runShadowGit(gitDir: string, workTree: string, cmd: string): Promise<{ stdout: string; stderr: string }> {
		const gitCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" ${cmd}`;
		return await execAsync(gitCmd, { maxBuffer: 10 * 1024 * 1024 });
	}

	private async ensureShadowGitInitialized(gitDir: string, workTree: string): Promise<void> {
		try {
			await fs.mkdir(gitDir, { recursive: true });
			await fs.access(path.join(gitDir, 'HEAD'));
		} catch {
			await execAsync(`git init --bare "${gitDir}"`);
			await this.runShadowGit(gitDir, workTree, 'config core.autocrlf false');
			await this.runShadowGit(gitDir, workTree, 'config core.longpaths true');
			await this.runShadowGit(gitDir, workTree, 'config user.name "Dardcor Assistant"');
			await this.runShadowGit(gitDir, workTree, 'config user.email "assistant@dardcor.local"');
		}
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IShadowSnapshotParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { action, checkpointId, description = 'Automatic checkpoint' } = options.input;
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const shadowGitDir = this.getShadowGitDir(workspaceRoot);

		await this.ensureShadowGitInitialized(shadowGitDir, workspaceRoot);

		switch (action) {
			case 'createCheckpoint': {
				try {
					await this.runShadowGit(shadowGitDir, workspaceRoot, 'add -A');
					const commitMsg = `checkpoint: ${description.replace(/"/g, '\\"')}`;
					await this.runShadowGit(shadowGitDir, workspaceRoot, `commit -m "${commitMsg}" --allow-empty`);
					const { stdout } = await this.runShadowGit(shadowGitDir, workspaceRoot, 'rev-parse HEAD');
					const hash = stdout.trim();

					return new LanguageModelToolResult([
						new LanguageModelTextPart(`### Shadow Checkpoint Created\n- Checkpoint Hash: \`${hash}\`\n- Description: "${description}"\n- Timestamp: ${new Date().toISOString()}\n\nNote: Isolated in Dardcor shadow storage; does not alter public repository history.`)
					]);
				} catch (err: any) {
					throw new Error(`Failed to create shadow checkpoint: ${err.message}`);
				}
			}

			case 'restoreCheckpoint': {
				if (!checkpointId) {
					throw new Error('checkpointId (commit hash) is required for action: restoreCheckpoint');
				}
				try {
					await this.runShadowGit(shadowGitDir, workspaceRoot, `checkout -f "${checkpointId}" -- .`);
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`### Shadow Checkpoint Restored\nWorkspace successfully reverted to checkpoint \`${checkpointId}\`.`)
					]);
				} catch (err: any) {
					throw new Error(`Failed to restore shadow checkpoint: ${err.message}`);
				}
			}

			case 'listCheckpoints': {
				try {
					const { stdout } = await this.runShadowGit(shadowGitDir, workspaceRoot, 'log --pretty=format:"%h | %cd | %s" --date=short -n 25');
					if (!stdout.trim()) {
						return new LanguageModelToolResult([
							new LanguageModelTextPart('No shadow checkpoints created yet.')
						]);
					}
					const list = stdout.split('\n').map(line => `- ${line}`).join('\n');
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`### Recent Shadow Checkpoints (Up to 25)\n${list}`)
					]);
				} catch {
					return new LanguageModelToolResult([
						new LanguageModelTextPart('No shadow checkpoints history found.')
					]);
				}
			}

			case 'getLatestCheckpoint': {
				try {
					const { stdout } = await this.runShadowGit(shadowGitDir, workspaceRoot, 'rev-parse HEAD');
					const hash = stdout.trim();
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`Latest Checkpoint Hash: \`${hash}\``)
					]);
				} catch {
					return new LanguageModelToolResult([
						new LanguageModelTextPart('No checkpoint currently available.')
					]);
				}
			}

			case 'diffCheckpoint': {
				try {
					const target = checkpointId ? `"${checkpointId}"` : 'HEAD';
					const { stdout } = await this.runShadowGit(shadowGitDir, workspaceRoot, `diff ${target}`);
					const diffContent = stdout.trim() || 'No changes between workspace and checkpoint.';
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`### Unified Diff vs Checkpoint (${target})\n\`\`\`diff\n${diffContent}\n\`\`\``)
					]);
				} catch (err: any) {
					throw new Error(`Failed to compute diff vs checkpoint: ${err.message}`);
				}
			}

			default:
				throw new Error(`Unsupported action: ${action}`);
		}
	}
}

ToolRegistry.registerTool(ShadowSnapshotCheckpointTool);
