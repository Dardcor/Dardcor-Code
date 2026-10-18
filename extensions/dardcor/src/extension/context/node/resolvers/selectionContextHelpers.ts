/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { VsCodeTextDocument } from '../../../../platform/editing/common/abstractText';
import { TextDocumentSnapshot } from '../../../../platform/editing/common/textDocumentSnapshot';
import { ILanguageFeaturesService, isLocationLink } from '../../../../platform/languages/common/languageFeaturesService';
import { ILogService } from '../../../../platform/log/common/logService';
import { getStructureUsingIndentation } from '../../../../platform/parser/node/indentationStructure';
import { TreeSitterExpressionInfo } from '../../../../platform/parser/node/nodes';
import { IParserService, ParserWorkerTimeoutError, vscodeToTreeSitterOffsetRange } from '../../../../platform/parser/node/parserService';
import { TreeSitterUnknownLanguageError } from '../../../../platform/parser/node/treeSitterLanguages';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { ILanguage } from '../../../../util/common/languages';

export async function findAllReferencedFunctionImplementationsInSelection(
	parserService: IParserService,
	logService: ILogService,
	telemetryService: ITelemetryService,
	languageFeaturesService: ILanguageFeaturesService,
	workspaceService: IWorkspaceService,
	document: TextDocumentSnapshot,
	selection: vscode.Range,
	timeoutMs: number
) {
	const currentDocAST = parserService.getTreeSitterAST(document);
	if (!currentDocAST) {
		return [];
	}

	const treeSitterOffsetRange = vscodeToTreeSitterOffsetRange(selection, document);
	const callExprs = await asyncComputeWithTimeBudget(logService, telemetryService, document, timeoutMs, () => currentDocAST.getCallExpressions(treeSitterOffsetRange), []);

	async function findImplementation(callExpr: TreeSitterExpressionInfo) {
		const position = document.positionAt(callExpr.startIndex);
		try {
			const impls = await languageFeaturesService.getImplementations(document.uri, position);
			if (impls.length) {
				return impls;
			}
			return await languageFeaturesService.getDefinitions(document.uri, position);
		} catch {
			return [];
		}
	}

	const implementations = await asyncComputeWithTimeBudget(
		logService,
		telemetryService,
		document,
		timeoutMs * 3,
		() => Promise.all(callExprs.map(findImplementation)),
		[]
	);

	const functionImplementations = [];
	for (let i = 0; i < implementations.length; i++) {
		const callExpr = callExprs[i];
		const impl = implementations[i];
		for (const link of impl) {
			const { uri, range } = isLocationLink(link) ? { uri: link.targetUri, range: link.targetRange } : link;
			const textDocument = await workspaceService.openTextDocumentAndSnapshot(uri);
			const treeSitterAST = parserService.getTreeSitterAST(textDocument);
			if (treeSitterAST) {
				const functionDefinitions = await treeSitterAST.getFunctionDefinitions();
				const functionDefinition = functionDefinitions.find((fn) => fn.identifier === callExpr.identifier);
				if (functionDefinition) {
					const treeSitterRange = vscodeToTreeSitterOffsetRange(range, textDocument);
					functionImplementations.push({
						uri,
						range,
						version: textDocument.version,
						identifier: callExpr.identifier,
						startIndex: treeSitterRange.startIndex,
						endIndex: treeSitterRange.endIndex,
						text: functionDefinition.text,
					});
				}
			}
		}
	}
	if (functionImplementations.length !== 0) {
		return functionImplementations;
	}

	const allFunctions = await asyncComputeWithTimeBudget(logService, telemetryService, document, timeoutMs, () => currentDocAST.getFunctionDefinitions(), []);

	const allFunctionImplementations: TreeSitterExpressionInfo[] = [];
	for (const fn of allFunctions) {
		for (const callExpr of callExprs) {
			if (fn.identifier === callExpr.identifier) {
				allFunctionImplementations.push(fn);
			}
		}
	}

	return allFunctionImplementations.sort((a, b) => a.startIndex - b.startIndex);
}

export async function findAllReferencedClassDeclarationsInSelection(
	parserService: IParserService,
	logService: ILogService,
	telemetryService: ITelemetryService,
	languageFeaturesService: ILanguageFeaturesService,
	workspaceService: IWorkspaceService,
	document: TextDocumentSnapshot,
	selection: vscode.Range,
	timeoutMs: number
) {
	const currentDocAST = parserService.getTreeSitterAST(document);
	if (!currentDocAST) {
		return [];
	}

	const treeSitterOffsetRange = vscodeToTreeSitterOffsetRange(selection, document);
	const matches = await asyncComputeWithTimeBudget(logService, telemetryService, document, timeoutMs, () => currentDocAST.getClassReferences(treeSitterOffsetRange), []);

	const implementations = await asyncComputeWithTimeBudget(
		logService,
		telemetryService,
		document,
		timeoutMs * 3,
		async () => await Promise.all(matches.map(async (match) => {
			try {
				const position = document.positionAt(match.startIndex);
				const impls = await languageFeaturesService.getImplementations(document.uri, position);
				if (impls.length) {
					return impls;
				}
				return await languageFeaturesService.getDefinitions(document.uri, position);
			} catch {
				return [];
			}
		})),
		[]
	);
	const classDeclarations = [];
	for (let i = 0; i < implementations.length; i++) {
		const match = matches[i];
		const impl = implementations[i];
		for (const link of impl) {
			const { uri, range } = isLocationLink(link) ? { uri: link.targetUri, range: link.targetRange } : link;
			const textDocument = await workspaceService.openTextDocumentAndSnapshot(uri);
			const treeSitterAST = parserService.getTreeSitterAST(textDocument);
			if (treeSitterAST) {
				const classDeclaration = (await treeSitterAST.getClassDeclarations()).find((fn) => fn.identifier === match.identifier);
				if (classDeclaration) {
					const treeSitterRange = vscodeToTreeSitterOffsetRange(range, textDocument);
					classDeclarations.push({
						uri,
						range,
						version: textDocument.version,
						identifier: match.identifier,
						startIndex: treeSitterRange.startIndex,
						endIndex: treeSitterRange.endIndex,
						text: classDeclaration.text,
					});
				}
			}
		}
	}
	if (classDeclarations.length !== 0) {
		return classDeclarations;
	}

	const allClasses = await asyncComputeWithTimeBudget(logService, telemetryService, document, timeoutMs, () => currentDocAST.getClassDeclarations(), []);

	const allClassDeclarations: TreeSitterExpressionInfo[] = [];
	for (const fn of allClasses) {
		for (const match of matches) {
			if (fn.identifier === match.identifier) {
				allClassDeclarations.push(fn);
			}
		}
	}

	return allClassDeclarations.sort((a, b) => a.startIndex - b.startIndex);
}

export async function findAllReferencedTypeDeclarationsInSelection(
	parserService: IParserService,
	logService: ILogService,
	telemetryService: ITelemetryService,
	_languageFeaturesService: ILanguageFeaturesService,
	_workspaceService: IWorkspaceService,
	document: TextDocumentSnapshot,
	selection: vscode.Range,
	timeoutMs: number
) {
	const currentDocAST = parserService.getTreeSitterAST(document);
	if (!currentDocAST) {
		return [];
	}

	const treeSitterOffsetRange = vscodeToTreeSitterOffsetRange(selection, document);
	const matches = await asyncComputeWithTimeBudget(logService, telemetryService, document, timeoutMs, () => currentDocAST.getTypeReferences(treeSitterOffsetRange), []);

	const allFunctions = await asyncComputeWithTimeBudget(logService, telemetryService, document, timeoutMs, () => currentDocAST.getTypeDeclarations(), []);

	const allTypeDeclarations: TreeSitterExpressionInfo[] = [];
	for (const fn of allFunctions) {
		for (const match of matches) {
			if (fn.identifier === match.identifier) {
				allTypeDeclarations.push(fn);
			}
		}
	}

	return allTypeDeclarations.sort((a, b) => a.startIndex - b.startIndex);
}

function raceWithTimeout<T>(
	executor: Promise<T>,
	timeoutMs: number
): Promise<{ type: 'success'; value: T } | { type: 'timeout' }> {
	if (timeoutMs === 0) {
		return executor.then(value => ({ type: 'success', value }));
	}

	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
		executor
			.then(value => {
				clearTimeout(timeoutId);
				resolve({ type: 'success', value });
			})
			.catch(err => {
				clearTimeout(timeoutId);
				reject(err);
			});
	});
}

export async function asyncComputeWithTimeBudget<T>(
	logService: ILogService,
	telemetryService: ITelemetryService,
	document: TextDocumentSnapshot,
	timeoutMs: number,
	computation: () => Promise<T>,
	defaultValue: T
): Promise<T> {
	try {
		const functionPositionsResult = await raceWithTimeout(
			asyncComputeWithValidDocumentVersion(document, computation, defaultValue),
			timeoutMs
		);

		if (functionPositionsResult.type === 'success') {
			return functionPositionsResult.value;
		} else {
			logService.warn(`Computing async parser based result took longer than ${timeoutMs}ms`);
			return defaultValue;
		}
	} catch (err) {
		if (!(err instanceof TreeSitterUnknownLanguageError)) {
			logService.error(err, `Failed to compute async parser based result`);
			telemetryService.sendGHTelemetryException(err, 'Failed to compute async parser based result');
		}
		return defaultValue;
	}
}

async function asyncComputeWithValidDocumentVersion<T>(
	document: TextDocumentSnapshot,
	computation: () => Promise<T>,
	defaultValue: T,
	attempt = 0
): Promise<T> {
	const version = document.version;
	const positions = await computation();
	if (document.version !== version) {
		if (attempt < 3) {
			return asyncComputeWithValidDocumentVersion(document, computation, defaultValue, attempt + 1);
		}
		return defaultValue;
	}
	return positions;
}

export class FilePathCodeMarker {

	public static forDocument(language: ILanguage, document: TextDocumentSnapshot): string {
		return this.forUri(language, document.uri);
	}

	public static forUri(language: ILanguage, uri: vscode.Uri): string {
		return `${this.forLanguage(language)}: ${uri.path}`;
	}

	public static forLanguage(language: ILanguage): string {
		return `${language.lineComment.start} FILEPATH`;
	}

	public static testLine(language: ILanguage, code: string): boolean {
		const filenameMarker = FilePathCodeMarker.forLanguage(language);
		return code.trimStart().startsWith(filenameMarker);
	}

}

export async function getStructure(parserService: IParserService, document: TextDocumentSnapshot, formattingOptions: vscode.FormattingOptions | undefined) {
	const currentDocAST = parserService.getTreeSitterAST(document);
	if (currentDocAST) {
		try {
			const result = await currentDocAST.getStructure();
			if (result) {
				return result;
			}
		} catch (e) {
			if (!(e instanceof ParserWorkerTimeoutError)) {
				throw e;
			}
		}
	}
	return getStructureUsingIndentation(new VsCodeTextDocument(document), document.languageId, formattingOptions);
}
