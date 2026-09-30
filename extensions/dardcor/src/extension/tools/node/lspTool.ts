/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface ILspParams {
	operation: 'goToDefinition' | 'findReferences' | 'hover' | 'documentSymbol' | 'workspaceSymbol' | 'goToImplementation' | 'prepareCallHierarchy' | 'incomingCalls' | 'outgoingCalls';
	filePath: string;
	line?: number;
	character?: number;
	query?: string;
}

export class LanguageServerProtocolTool implements ICopilotTool<ILspParams> {
	public static readonly toolName = ToolName.LanguageServerProtocol;

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
	) { }

	private async resolveSnippet(docUri: vscode.Uri, lineIndex: number): Promise<string> {
		try {
			const targetDoc = await vscode.workspace.openTextDocument(docUri);
			if (lineIndex >= 0 && lineIndex < targetDoc.lineCount) {
				return targetDoc.lineAt(lineIndex).text.trim();
			}
		} catch { }
		return '';
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ILspParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { operation, filePath, line = 1, character = 1, query = '' } = options.input;

		let uri: vscode.Uri | undefined;
		if (operation !== 'workspaceSymbol') {
			const resolved = this.promptPathRepresentationService.resolveFilePath(filePath);
			if (!resolved) {
				throw new Error(`Unable to resolve document path: ${filePath}`);
			}
			uri = vscode.Uri.file(resolved.fsPath);

			// Warm up the Language Server for documents not yet active in memory
			try {
				await vscode.workspace.openTextDocument(uri);
			} catch { }
		}

		// VS Code Position is 0-indexed, while tool parameters use editor-style 1-indexing
		const targetPosition = new vscode.Position(Math.max(0, line - 1), Math.max(0, character - 1));

		switch (operation) {
			case 'goToDefinition': {
				const definitions = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
					'vscode.executeDefinitionProvider',
					uri,
					targetPosition
				);

				if (!definitions || (Array.isArray(definitions) && definitions.length === 0)) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`No definition targets found at ${filePath}:${line}:${character}.`)
					]);
				}

				const formattedItems: string[] = [];
				if (Array.isArray(definitions)) {
					for (const def of definitions) {
						if ('targetUri' in def) {
							const targetLine = def.targetRange.start.line;
							const snippet = await this.resolveSnippet(def.targetUri, targetLine);
							const rel = vscode.workspace.asRelativePath(def.targetUri);
							formattedItems.push(`- **${rel}:${targetLine + 1}**${snippet ? ` \`${snippet}\`` : ''}`);
						} else {
							const targetLine = def.range.start.line;
							const snippet = await this.resolveSnippet(def.uri, targetLine);
							const rel = vscode.workspace.asRelativePath(def.uri);
							formattedItems.push(`- **${rel}:${targetLine + 1}**${snippet ? ` \`${snippet}\`` : ''}`);
						}
					}
				}

				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Language Server Definitions\nFound ${formattedItems.length} definition target(s) for \`${filePath}:${line}:${character}\`:\n\n${formattedItems.join('\n')}`)
				]);
			}

			case 'findReferences': {
				const references = await vscode.commands.executeCommand<vscode.Location[]>(
					'vscode.executeReferenceProvider',
					uri,
					targetPosition
				);

				if (!references || references.length === 0) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`No references found for symbol at ${filePath}:${line}:${character}.`)
					]);
				}

				const formatted: string[] = [];
				for (const [idx, ref] of references.slice(0, 100).entries()) {
					const lineNum = ref.range.start.line;
					const snippet = await this.resolveSnippet(ref.uri, lineNum);
					const rel = vscode.workspace.asRelativePath(ref.uri);
					formatted.push(`${idx + 1}. **${rel}:${lineNum + 1}**${snippet ? ` \`${snippet}\`` : ''}`);
				}

				const note = references.length > 100 ? `\n\n*(Showing top 100 of ${references.length} references)*` : '';
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Language Server References\nFound ${references.length} semantic references across workspace:\n\n${formatted.join('\n')}${note}`)
				]);
			}

			case 'hover': {
				const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
					'vscode.executeHoverProvider',
					uri,
					targetPosition
				);

				if (!hovers || hovers.length === 0) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`No hover or type documentation available at ${filePath}:${line}:${character}.`)
					]);
				}

				const hoverContents = hovers.map(h => {
					return h.contents.map(c => {
						if (typeof c === 'string') {
							return c;
						} else if ('value' in c) {
							return c.value;
						}
						return '';
					}).filter(Boolean).join('\n');
				}).filter(Boolean).join('\n---\n');

				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Type & Hover Signature\n${hoverContents}`)
				]);
			}

			case 'documentSymbol': {
				const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
					'vscode.executeDocumentSymbolProvider',
					uri
				);

				if (!symbols || symbols.length === 0) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`No document symbols extracted for ${filePath}.`)
					]);
				}

				const renderSymbols = (items: vscode.DocumentSymbol[], depth = 0): string => {
					const indent = '  '.repeat(depth);
					return items.map(sym => {
						const kind = vscode.SymbolKind[sym.kind] || 'Symbol';
						const current = `${indent}- **${sym.name}** (${kind}) [L${sym.range.start.line + 1}-L${sym.range.end.line + 1}]`;
						if (sym.children && sym.children.length > 0) {
							return `${current}\n${renderSymbols(sym.children, depth + 1)}`;
						}
						return current;
					}).join('\n');
				};

				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Document Hierarchy Symbols (${filePath})\n${renderSymbols(symbols)}`)
				]);
			}

			case 'workspaceSymbol': {
				const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
					'vscode.executeWorkspaceSymbolProvider',
					query
				);

				if (!symbols || symbols.length === 0) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`No workspace symbols matching query '${query}'.`)
					]);
				}

				const formatted = symbols.slice(0, 100).map(sym => {
					const kind = vscode.SymbolKind[sym.kind] || 'Symbol';
					const rel = vscode.workspace.asRelativePath(sym.location.uri);
					return `- **${sym.name}** (${kind}) in \`${rel}:${sym.location.range.start.line + 1}\` ${sym.containerName ? `(container: ${sym.containerName})` : ''}`;
				}).join('\n');

				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Workspace Symbols for query '${query}' (Total: ${symbols.length})\n${formatted}`)
				]);
			}

			case 'goToImplementation': {
				const implementations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
					'vscode.executeImplementationProvider',
					uri,
					targetPosition
				);

				if (!implementations || (Array.isArray(implementations) && implementations.length === 0)) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`No implementations found at ${filePath}:${line}:${character}.`)
					]);
				}

				const formatted: string[] = [];
				if (Array.isArray(implementations)) {
					for (const impl of implementations) {
						if ('targetUri' in impl) {
							const targetLine = impl.targetRange.start.line;
							const snippet = await this.resolveSnippet(impl.targetUri, targetLine);
							const rel = vscode.workspace.asRelativePath(impl.targetUri);
							formatted.push(`- **${rel}:${targetLine + 1}**${snippet ? ` \`${snippet}\`` : ''}`);
						} else {
							const targetLine = impl.range.start.line;
							const snippet = await this.resolveSnippet(impl.uri, targetLine);
							const rel = vscode.workspace.asRelativePath(impl.uri);
							formatted.push(`- **${rel}:${targetLine + 1}**${snippet ? ` \`${snippet}\`` : ''}`);
						}
					}
				}

				return new LanguageModelToolResult([
					new LanguageModelTextPart(`### Semantic Implementations\n${formatted.join('\n')}`)
				]);
			}

			case 'prepareCallHierarchy':
			case 'incomingCalls':
			case 'outgoingCalls': {
				const callHierarchyItems = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
					'vscode.prepareCallHierarchy',
					uri,
					targetPosition
				);

				if (!callHierarchyItems || callHierarchyItems.length === 0) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`No call hierarchy roots found at ${filePath}:${line}:${character}.`)
					]);
				}

				const root = callHierarchyItems[0];
				if (operation === 'prepareCallHierarchy') {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`### Call Hierarchy Root\n- Name: **${root.name}**\n- Kind: ${vscode.SymbolKind[root.kind]}\n- File: ${vscode.workspace.asRelativePath(root.uri)}:L${root.range.start.line + 1}`)
					]);
				} else if (operation === 'incomingCalls') {
					const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
						'vscode.provideIncomingCalls',
						root
					);
					if (!incoming || incoming.length === 0) {
						return new LanguageModelToolResult([
							new LanguageModelTextPart(`No incoming calls to '${root.name}'.`)
						]);
					}
					const list = incoming.map(inc => {
						return `- Called by **${inc.from.name}** (${vscode.workspace.asRelativePath(inc.from.uri)}:L${inc.from.range.start.line + 1})`;
					}).join('\n');
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`### Incoming Calls to '${root.name}' (${incoming.length} callers)\n${list}`)
					]);
				} else {
					const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
						'vscode.provideOutgoingCalls',
						root
					);
					if (!outgoing || outgoing.length === 0) {
						return new LanguageModelToolResult([
							new LanguageModelTextPart(`No outgoing calls from '${root.name}'.`)
						]);
					}
					const list = outgoing.map(out => {
						return `- Calls **${out.to.name}** (${vscode.workspace.asRelativePath(out.to.uri)}:L${out.to.range.start.line + 1})`;
					}).join('\n');
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`### Outgoing Calls from '${root.name}' (${outgoing.length} targets)\n${list}`)
					]);
				}
			}

			default:
				throw new Error(`Unsupported LSP operation: ${operation}`);
		}
	}
}

ToolRegistry.registerTool(LanguageServerProtocolTool);
