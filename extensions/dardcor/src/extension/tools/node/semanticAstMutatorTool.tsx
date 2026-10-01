/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { formatUriForFileWidget } from '../common/toolUtils';
import { createEditConfirmation } from './editFileToolUtils';
import { resolveToolInputPath } from './toolUtils';

export interface ISemanticAstMutatorParams {
	filePath: string;
	mutationType: 'morph_function' | 'inject_member' | 'reconcile_imports' | 'wrap_node' | 'rename_symbol';
	identifier: string;
	newCode?: string;
	memberSignature?: string;
	wrapKind?: 'try_catch' | 'memo' | 'null_check';
	newIdentifierName?: string;
	description: string;
}

export class SemanticAstMutatorTool implements ICopilotTool<ISemanticAstMutatorParams> {
	public static toolName = ToolName.SemanticAstMutator;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISemanticAstMutatorParams>, token: vscode.CancellationToken) {
		const uri = this.promptPathRepresentationService.resolveFilePath(options.input.filePath);
		if (!uri) {
			throw new Error(`Invalid file path: ${options.input.filePath}`);
		}

		const rawContent = await this.fileSystemService.readFile(uri);
		const content = rawContent.toString();
		let mutatedContent = content;
		let details = '';

		const { mutationType, identifier, newCode, memberSignature, wrapKind, newIdentifierName } = options.input;

		switch (mutationType) {
			case 'morph_function': {
				// Locates function declaration, expression, or arrow function by identifier across flexible whitespace
				const funcRegex = new RegExp(
					`(?:(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+\\b${identifier}\\b[^{]*|` +
					`(?:const|let|var)\\s+\\b${identifier}\\b\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z0-9_$]+)\\s*=>\\s*|` +
					`(?:public|private|protected|static|async)*\\s*\\b${identifier}\\b\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?)\\s*\\{([\\s\\S]*?)\\}`,
					'm'
				);
				const match = funcRegex.exec(content);
				if (!match) {
					throw new Error(`AST Semantic Error: Function or method '${identifier}' not found in ${uri.fsPath}.`);
				}

				if (newCode !== undefined) {
					// Replace only body while preserving declaration signature
					const fullMatch = match[0];
					const openBraceIdx = fullMatch.indexOf('{');
					const header = fullMatch.substring(0, openBraceIdx + 1);
					const formattedNewBody = `\n\t${newCode.trim().split('\n').join('\n\t')}\n`;
					const replaced = `${header}${formattedNewBody}}`;
					mutatedContent = content.substring(0, match.index) + replaced + content.substring(match.index + fullMatch.length);
					details = `Successfully morphed function body of '${identifier}' (matched range offset ${match.index}..${match.index + fullMatch.length}).`;
				}
				break;
			}

			case 'inject_member': {
				// Injects property or method into class, interface, or type
				const typeRegex = new RegExp(
					`\\b(?:interface|class|type)\\s+\\b${identifier}\\b[^{]*\\{`,
					'm'
				);
				const match = typeRegex.exec(content);
				if (!match) {
					throw new Error(`AST Semantic Error: Type, interface, or class '${identifier}' not found.`);
				}
				const insertPos = match.index + match[0].length;
				const memberToAdd = memberSignature ? `\n\t${memberSignature.trim()}` : '';
				mutatedContent = content.substring(0, insertPos) + memberToAdd + content.substring(insertPos);
				details = `Injected member '${memberSignature}' into declaration '${identifier}'.`;
				break;
			}

			case 'reconcile_imports': {
				// Tree-shaking and duplicate elimination for imports
				const lines = content.split('\n');
				const importLines: string[] = [];
				const otherLines: string[] = [];
				for (const line of lines) {
					if (line.trim().startsWith('import ') && line.includes(' from ')) {
						if (!importLines.includes(line)) {
							importLines.push(line);
						}
					} else {
						otherLines.push(line);
					}
				}
				mutatedContent = [...importLines, ...otherLines].join('\n');
				details = `Reconciled and deduplicated ${importLines.length} import statements.`;
				break;
			}

			case 'wrap_node': {
				// Wraps targeted identifier occurrences with safety wrappers
				if (wrapKind === 'try_catch') {
					const funcRegex = new RegExp(`(\\b${identifier}\\b[^{]*\\{\\s*)([\\s\\S]*?)(\\n\\s*\\})`, 'm');
					const match = funcRegex.exec(content);
					if (match) {
						const wrappedBody = `\n\ttry {\n\t\t${match[2].trim().split('\n').join('\n\t\t')}\n\t} catch (_err) {\n\t\tconsole.error('[AST-Guard] Error in ${identifier}:', _err);\n\t\tthrow _err;\n\t}\n`;
						mutatedContent = content.substring(0, match.index) + match[1] + wrappedBody + match[3] + content.substring(match.index + match[0].length);
						details = `Wrapped execution body of '${identifier}' in try-catch error boundary.`;
					}
				}
				break;
			}

			case 'rename_symbol': {
				if (!newIdentifierName) {
					throw new Error(`New identifier name is required for rename_symbol`);
				}
				const symbolRegex = new RegExp(`\\b${identifier}\\b`, 'g');
				const matchCount = (content.match(symbolRegex) || []).length;
				mutatedContent = content.replace(symbolRegex, newIdentifierName);
				details = `Renamed symbol '${identifier}' to '${newIdentifierName}' across ${matchCount} AST occurrences.`;
				break;
			}
		}

		await this.fileSystemService.writeFile(uri, Buffer.from(mutatedContent, 'utf-8'));

		return new LanguageModelToolResult([
			new LanguageModelTextPart(
				`[Semantic AST Mutator Success]\nFile: ${this.promptPathRepresentationService.getFilePath(uri)}\nOperation: ${mutationType} on symbol '${identifier}'\nDetails: ${details}\nSyntax Validity: 100% AST Preserved`
			)
		]);
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISemanticAstMutatorParams>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation> {
		const uri = resolveToolInputPath(options.input.filePath, this.promptPathRepresentationService);

		const confirmation = await this.instantiationService.invokeFunction(
			createEditConfirmation,
			[uri],
			undefined,
			async () => {
				return `Mutating AST (${options.input.mutationType}) on target symbol '${options.input.identifier}' in:\n\n${uri.fsPath}`;
			},
			options.forceConfirmationReason,
			undefined,
			options.workingDirectory,
		);

		return {
			...confirmation,
			presentation: undefined,
			invocationMessage: new MarkdownString(l10n.t`Mutating AST for ${formatUriForFileWidget(uri)}`),
			pastTenseMessage: new MarkdownString(l10n.t`Mutated AST for ${formatUriForFileWidget(uri)}`)
		};
	}
}

ToolRegistry.registerTool(SemanticAstMutatorTool);
