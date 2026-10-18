/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { validate, getHtmlFlatNode, offsetRangeToSelection } from './util';
import { getRootNode } from './parseDocument';
import { HtmlNode as HtmlFlatNode } from 'EmmetFlatNode';

export function matchTag() {
	if (!validate(false) || !vscode.window.activeTextEditor) {
		return;
	}

	const editor = vscode.window.activeTextEditor;
	const document = editor.document;
	const rootNode = <HtmlFlatNode>getRootNode(document, true);
	if (!rootNode) {
		return;
	}

	const updatedSelections: vscode.Selection[] = [];
	editor.selections.forEach(selection => {
		const updatedSelection = getUpdatedSelections(document, rootNode, selection.start);
		if (updatedSelection) {
			updatedSelections.push(updatedSelection);
		}
	});
	if (updatedSelections.length) {
		editor.selections = updatedSelections;
		editor.revealRange(editor.selections[updatedSelections.length - 1]);
	}
}

function getUpdatedSelections(document: vscode.TextDocument, rootNode: HtmlFlatNode, position: vscode.Position): vscode.Selection | undefined {
	const offset = document.offsetAt(position);
	const currentNode = getHtmlFlatNode(document.getText(), rootNode, offset, true);
	if (!currentNode) {
		return;
	}

	if (!currentNode.open
		|| !currentNode.close
		|| (offset > currentNode.open.end && offset < currentNode.close.start)) {
		return;
	}

	const finalOffset = (offset <= currentNode.open.end) ? currentNode.close.start + 2 : currentNode.start + 1;
	return offsetRangeToSelection(document, finalOffset, finalOffset);
}
