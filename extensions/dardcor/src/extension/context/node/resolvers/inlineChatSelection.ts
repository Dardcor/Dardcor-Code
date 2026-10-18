/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type * as vscode from 'vscode';
import { TextDocumentSnapshot } from '../../../../platform/editing/common/textDocumentSnapshot';
import { TreeSitterOffsetRange } from '../../../../platform/parser/node/nodes';
import { ITabsAndEditorsService } from '../../../../platform/tabs/common/tabsAndEditorsService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { ILanguage, getLanguage } from '../../../../util/common/languages';
import { findCell, findNotebook } from '../../../../util/common/notebooks';
import { Schemas } from '../../../../util/dardcor/base/common/network';
import { Position, Range } from '../../../../dardcorTypes';
import { CodeContextRegion, CodeContextTracker } from '../../../inlineChat/node/codeContextRegion';
import { IDocumentContext } from '../../../prompt/node/documentContext';

export function getSelectionAndCodeAroundSelection(
	document: TextDocumentSnapshot,
	selection: vscode.Range,
	range: vscode.Range,
	limitRange: vscode.Range,
	language: ILanguage,
	tracker: CodeContextTracker
): {
	language: ILanguage;
	above: CodeContextRegion;
	range: CodeContextRegion;
	below: CodeContextRegion;
} {

	if (range.start.line !== range.end.line && range.end.character === 0) {
		const lastLine = document.lineAt(range.end.line - 1);
		range = new Range(range.start, new Position(range.end.line - 1, lastLine.text.length));
	} else if (
		selection.end.character === 0
		&& selection.end.line !== selection.start.line
		&& (
			(range.start.line === selection.start.line
				&& range.start.character === 0
				&& range.end.line === selection.end.line
				&& range.end.character === document.lineAt(range.end.line).text.length
			)
			||
			(range.isEqual(selection))
		)
	) {
		const lastLine = document.lineAt(range.end.line - 1);
		range = new Range(range.start, new Position(range.end.line - 1, lastLine.text.length));
	}

	const rangeInfo = new CodeContextRegion(tracker, document, language);
	const aboveInfo = new CodeContextRegion(tracker, document, language);
	const belowInfo = new CodeContextRegion(tracker, document, language);

	const finish = () => {
		aboveInfo.trim();
		rangeInfo.trim(selection);
		belowInfo.trim();

		return { language, above: aboveInfo, range: rangeInfo, below: belowInfo };
	};

	for (let lineIndex = range.end.line; lineIndex >= range.start.line; lineIndex--) {
		if (!rangeInfo.prependLine(lineIndex)) {
			return finish();
		}
	}

	const constraints = {
		aboveLineIndex: range.start.line - 1,
		belowLineIndex: range.end.line + 1,
		minimumLineIndex: Math.max(0, limitRange.start.line),
		maximumLineIndex: Math.min(document.lineCount - 1, limitRange.end.line)
	};

	processCodeAroundSelection(constraints, aboveInfo, belowInfo);

	return finish();
}

export function processCodeAroundSelection(
	constraints: { aboveLineIndex: number; belowLineIndex: number; minimumLineIndex: number; maximumLineIndex: number },
	aboveInfo: CodeContextRegion,
	belowInfo: CodeContextRegion
) {

	let aboveLineIndex = constraints.aboveLineIndex;
	let canGoAbove = true;
	let belowLineIndex = constraints.belowLineIndex;
	let canGoBelow = true;
	for (let step = 0; step < 100 && (canGoAbove || canGoBelow); step++) {
		const goBelow = !canGoAbove || (canGoBelow && step % 4 === 3);

		if (goBelow) {
			if (belowLineIndex <= constraints.maximumLineIndex && belowInfo.appendLine(belowLineIndex)) {
				belowLineIndex++;
			} else {
				canGoBelow = false;
			}
		} else {
			if (aboveLineIndex >= constraints.minimumLineIndex && aboveInfo.prependLine(aboveLineIndex)) {
				aboveLineIndex--;
			} else {
				canGoAbove = false;
			}
		}
	}
	aboveInfo.isComplete = aboveLineIndex < constraints.minimumLineIndex;
	belowInfo.isComplete = belowLineIndex > constraints.maximumLineIndex;
}

export function removeBodiesOutsideRange(
	src: string,
	functionBodies: TreeSitterOffsetRange[],
	rangeToMaintain: { startOffset: number; endOffset: number },
	replaceBodyWith: string
): { outlineAbove: string; outlineBelow: string } {

	let lastOffsetAbove = 0;
	let outlineAbove = '';

	let lastOffsetBelow = rangeToMaintain.endOffset;
	let outlineBelow = '';

	for (const rangeToDelete of functionBodies) {
		if (rangeToDelete.endIndex < rangeToMaintain.startOffset) {

			outlineAbove += src.substring(lastOffsetAbove, rangeToDelete.startIndex);
			outlineAbove += replaceBodyWith;
			lastOffsetAbove = rangeToDelete.endIndex;
		} else if (rangeToDelete.startIndex > rangeToMaintain.endOffset) {

			outlineBelow += src.substring(lastOffsetBelow, rangeToDelete.startIndex);
			outlineBelow += replaceBodyWith;
			lastOffsetBelow = rangeToDelete.endIndex;
		} else {
			continue;
		}
	}

	outlineAbove += src.substring(lastOffsetAbove, rangeToMaintain.startOffset);
	outlineBelow += src.substring(lastOffsetBelow, src.length);

	return { outlineAbove, outlineBelow };
}

export function generateNotebookCellContext(
	tabAndEditorService: ITabsAndEditorsService,
	workspaceService: IWorkspaceService,
	documentContext: IDocumentContext,
	initialContext: { language: ILanguage; above: CodeContextRegion; range: CodeContextRegion; below: CodeContextRegion },
	initialTracker: CodeContextTracker
): {
	language: ILanguage;
	aboveCells: CodeContextRegion[];
	belowCells: CodeContextRegion[];
} {
	const emptyContext = {
		...initialContext,
		aboveCells: [],
		belowCells: [],
	};
	let notebook: vscode.NotebookDocument | undefined;
	let aboveCellIndex: number | undefined;
	let belowCellIndex: number | undefined;

	if (documentContext.document.uri.scheme === Schemas.vscodeNotebookCell) {
		notebook = findNotebook(documentContext.document.uri, workspaceService.notebookDocuments);

		const cellIndex = notebook && findCell(documentContext.document.uri, notebook)?.index;

		if (cellIndex === undefined || cellIndex === -1) {
			return emptyContext;
		}

		aboveCellIndex = cellIndex - 1;
		belowCellIndex = cellIndex + 1;
	} else {
		if (tabAndEditorService.activeNotebookEditor?.notebook.uri.path !== documentContext.document.uri.path) {
			return emptyContext;
		}

		const notebookEditor = tabAndEditorService.activeNotebookEditor;
		notebook = notebookEditor?.notebook;
		const insertIndex = notebookEditor.selection.start;
		aboveCellIndex = insertIndex - 1;
		belowCellIndex = insertIndex;
	}

	if (!notebook) {
		return emptyContext;
	}

	const { language, above: aboveInfo, range: rangeInfo, below: belowInfo } = initialContext;
	const usedSteps = aboveInfo.lines.length + rangeInfo.lines.length + belowInfo.lines.length;
	const aboveCells: CodeContextRegion[] = [];
	const belowCells: CodeContextRegion[] = [];

	const finish = () => {
		aboveCells.forEach(cell => cell.trim());
		belowCells.forEach(cell => cell.trim());

		return {
			language,
			aboveCells,
			belowCells,
		};
	};

	let canGoAboveCell = true;
	let canGoBelowCell = true;

	for (let step = usedSteps; step < 100 && (canGoAboveCell || canGoBelowCell); step++) {
		if (canGoAboveCell) {
			if (aboveCellIndex >= 0) {
				const cell = notebook.cellAt(aboveCellIndex);
				const _cellDocument = cell.document;
				const cellDocument = TextDocumentSnapshot.create(_cellDocument);
				const cellContextRegion = new CodeContextRegion(
					initialTracker,
					cellDocument,
					getLanguage(cellDocument)
				);
				for (let i = 0; i < cellDocument.lineCount; i++) {
					cellContextRegion.appendLine(i);
				}
				aboveCells.unshift(cellContextRegion);

				aboveCellIndex--;
			} else {
				canGoAboveCell = false;
			}
		} else {
			if (belowCellIndex < notebook.cellCount) {
				const cell = notebook.cellAt(belowCellIndex);
				const _cellDocument = cell.document;
				const cellDocument = TextDocumentSnapshot.create(_cellDocument);

				const cellContextRegion = new CodeContextRegion(
					initialTracker,
					cellDocument,
					getLanguage(cellDocument)
				);
				for (let i = 0; i < cellDocument.lineCount; i++) {
					cellContextRegion.appendLine(i);
				}
				belowCells.push(cellContextRegion);

				belowCellIndex++;
			} else {
				canGoBelowCell = false;
			}
		}
	}

	return finish();
}
