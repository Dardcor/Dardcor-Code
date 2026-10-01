/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as vm from 'vm';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';

const execAsync = promisify(exec);

export interface ICodeModeParams {
	code: string;
	timeoutMs?: number;
	maxOutputBytes?: number;
}

export class CodeModeOrchestratorTool implements ICopilotTool<ICodeModeParams> {
	public static readonly toolName = ToolName.CodeModeOrchestrator;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICodeModeParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { code, timeoutMs = 30000, maxOutputBytes = 65536 } = options.input;

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const logs: string[] = [];
		let toolCallsCount = 0;
		const MAX_TOOL_CALLS = 100;

		const checkLimit = () => {
			if (++toolCallsCount > MAX_TOOL_CALLS) {
				throw new Error(`Exceeded maximum tool call limit (${MAX_TOOL_CALLS})`);
			}
		};

		const sandboxTools = {
			readFile: async (relPath: string): Promise<string> => {
				checkLimit();
				const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspaceFolder, relPath);
				return await fs.readFile(absPath, 'utf8');
			},
			writeFile: async (relPath: string, content: string): Promise<void> => {
				checkLimit();
				const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspaceFolder, relPath);
				await fs.mkdir(path.dirname(absPath), { recursive: true });
				await fs.writeFile(absPath, content, 'utf8');
			},
			replaceInFile: async (relPath: string, target: string, replacement: string): Promise<boolean> => {
				checkLimit();
				const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspaceFolder, relPath);
				const content = await fs.readFile(absPath, 'utf8');
				if (!content.includes(target)) {
					return false;
				}
				const updated = content.replace(target, replacement);
				await fs.writeFile(absPath, updated, 'utf8');
				return true;
			},
			fileExists: async (relPath: string): Promise<boolean> => {
				checkLimit();
				const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(workspaceFolder, relPath);
				try {
					await fs.access(absPath);
					return true;
				} catch {
					return false;
				}
			},
			listFiles: async (dirRelPath = '.'): Promise<string[]> => {
				checkLimit();
				const absDir = path.isAbsolute(dirRelPath) ? dirRelPath : path.resolve(workspaceFolder, dirRelPath);
				const entries = await fs.readdir(absDir, { withFileTypes: true });
				return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name);
			},
			findFiles: async (pattern: string, maxResults = 50): Promise<string[]> => {
				checkLimit();
				const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxResults);
				return uris.map(u => vscode.workspace.asRelativePath(u));
			},
			getDiagnostics: async (): Promise<Array<{ file: string; line: number; message: string; severity: string }>> => {
				checkLimit();
				const diags = vscode.languages.getDiagnostics();
				const items: Array<{ file: string; line: number; message: string; severity: string }> = [];
				for (const [uri, list] of diags) {
					for (const d of list) {
						items.push({
							file: vscode.workspace.asRelativePath(uri),
							line: d.range.start.line + 1,
							message: d.message,
							severity: vscode.DiagnosticSeverity[d.severity]
						});
					}
				}
				return items;
			},
			executeCommand: async (cmd: string): Promise<{ stdout: string; stderr: string }> => {
				checkLimit();
				return await execAsync(cmd, { cwd: workspaceFolder, timeout: 15000 });
			}
		};

		const sandboxConsole = {
			log: (...args: any[]) => {
				logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
			},
			error: (...args: any[]) => {
				logs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
			}
		};

		const sandbox = {
			tools: sandboxTools,
			console: sandboxConsole,
			JSON,
			Math,
			Date,
			Array,
			Object,
			String,
			Number,
			Boolean,
			RegExp,
			Buffer,
			setTimeout,
			clearTimeout,
			Promise,
		};

		const vmContext = vm.createContext(sandbox);
		const wrappedScript = `(async () => {\n${code}\n})()`;

		let result: any;
		const startTime = Date.now();

		try {
			const script = new vm.Script(wrappedScript, { filename: 'dardcor_codemode.js' });
			const promise = script.runInContext(vmContext, { timeout: timeoutMs });
			result = await promise;
		} catch (err: any) {
			const duration = Date.now() - startTime;
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`### CodeMode Batch Script Execution Failed (${duration}ms)\nError: ${err.message}\n\nLogs:\n${logs.join('\n')}`)
			]);
		}

		const duration = Date.now() - startTime;
		let outputStr = '';
		if (result !== undefined) {
			outputStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
		}

		if (outputStr.length > maxOutputBytes) {
			outputStr = outputStr.substring(0, maxOutputBytes) + `\n... [Output truncated to ${maxOutputBytes} bytes]`;
		}

		const resultMarkdown = [
			`### CodeMode Batch Orchestration Succeeded`,
			`- Duration: ${duration}ms`,
			`- Total Tool Invocations: ${toolCallsCount}`,
			`- Output Bytes: ${outputStr.length}`,
			``,
			logs.length > 0 ? `#### Script Logs:\n\`\`\`\n${logs.join('\n')}\n\`\`\`\n` : '',
			outputStr ? `#### Evaluation Result:\n\`\`\`json\n${outputStr}\n\`\`\`` : '(No direct return value)'
		].filter(Boolean).join('\n');

		return new LanguageModelToolResult([
			new LanguageModelTextPart(resultMarkdown)
		]);
	}
}

ToolRegistry.registerTool(CodeModeOrchestratorTool);
