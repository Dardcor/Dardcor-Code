/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode } from 'web-tree-sitter';
import { Node, TreeSitterOffsetRange } from './nodes';
import { _parse } from './parserWithCaching';
import { _getNodeMatchingSelection } from './selectionParsing';
import { WASMLanguage } from './treeSitterLanguages';
import { extractIdentifier, isDocumentableNode, unwrapPythonDecoratedDefinition } from './util';


export type NodeToDocumentContext = {

	nodeIdentifier: string | undefined;

	nodeToDocument: Node;

	nodeSelectionBy: 'expanding' | 'matchingSelection';
};

export async function _getNodeToDocument(
	language: WASMLanguage,
	source: string,
	selection: TreeSitterOffsetRange
): Promise<NodeToDocumentContext> {

	const treeRef = await _parse(language, source);

	try {


		const isSelectionEmpty = selection.startIndex === selection.endIndex;

		const selectionMatchedNode = isSelectionEmpty ? undefined : _getNodeMatchingSelection(treeRef.tree, selection, language);

		if (selectionMatchedNode) {
			const unwrapped = unwrapPythonDecoratedDefinition(selectionMatchedNode, language);
			const nodeIdentifier = extractIdentifier(unwrapped, language);
			return {
				nodeIdentifier,
				nodeToDocument: Node.ofSyntaxNode(unwrapped),
				nodeSelectionBy: 'matchingSelection'
			};
		}

		const nodeContainingCursor = treeRef.tree.rootNode.descendantForIndex(selection.startIndex, selection.endIndex);

		let nodeToDocument: SyntaxNode = nodeContainingCursor;
		let nNodesClimbedUp = 0;

		while (!isDocumentableNode(nodeToDocument, language) && nodeToDocument.parent !== null) {
			nodeToDocument = nodeToDocument.parent;
			++nNodesClimbedUp;
		}

		nodeToDocument = unwrapPythonDecoratedDefinition(nodeToDocument, language);

		const nodeIdentifier = extractIdentifier(nodeToDocument, language);
		return {
			nodeIdentifier,
			nodeToDocument: Node.ofSyntaxNode(nodeToDocument),
			nodeSelectionBy: 'expanding',
		};
	} finally {
		treeRef.dispose();
	}
}

export async function _getDocumentableNodeIfOnIdentifier(
	language: WASMLanguage,
	source: string,
	range: TreeSitterOffsetRange
): Promise<{ identifier: string; nodeRange?: TreeSitterOffsetRange } | undefined> {
	const treeRef = await _parse(language, source);
	try {

		const smallestNodeContainingRange = treeRef.tree.rootNode.descendantForIndex(range.startIndex, range.endIndex);

		if (smallestNodeContainingRange.type.match(/identifier/) &&
			(smallestNodeContainingRange.parent === null || isDocumentableNode(smallestNodeContainingRange.parent, language))
		) {
			const parent = smallestNodeContainingRange.parent === null
				? null
				: unwrapPythonDecoratedDefinition(smallestNodeContainingRange.parent, language);

			const parentNodeRange = parent === null
				? undefined
				: { startIndex: parent.startIndex, endIndex: parent.endIndex };

			return {
				identifier: smallestNodeContainingRange.text,
				nodeRange: parentNodeRange
			};
		}
	} finally {
		treeRef.dispose();
	}
}
