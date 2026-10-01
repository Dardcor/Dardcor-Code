/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface ICheckpoint {
	id: string;
	timestamp: number;
	treeHash: string;
	untrackedStash?: string;
	description: string;
	filesModified: string[];
}

export class GitCheckpointEngine {
	private static instance: GitCheckpointEngine | undefined;
	private checkpoints: ICheckpoint[] = [];
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	public static getInstance(workspaceRoot: string): GitCheckpointEngine {
		if (!GitCheckpointEngine.instance || GitCheckpointEngine.instance.workspaceRoot !== workspaceRoot) {
			GitCheckpointEngine.instance = new GitCheckpointEngine(workspaceRoot);
		}
		return GitCheckpointEngine.instance;
	}

	/**
	 * Capture snapshot before an AI operation begins using git plumbing commands.
	 */
	public async capture(description: string): Promise<ICheckpoint> {
		const cwd = this.workspaceRoot;
		const id = `cp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

		try {
			await execAsync('git add -A', { cwd });
			const { stdout: treeStdout } = await execAsync('git write-tree', { cwd });
			const treeHash = treeStdout.trim();

			let untrackedStash: string | undefined;
			try {
				const { stdout: stashStdout } = await execAsync('git stash create --include-untracked', { cwd });
				if (stashStdout.trim()) {
					untrackedStash = stashStdout.trim();
				}
			} catch {
				// No untracked files or clean worktree
			}

			const checkpoint: ICheckpoint = {
				id,
				timestamp: Date.now(),
				treeHash,
				untrackedStash,
				description,
				filesModified: [],
			};

			this.checkpoints.push(checkpoint);
			if (this.checkpoints.length > 50) {
				this.checkpoints.shift();
			}

			return checkpoint;
		} catch (error: any) {
			// If not a git repository, fallback gracefully
			const fallbackCheckpoint: ICheckpoint = {
				id,
				timestamp: Date.now(),
				treeHash: 'HEAD',
				description: `${description} (non-git fallback)`,
				filesModified: [],
			};
			this.checkpoints.push(fallbackCheckpoint);
			return fallbackCheckpoint;
		}
	}

	/**
	 * Restores files to the exact state captured in the checkpoint.
	 */
	public async restore(checkpointId: string): Promise<{ success: boolean; message: string }> {
		const checkpoint = this.checkpoints.find((cp) => cp.id === checkpointId || cp.treeHash === checkpointId);
		if (!checkpoint) {
			return { success: false, message: `Checkpoint not found: ${checkpointId}` };
		}

		const cwd = this.workspaceRoot;
		try {
			await execAsync(`git read-tree ${checkpoint.treeHash}`, { cwd });
			await execAsync('git checkout-index -f -u -a', { cwd });

			if (checkpoint.untrackedStash) {
				try {
					await execAsync(`git stash apply ${checkpoint.untrackedStash}`, { cwd });
				} catch {
					// Stash apply may conflict if untracked files changed
				}
			}

			return {
				success: true,
				message: `Workspace successfully restored to checkpoint ${checkpoint.id} (${checkpoint.description})`,
			};
		} catch (error: any) {
			return {
				success: false,
				message: `Failed to restore checkpoint: ${error.message}`,
			};
		}
	}

	public list(): ICheckpoint[] {
		return [...this.checkpoints].reverse();
	}

	public getLatest(): ICheckpoint | undefined {
		return this.checkpoints[this.checkpoints.length - 1];
	}
}
