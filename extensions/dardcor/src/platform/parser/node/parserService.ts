/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { Range } from '../../../dardcorTypes';
import { TextDocumentSnapshot } from '../../editing/common/textDocumentSnapshot';
import { BlockNameDetail, DetailBlock, QueryMatchTree } from './chunkGroupTypes';
import { OverlayNode, TreeSitterExpressionInfo, TreeSitterOffsetRange, TreeSitterPointRange } from './nodes';
import type * as parser from './parserImpl';
import { WASMLanguage } from './treeSitterLanguages';

export const IParserService = createServiceIdentifier<IParserService>('IParserService');

export interface TreeSitterAST {
	getFunctionBodies(): Promise<TreeSitterOffsetRange[]>;
	getCoarseParentScope(range: TreeSitterPointRange): Promise<TreeSitterPointRange>;
	getFixSelectionOfInterest(range: TreeSitterPointRange, maxNumberOfLines: number): Promise<TreeSitterPointRange>;
	getCallExpressions(selection: TreeSitterOffsetRange): Promise<TreeSitterExpressionInfo[]>;
	getFunctionDefinitions(): Promise<TreeSitterExpressionInfo[]>;
	getClassReferences(selection: TreeSitterOffsetRange): Promise<TreeSitterExpressionInfo[]>;
	getClassDeclarations(): Promise<TreeSitterExpressionInfo[]>;
	getTypeDeclarations(): Promise<TreeSitterExpressionInfo[]>;
	getTypeReferences(selection: TreeSitterOffsetRange): Promise<TreeSitterExpressionInfo[]>;
	getSymbols(range: TreeSitterOffsetRange): Promise<TreeSitterExpressionInfo[]>;
	getDocumentableNodeIfOnIdentifier(range: TreeSitterOffsetRange): Promise<{ identifier: string; nodeRange?: TreeSitterOffsetRange } | undefined>;
	getNodeToDocument(range: TreeSitterOffsetRange): Promise<parser.NodeToDocumentContext>;
	getNodeToExplain(range: TreeSitterOffsetRange): Promise<parser.NodeToExplainContext | undefined>;
	getFineScopes(range: TreeSitterOffsetRange): Promise<TreeSitterOffsetRange[] | undefined>;

	getStructure(): Promise<OverlayNode | undefined>;

	findLastTest(): Promise<TreeSitterOffsetRange | null>;

	getParseErrorCount(): Promise<number>;
}

export interface IParserService {

	readonly _serviceBrand: undefined;

	getTreeSitterAST(document: { readonly languageId: string; getText(): string }): TreeSitterAST | undefined;

	getTreeSitterASTForWASMLanguage(language: WASMLanguage, source: string): TreeSitterAST;

	getSemanticChunkTree(language: WASMLanguage, source: string): Promise<QueryMatchTree<DetailBlock>>;
	getSemanticChunkNames(language: WASMLanguage, source: string): Promise<QueryMatchTree<BlockNameDetail>>;

}

export class ParserWorkerTimeoutError extends Error {
	constructor() {
		super('Parser worker call timed out');
		this.name = 'ParserWorkerTimeoutError';
	}
}

export function vscodeToTreeSitterRange(range: vscode.Range): TreeSitterPointRange {
	return {
		startPosition: { row: range.start.line, column: range.start.character },
		endPosition: { row: range.end.line, column: range.end.character }
	};
}

export function treeSitterToVSCodeRange(range: TreeSitterPointRange): Range {
	return new Range(
		range.startPosition.row, range.startPosition.column,
		range.endPosition.row, range.endPosition.column
	);
}

export function vscodeToTreeSitterOffsetRange(range: Range, document: TextDocumentSnapshot): TreeSitterOffsetRange {
	return {
		startIndex: document.offsetAt(range.start),
		endIndex: document.offsetAt(range.end)
	};
}

export function treeSitterOffsetRangeToVSCodeRange(document: TextDocumentSnapshot, range: TreeSitterOffsetRange): vscode.Range {
	return new Range(document.positionAt(range.startIndex), document.positionAt(range.endIndex));
}

export type NodeToDocumentContext = parser.NodeToDocumentContext;
