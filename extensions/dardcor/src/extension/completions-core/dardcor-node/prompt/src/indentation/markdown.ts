/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IndentationTree, isBlank, LineNode, TopNode, VirtualNode } from './classes';
import {
	buildLabelRules,
	flattenVirtual,
	groupBlocks,
	labelLines,
	LabelRule,
	labelVirtualInherited,
} from './parsing';

const _MarkdownLabelRules = {
	heading: /^# /,
	subheading: /^## /,
	subsubheading: /### /,
} as const;
const MarkdownLabelRules: LabelRule<string>[] = buildLabelRules(_MarkdownLabelRules);

export function processMarkdown<L>(originalTree: IndentationTree<L>): IndentationTree<L | string> {
	let tree = originalTree as IndentationTree<L | string>;
	labelLines(tree, MarkdownLabelRules);

	if (isBlank(tree)) {
		return tree;
	}

	function headingLevel(sub: IndentationTree<L | string>): number | undefined {
		if (sub.label === 'heading') { return 1; }
		if (sub.label === 'subheading') { return 2; }
		if (sub.label === 'subsubheading') { return 3; }
		return undefined;
	}
	const currentHierarchy: (TopNode<L | string> | LineNode<L | string> | VirtualNode<L | string>)[] = [tree];
	const oldTreeSubs = [...tree.subs];
	tree.subs = [];
	for (const sub of oldTreeSubs) {
		const level = headingLevel(sub);
		if (level === undefined || isBlank(sub)) {
			currentHierarchy[currentHierarchy.length - 1].subs.push(sub);
		} else {
			while (currentHierarchy.length < level) {
				currentHierarchy.push(currentHierarchy[currentHierarchy.length - 1]);
			}
			currentHierarchy[level - 1].subs.push(sub);
			currentHierarchy[level] = sub;
			while (currentHierarchy.length > level + 1) {
				currentHierarchy.pop();
			}
		}
	}

	tree = groupBlocks(tree);
	tree = flattenVirtual(tree);
	labelVirtualInherited(tree);

	return tree;
}
