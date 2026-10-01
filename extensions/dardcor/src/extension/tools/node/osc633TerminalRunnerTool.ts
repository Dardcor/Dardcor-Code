/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface IOsc633TerminalParams {
	command: string;
	cwd?: string;
	timeoutMs?: number;
}

export enum Osc633Type {
	PromptStart = 'A',
	CommandStart = 'B',
	CommandExecuted = 'C',
	CommandFinished = 'D',
	CommandLine = 'E',
	Property = 'P',
}

export interface IOsc633Event {
	type: Osc633Type;
	data?: string;
	exitCode?: number;
}

/**
 * Stateful chunk-boundary safe parser for OSC 633 shell integration sequences.
 * Sequence format: \x1b]633;<Type>[;<Payload>]\x07 or \x1b]633;<Type>[;<Payload>]\x1b\\
 */
export class Osc633StreamParser {
	private buffer: string = '';
	private commandOutput: string[] = [];
	private isExecuting: boolean = false;
	private exitCode: number | undefined = undefined;
	private cwd: string | undefined = undefined;

	public feedChunk(chunk: string): IOsc633Event[] {
		this.buffer += chunk;
		const events: IOsc633Event[] = [];

		const oscPattern = /\x1b\]633;([A-Z])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = oscPattern.exec(this.buffer)) !== null) {
			const textBefore = this.buffer.substring(lastIndex, match.index);
			if (this.isExecuting && textBefore.length > 0) {
				this.commandOutput.push(textBefore);
			}

			const code = match[1] as Osc633Type;
			const payload = match[2] || '';

			switch (code) {
				case Osc633Type.PromptStart:
					events.push({ type: Osc633Type.PromptStart });
					this.isExecuting = false;
					break;
				case Osc633Type.CommandStart:
					events.push({ type: Osc633Type.CommandStart });
					break;
				case Osc633Type.CommandExecuted:
					events.push({ type: Osc633Type.CommandExecuted });
					this.isExecuting = true;
					break;
				case Osc633Type.CommandFinished: {
					const codeNum = payload ? parseInt(payload, 10) : 0;
					this.exitCode = isNaN(codeNum) ? 0 : codeNum;
					this.isExecuting = false;
					events.push({ type: Osc633Type.CommandFinished, exitCode: this.exitCode });
					break;
				}
				case Osc633Type.Property:
					if (payload.startsWith('Cwd=')) {
						this.cwd = payload.substring(4);
						events.push({ type: Osc633Type.Property, data: this.cwd });
					}
					break;
			}

			lastIndex = oscPattern.lastIndex;
		}

		if (lastIndex > 0) {
			this.buffer = this.buffer.substring(lastIndex);
		} else if (this.isExecuting) {
			if (this.buffer.length > 1024 && !this.buffer.includes('\x1b]')) {
				this.commandOutput.push(this.buffer);
				this.buffer = '';
			}
		}

		return events;
	}

	public getCleanOutput(): string {
		const raw = this.commandOutput.join('') + this.buffer;
		return raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
	}

	public getExitCode(): number | undefined {
		return this.exitCode;
	}

	public getCurrentCwd(): string | undefined {
		return this.cwd;
	}
}

export class Osc633TerminalRunnerTool implements ICopilotTool<IOsc633TerminalParams> {
	public static readonly toolName = ToolName.Osc633TerminalRunner;

	private isInteractivePrompt(chunk: string): boolean {
		return /\[[yY]\/[nN]\]|\(yes\/no\)|password:|passphrase:|press (?:any key|enter) to continue/i.test(chunk);
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IOsc633TerminalParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { command, cwd, timeoutMs = 60000 } = options.input;

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const effectiveCwd = cwd ? (path.isAbsolute(cwd) ? cwd : path.resolve(workspaceRoot, cwd)) : workspaceRoot;

		const startTime = Date.now();
		const parser = new Osc633StreamParser();

		return new Promise((resolve, reject) => {
			const isWindows = process.platform === 'win32';
			const shell = isWindows ? 'powershell.exe' : '/bin/bash';
			const shellArgs = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

			const child = spawn(shell, shellArgs, {
				cwd: effectiveCwd,
				env: { ...process.env, TERM: 'xterm-256color' },
			});

			let stdoutData = '';
			let stderrData = '';
			let timedOut = false;
			let abortedForInteractive = false;

			const timer = setTimeout(() => {
				timedOut = true;
				child.kill();
			}, timeoutMs);

			token.onCancellationRequested(() => {
				child.kill();
				clearTimeout(timer);
				resolve(new LanguageModelToolResult([
					new LanguageModelTextPart(`Command execution cancelled by user: \`${command}\``)
				]));
			});

			child.stdout.on('data', (data: Buffer) => {
				const str = data.toString('utf8');
				stdoutData += str;
				parser.feedChunk(str);

				if (this.isInteractivePrompt(str)) {
					abortedForInteractive = true;
					child.kill();
				}
			});

			child.stderr.on('data', (data: Buffer) => {
				stderrData += data.toString('utf8');
			});

			child.on('error', (err) => {
				clearTimeout(timer);
				reject(new Error(`Failed to spawn terminal process: ${err.message}`));
			});

			child.on('close', (code) => {
				clearTimeout(timer);
				const duration = Date.now() - startTime;
				const cleanOutput = parser.getCleanOutput() || stdoutData.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
				const cleanStderr = stderrData.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
				const resolvedExitCode = parser.getExitCode() ?? code ?? 0;

				let statusSummary = resolvedExitCode === 0 ? 'SUCCESS' : `FAILED (Exit Code ${resolvedExitCode})`;
				if (timedOut) {
					statusSummary = `TIMED OUT after ${timeoutMs}ms`;
				} else if (abortedForInteractive) {
					statusSummary = 'SUSPENDED: Interactive prompt detected (e.g. confirmation/password)';
				}

				const outputBlocks = [
					`### Dardcor Precision Terminal Execution`,
					`- Command: \`${command}\``,
					`- Status: **${statusSummary}**`,
					`- Duration: ${duration}ms`,
					`- Working Dir: \`${effectiveCwd}\``,
					``,
					`#### Output:`,
					`\`\`\``,
					cleanOutput || '(no stdout output)',
					`\`\`\``,
				];

				if (cleanStderr) {
					outputBlocks.push(``, `#### Errors (stderr):`, `\`\`\``, cleanStderr, `\`\`\``);
				}

				resolve(new LanguageModelToolResult([
					new LanguageModelTextPart(outputBlocks.join('\n'))
				]));
			});
		});
	}
}

ToolRegistry.registerTool(Osc633TerminalRunnerTool);
