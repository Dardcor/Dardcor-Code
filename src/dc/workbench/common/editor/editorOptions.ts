/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRange } from '../../../editor/common/core/range.js';
import { ICodeEditorViewState, IDiffEditorViewState, IEditor, ScrollType } from '../../../editor/common/editorCommon.js';
import { ITextEditorOptions, TextEditorSelectionRevealType, TextEditorSelectionSource } from '../../../platform/editor/common/editor.js';
import { isTextEditorViewState } from '../editor.js';

export function applyTextEditorOptions(options: ITextEditorOptions, editor: IEditor, scrollType: ScrollType): boolean {
	let applied = false;

	const viewState = massageEditorViewState(options);
	if (isTextEditorViewState(viewState)) {
		editor.restoreViewState(viewState);

		applied = true;
	}

	if (options.selection) {
		const range: IRange = {
			startLineNumber: options.selection.startLineNumber,
			startColumn: options.selection.startColumn,
			endLineNumber: options.selection.endLineNumber ?? options.selection.startLineNumber,
			endColumn: options.selection.endColumn ?? options.selection.startColumn
		};

		editor.setSelection(range, options.selectionSource ?? TextEditorSelectionSource.NAVIGATION);

		if (options.selectionRevealType === TextEditorSelectionRevealType.NearTop) {
			editor.revealRangeNearTop(range, scrollType);
		} else if (options.selectionRevealType === TextEditorSelectionRevealType.NearTopIfOutsideViewport) {
			editor.revealRangeNearTopIfOutsideViewport(range, scrollType);
		} else if (options.selectionRevealType === TextEditorSelectionRevealType.CenterIfOutsideViewport) {
			editor.revealRangeInCenterIfOutsideViewport(range, scrollType);
		} else {
			editor.revealRangeInCenter(range, scrollType);
		}

		applied = true;
	}

	return applied;
}

function massageEditorViewState(options: ITextEditorOptions): object | undefined {

	if (!options.selection || !options.viewState) {
		return options.viewState;
	}

	const candidateDiffViewState = options.viewState as IDiffEditorViewState;
	if (candidateDiffViewState.modified) {
		candidateDiffViewState.modified.cursorState = [];

		return candidateDiffViewState;
	}

	const candidateEditorViewState = options.viewState as ICodeEditorViewState;
	if (candidateEditorViewState.cursorState) {
		candidateEditorViewState.cursorState = [];
	}

	return candidateEditorViewState;
}
