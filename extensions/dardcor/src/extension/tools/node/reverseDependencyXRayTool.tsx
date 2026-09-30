/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface IReverseDependencyXRayParams {
	packageName: string;
	errorTraceSnippet?: string;
	relativeVendorFilePath?: string;
	description: string;
}

export class ReverseDependencyXRayTool implements ICopilotTool<IReverseDependencyXRayParams> {
	public static toolName = ToolName.ReverseDependencyXRay;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IReverseDependencyXRayParams>, token: vscode.CancellationToken) {
		const { packageName, errorTraceSnippet, relativeVendorFilePath } = options.input;

		// Resolve node_modules path from active workspace
		const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
		let targetPkgDir = '';

		for (const ws of workspaceFolders) {
			const candidate = path.join(ws, 'node_modules', packageName);
			if (fs.existsSync(candidate)) {
				targetPkgDir = candidate;
				break;
			}
		}

		if (!targetPkgDir) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`[Reverse Dependency X-Ray: Package Not Found]\nCould not locate 'node_modules/${packageName}' in workspace folders.\nVerify the package name or run 'npm install'.`
				)
			]);
		}

		// Read package.json metadata
		let pkgJsonInfo: Record<string, unknown> = {};
		const pkgJsonPath = path.join(targetPkgDir, 'package.json');
		if (fs.existsSync(pkgJsonPath)) {
			try {
				pkgJsonInfo = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
			} catch { }
		}

		let inspectedSnippet = '';
		let targetFileToRead = '';

		if (relativeVendorFilePath) {
			targetFileToRead = path.join(targetPkgDir, relativeVendorFilePath);
		} else if (errorTraceSnippet) {
			// Extract file path from stack trace e.g. "node_modules/pkg/dist/index.js:142:15"
			const match = errorTraceSnippet.match(/node_modules[\\/]([^:]+):(\d+)/);
			if (match) {
				const fullRel = match[1];
				// Remove package name prefix if present
				const subPath = fullRel.startsWith(packageName) ? fullRel.substring(packageName.length + 1) : fullRel;
				targetFileToRead = path.join(targetPkgDir, subPath);
			}
		}

		if (targetFileToRead && fs.existsSync(targetFileToRead)) {
			const content = fs.readFileSync(targetFileToRead, 'utf-8');
			const lines = content.split('\n');
			inspectedSnippet = lines.slice(0, 80).join('\n');
		}

		const resultPayload = {
			package: packageName,
			version: pkgJsonInfo['version'] ?? 'unknown',
			main: pkgJsonInfo['main'] ?? 'index.js',
			types: pkgJsonInfo['types'] ?? pkgJsonInfo['typings'] ?? 'none',
			inspectedFile: targetFileToRead ? this.promptPathRepresentationService.getFilePath(vscode.Uri.file(targetFileToRead)) : 'package.json',
			codeSnippet: inspectedSnippet ? (inspectedSnippet.length > 2000 ? inspectedSnippet.substring(0, 2000) + '...' : inspectedSnippet) : 'No specific file identified from trace.',
			forensicRecommendation: 'Use patch-package or override caller arguments to bypass the identified vendor invariant.'
		};

		return new LanguageModelToolResult([
			new LanguageModelTextPart(
				`[Reverse Dependency X-Ray Analysis]\n` +
				JSON.stringify(resultPayload, null, 2)
			)
		]);
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IReverseDependencyXRayParams>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation> {
		return {
			presentation: undefined,
			invocationMessage: new MarkdownString(`Reverse Dependency X-Ray: **${options.input.packageName}**`),
			pastTenseMessage: new MarkdownString(`Executed Reverse Dependency X-Ray: **${options.input.packageName}**`)
		};
	}
}

ToolRegistry.registerTool(ReverseDependencyXRayTool);
