/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

const execAsync = promisify(exec);

export interface IContextMentionsParams {
	mentionQuery: string;
}

export class ContextMentionsResolverTool implements ICopilotTool<IContextMentionsParams> {
	public static readonly toolName = ToolName.ContextMentionsResolver;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IContextMentionsParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const expanded = await resolveDardcorContextMentions(options.input.mentionQuery);
		return new LanguageModelToolResult([
			new LanguageModelTextPart(expanded)
		]);
	}
}

/**
 * Expands slash-based and @-based context mentions into rich prompt blocks.
 * Supports @problems, @terminal, @git-changes, @selection, @file:<path>, @folder:<path>, and / equivalent.
 */
export async function resolveDardcorContextMentions(text: string): Promise<string> {
	let result = text;
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

	// @selection / /selection
	if (result.includes('@selection') || result.includes('/selection')) {
		let selectionContent = 'No active text selection in editor.';
		const editor = vscode.window.activeTextEditor;
		if (editor && !editor.selection.isEmpty) {
			const selectedText = editor.document.getText(editor.selection);
			const relPath = vscode.workspace.asRelativePath(editor.document.uri);
			const startLine = editor.selection.start.line + 1;
			const endLine = editor.selection.end.line + 1;
			selectionContent = `File: ${relPath} (lines ${startLine}-${endLine})\n\`\`\`\n${selectedText}\n\`\`\``;
		}
		const selectionBlock = `\n\n<context_mention type="@selection">\n${selectionContent}\n</context_mention>\n`;
		result = result.replace(/[@\/]selection\b/g, selectionBlock);
	}

	// @problems / /problems
	if (result.match(/[@\/]problems(?::errors)?\b/)) {
		const errorsOnly = result.includes('@problems:errors') || result.includes('/problems:errors');
		const diagnostics = vscode.languages.getDiagnostics();
		const problemsList: string[] = [];

		for (const [uri, diagList] of diagnostics) {
			const filtered = diagList.filter(d => {
				if (errorsOnly) {
					return d.severity === vscode.DiagnosticSeverity.Error;
				}
				return d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning;
			});

			if (filtered.length > 0) {
				const relPath = vscode.workspace.asRelativePath(uri);
				problemsList.push(`File: ${relPath}`);
				for (const d of filtered) {
					const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
					problemsList.push(`  [Line ${d.range.start.line + 1}:${d.range.start.character + 1}] [${sev}] ${d.message}`);
				}
			}
		}

		const countDesc = errorsOnly ? 'compiler errors' : 'compiler errors & warnings';
		const problemsOutput = problemsList.length > 0
			? `\n\n<context_mention type="@problems">\n${problemsList.slice(0, 150).join('\n')}\n</context_mention>\n`
			: `\n\n<context_mention type="@problems">\nNo workspace ${countDesc} detected.\n</context_mention>\n`;

		result = result.replace(/[@\/]problems(?::errors)?\b/g, problemsOutput);
	}

	// @terminal / /terminal
	if (result.match(/[@\/]terminal\b/)) {
		let terminalOutput = 'No active terminal output available.';
		const activeTerminals = vscode.window.terminals;
		if (activeTerminals.length > 0) {
			const active = vscode.window.activeTerminal ?? activeTerminals[0];
			terminalOutput = `Active Terminal: "${active.name}" (Shell Path: ${active.creationOptions && 'shellPath' in active.creationOptions ? active.creationOptions.shellPath : 'default'})`;
		}

		const terminalBlock = `\n\n<context_mention type="@terminal">\n${terminalOutput}\n</context_mention>\n`;
		result = result.replace(/[@\/]terminal\b/g, terminalBlock);
	}

	// @git-changes / @git / /git-changes
	if (result.match(/[@\/](?:git-changes|git)\b/)) {
		let gitOutput = '';
		try {
			const { stdout: statusOut } = await execAsync('git status --short', { cwd: workspaceRoot });
			const { stdout: diffOut } = await execAsync('git diff', { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 });

			if (statusOut.trim()) {
				const diffSnippet = diffOut.length > 20000 ? diffOut.substring(0, 20000) + '\n... [diff truncated]' : diffOut;
				gitOutput = `Working Tree Status:\n${statusOut.trim()}\n\nDiff:\n\`\`\`diff\n${diffSnippet}\n\`\`\``;
			} else {
				gitOutput = 'Working directory clean. No uncommitted git changes.';
			}
		} catch {
			gitOutput = 'No active git repository found in workspace.';
		}

		const gitBlock = `\n\n<context_mention type="@git-changes">\n${gitOutput}\n</context_mention>\n`;
		result = result.replace(/[@\/](?:git-changes|git)\b/g, gitBlock);
	}

	// @folder:<path> / /folder:<path>
	const folderMentionRegex = /[@\/]folder:(?:"([^"]+)"|'([^']+)'|([^\s\n]+))/g;
	let folderMatch: RegExpExecArray | null;
	while ((folderMatch = folderMentionRegex.exec(result)) !== null) {
		const targetFolder = folderMatch[1] || folderMatch[2] || folderMatch[3];
		let folderListing = '';
		try {
			const resolvedUri = path.isAbsolute(targetFolder)
				? vscode.Uri.file(targetFolder)
				: vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), targetFolder);

			const entries = await vscode.workspace.fs.readDirectory(resolvedUri);
			const lines = entries.slice(0, 100).map(([name, type]) => {
				const isDir = (type & vscode.FileType.Directory) !== 0;
				return `${isDir ? '📁' : '📄'} ${name}`;
			});
			folderListing = lines.join('\n');
		} catch (err: any) {
			folderListing = `Error reading folder ${targetFolder}: ${err.message}`;
		}

		const folderBlock = `\n\n<context_mention type="@folder" path="${targetFolder}">\n${folderListing}\n</context_mention>\n`;
		result = result.replace(folderMatch[0], folderBlock);
	}

	// @file:<path> / /file:<path>
	const fileMentionRegex = /[@\/]file:(?:"([^"]+)"|'([^']+)'|([^\s\n]+))/g;
	let fileMatch: RegExpExecArray | null;
	while ((fileMatch = fileMentionRegex.exec(result)) !== null) {
		let rawTarget = fileMatch[1] || fileMatch[2] || fileMatch[3];
		let startLine: number | undefined;
		let endLine: number | undefined;

		const rangeMatch = /#?L?(\d+)[-:]L?(\d+)$/i.exec(rawTarget);
		if (rangeMatch) {
			startLine = parseInt(rangeMatch[1], 10);
			endLine = parseInt(rangeMatch[2], 10);
			rawTarget = rawTarget.substring(0, rangeMatch.index);
		}

		let fileContent = '';
		try {
			const resolvedUri = path.isAbsolute(rawTarget)
				? vscode.Uri.file(rawTarget)
				: vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), rawTarget);

			const data = await vscode.workspace.fs.readFile(resolvedUri);
			let textContent = Buffer.from(data).toString('utf8');

			if (startLine !== undefined) {
				const lines = textContent.split('\n');
				const s = Math.max(0, startLine - 1);
				const e = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
				textContent = lines.slice(s, e).join('\n');
			}

			if (textContent.length > 30000) {
				textContent = textContent.substring(0, 30000) + '\n... [truncated]';
			}
			fileContent = textContent;
		} catch (err: any) {
			fileContent = `Error reading file ${rawTarget}: ${err.message}`;
		}

		const rangeLabel = startLine !== undefined ? ` (lines ${startLine}-${endLine ?? 'end'})` : '';
		const fileBlock = `\n\n<context_mention type="@file" path="${rawTarget}"${rangeLabel}>\n\`\`\`\n${fileContent}\n\`\`\`\n</context_mention>\n`;
		result = result.replace(fileMatch[0], fileBlock);
	}

	// @url:<link> / /url:<link>
	const urlMentionRegex = /[@\/]url:(https?:\/\/[^\s\n>]+)/g;
	let urlMatch: RegExpExecArray | null;
	while ((urlMatch = urlMentionRegex.exec(result)) !== null) {
		const targetUrl = urlMatch[1];
		let fetchedText = '';
		try {
			const res = await fetch(targetUrl, { headers: { 'User-Agent': 'Dardcor-Code-Assistant' } });
			fetchedText = await res.text();
			if (fetchedText.length > 20000) {
				fetchedText = fetchedText.substring(0, 20000) + '\n... [truncated]';
			}
		} catch (err: any) {
			fetchedText = `Error fetching URL ${targetUrl}: ${err.message}`;
		}

		const urlBlock = `\n\n<context_mention type="@url" target="${targetUrl}">\n${fetchedText}\n</context_mention>\n`;
		result = result.replace(urlMatch[0], urlBlock);
	}

	// Git commit hash mentions: /<hash> (7 to 40 hex chars)
	const commitMentionRegex = /\/([a-f0-9]{7,40})\b/g;
	result = result.replace(commitMentionRegex, (match, hash) => {
		return `<context_mention type="/commit" hash="${hash}">(Git commit reference '${hash}')</context_mention>`;
	});

	return result;
}

ToolRegistry.registerTool(ContextMentionsResolverTool);
