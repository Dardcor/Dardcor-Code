/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyntaxNode, Tree } from 'web-tree-sitter';
import { max } from '../../../util/common/arrays';
import { TreeSitterOffsetRange } from './nodes';
import { WASMLanguage } from './treeSitterLanguages';
import { isDocumentableNode } from './util';

export function _getNodeMatchingSelection(parseTree: Tree, containerRange: TreeSitterOffsetRange, language: WASMLanguage, match: (node: SyntaxNode, language: WASMLanguage) => RegExpMatchArray | null = isDocumentableNode): SyntaxNode | undefined {

	let frontier = [parseTree.rootNode];

	const documentableNodes: [SyntaxNode, number][] = [];

	while (true) {
		const candidates = frontier
			.map((node): [SyntaxNode, number] => [node, TreeSitterOffsetRange.intersectionSize(node, containerRange)])
			.filter(([_, s]) => s > 0)
			.sort(([_, s0], [__, s1]) => s1 - s0);

		if (candidates.length === 0) {
			return documentableNodes.length === 0
				? undefined
				: max(documentableNodes, ([_, s0], [__, s1]) => s0 - s1)![0];
		} else {
			const reweighedCandidates = candidates
				.map(([n, overlapSize]): [SyntaxNode, number] => {
					const nLen = TreeSitterOffsetRange.len(n);
					const nonOverlappingSize = Math.abs(TreeSitterOffsetRange.len(containerRange) - overlapSize);
					const penalizedWeigth = overlapSize - nonOverlappingSize;
					const normalizedPenalizedWeight = penalizedWeigth / nLen;
					return [n, normalizedPenalizedWeight];
				});

			documentableNodes.push(...reweighedCandidates.filter(([node, _]) => match(node, language)));

			frontier = [];
			frontier.push(...reweighedCandidates.flatMap(([n, s]) => n.children));
		}
	}
}
