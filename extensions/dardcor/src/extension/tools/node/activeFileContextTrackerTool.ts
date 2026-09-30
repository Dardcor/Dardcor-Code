/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';

export interface IActiveFileContextParams {
	action: 'check' | 'track' | 'markFresh' | 'listStale';
	filePath?: string;
}

export class DardcorFileContextTracker {
	private static instance: DardcorFileContextTracker;
	private trackedFiles = new Set<string>();
	private fileHashes = new Map<string, string>();
	private staleFiles = new Set<string>();
	private agentEditsInProgress = new Set<string>();
	private disposables: vscode.Disposable[] = [];

	private constructor() {
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(event => {
				const fsPath = event.document.uri.fsPath;
				if (this.agentEditsInProgress.has(fsPath)) {
					this.agentEditsInProgress.delete(fsPath);
					return;
				}

				if (this.trackedFiles.has(fsPath)) {
					this.staleFiles.add(fsPath);
				}
			})
		);
	}

	public static getInstance(): DardcorFileContextTracker {
		if (!DardcorFileContextTracker.instance) {
			DardcorFileContextTracker.instance = new DardcorFileContextTracker();
		}
		return DardcorFileContextTracker.instance;
	}

	public async computeHash(filePath: string): Promise<string> {
		try {
			const buf = await fs.readFile(filePath);
			return crypto.createHash('sha256').update(buf).digest('hex');
		} catch {
			return '';
		}
	}

	public async trackFile(filePath: string): Promise<void> {
		this.trackedFiles.add(filePath);
		this.staleFiles.delete(filePath);
		const hash = await this.computeHash(filePath);
		if (hash) {
			this.fileHashes.set(filePath, hash);
		}
	}

	public markAgentEdit(filePath: string): void {
		this.agentEditsInProgress.add(filePath);
		this.trackedFiles.add(filePath);
		this.staleFiles.delete(filePath);
	}

	public async markFresh(filePath: string): Promise<void> {
		this.staleFiles.delete(filePath);
		this.trackedFiles.add(filePath);
		const hash = await this.computeHash(filePath);
		if (hash) {
			this.fileHashes.set(filePath, hash);
		}
	}

	public async isStale(filePath: string): Promise<boolean> {
		if (this.staleFiles.has(filePath)) {
			return true;
		}

		// Double-check disk hash against recorded baseline
		const recorded = this.fileHashes.get(filePath);
		if (recorded) {
			const current = await this.computeHash(filePath);
			if (current && current !== recorded) {
				this.staleFiles.add(filePath);
				return true;
			}
		}

		return false;
	}

	public getStaleFiles(): string[] {
		return Array.from(this.staleFiles);
	}

	public getTrackedFiles(): string[] {
		return Array.from(this.trackedFiles);
	}

	public dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
		this.trackedFiles.clear();
		this.fileHashes.clear();
		this.staleFiles.clear();
	}
}

export class ActiveFileContextTrackerTool implements ICopilotTool<IActiveFileContextParams> {
	public static readonly toolName = ToolName.ActiveFileContextTracker;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IActiveFileContextParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const tracker = DardcorFileContextTracker.getInstance();
		const { action, filePath } = options.input;

		let resolvedPath: string | undefined;
		if (filePath) {
			const uri = this.promptPathRepresentationService.resolveFilePath(filePath);
			resolvedPath = uri?.fsPath ?? filePath;
		}

		switch (action) {
			case 'track': {
				if (!resolvedPath) throw new Error('filePath is required for action: track');
				await tracker.trackFile(resolvedPath);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`File context tracking initialized for: ${resolvedPath}`)
				]);
			}

			case 'check': {
				if (!resolvedPath) throw new Error('filePath is required for action: check');
				const isStale = await tracker.isStale(resolvedPath);
				const statusText = isStale
					? `WARNING: File \`${resolvedPath}\` is STALE. External changes were detected since last inspected. Re-read this file before applying edits to prevent overwriting code.`
					: `File \`${resolvedPath}\` is FRESH. Synchronized with memory.`;
				return new LanguageModelToolResult([
					new LanguageModelTextPart(statusText)
				]);
			}

			case 'markFresh': {
				if (!resolvedPath) throw new Error('filePath is required for action: markFresh');
				await tracker.markFresh(resolvedPath);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`File marked as fresh in memory: ${resolvedPath}`)
				]);
			}

			case 'listStale': {
				const staleList = tracker.getStaleFiles();
				const msg = staleList.length > 0
					? `Detected ${staleList.length} STALE file(s):\n${staleList.map(f => `- ${f}`).join('\n')}\n\nReload these files before modifying them.`
					: `All active tracked files are currently synchronized and fresh.`;
				return new LanguageModelToolResult([
					new LanguageModelTextPart(msg)
				]);
			}

			default:
				throw new Error(`Unsupported action: ${action}`);
		}
	}
}

ToolRegistry.registerTool(ActiveFileContextTrackerTool);
