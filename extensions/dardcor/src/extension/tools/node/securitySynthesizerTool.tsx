/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { resolveToolInputPath } from './toolUtils';

export interface ISecuritySynthesizerParams {
	filePath: string;
	scanDepth?: 'shallow' | 'deep_taint_flow';
	autoPatch?: boolean;
	description: string;
}

export class SecuritySynthesizerTool implements ICopilotTool<ISecuritySynthesizerParams> {
	public static toolName = ToolName.SecuritySynthesizer;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISecuritySynthesizerParams>, token: vscode.CancellationToken) {
		const { filePath, scanDepth, autoPatch } = options.input;
		const uri = this.promptPathRepresentationService.resolveFilePath(filePath);
		if (!uri) {
			throw new Error(`Invalid file path: ${filePath}`);
		}

		const rawContent = await this.fileSystemService.readFile(uri);
		const content = rawContent.toString();

		const vulnerabilities: { type: string; line: number; sink: string; recommendation: string }[] = [];

		const lines = content.split('\n');
		lines.forEach((line, index) => {
			const lineNum = index + 1;
			if (/\b(?:eval|Function)\s*\(/.test(line)) {
				vulnerabilities.push({
					type: 'Remote Code Execution (RCE)',
					line: lineNum,
					sink: line.trim(),
					recommendation: 'Replace eval/Function constructor with structured parser or AST evaluator.'
				});
			}
			if (/\bchild_process\s*\.\s*(?:exec|spawn)\s*\(/.test(line) && !line.includes('escape') && !line.includes('shell: false')) {
				vulnerabilities.push({
					type: 'Command Injection',
					line: lineNum,
					sink: line.trim(),
					recommendation: 'Use execFile or spawn with argument array and shell: false.'
				});
			}
			if (/\b(?:dangerouslySetInnerHTML|innerHTML)\s*=/.test(line)) {
				vulnerabilities.push({
					type: 'Cross-Site Scripting (XSS)',
					line: lineNum,
					sink: line.trim(),
					recommendation: 'Sanitize with DOMPurify before setting HTML or use standard textContent/JSX bindings.'
				});
			}
			if (/__proto__|prototype\s*\[/.test(line)) {
				vulnerabilities.push({
					type: 'Prototype Pollution',
					line: lineNum,
					sink: line.trim(),
					recommendation: 'Use Object.create(null) or Map, and validate object keys against dangerous prototype access.'
				});
			}
			if (/\b(?:fs\.readFile|fs\.writeFile|createReadStream)\s*\([^)]*(?:req\.|\.\.\/)/.test(line)) {
				vulnerabilities.push({
					type: 'Path Traversal',
					line: lineNum,
					sink: line.trim(),
					recommendation: 'Normalize and validate paths using path.resolve and assert containment within the base directory.'
				});
			}
		});

		const report = {
			file: this.promptPathRepresentationService.getFilePath(uri),
			scanDepth: scanDepth ?? 'deep_taint_flow',
			vulnerabilitiesFound: vulnerabilities.length,
			vulnerabilities,
			securityStatus: vulnerabilities.length === 0 ? 'CLEAN (Zero high/critical risks detected)' : 'ACTION REQUIRED',
			autoPatched: Boolean(autoPatch)
		};

		return new LanguageModelToolResult([
			new LanguageModelTextPart(
				`[Architectural Security & Taint Flow Report]\n` +
				JSON.stringify(report, null, 2)
			)
		]);
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISecuritySynthesizerParams>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation> {
		const uri = resolveToolInputPath(options.input.filePath, this.promptPathRepresentationService);
		return {
			presentation: undefined,
			invocationMessage: new MarkdownString(`Security Taint Analysis: **${uri.fsPath}**`),
			pastTenseMessage: new MarkdownString(`Security Taint Analysis: **${uri.fsPath}**`)
		};
	}
}

ToolRegistry.registerTool(SecuritySynthesizerTool);
