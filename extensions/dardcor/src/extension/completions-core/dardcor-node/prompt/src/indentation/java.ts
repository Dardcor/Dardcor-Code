/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IndentationTree, isBlank } from './classes';
import { visitTree } from './manipulation';
import {
	LabelRule,
	buildLabelRules,
	combineClosersAndOpeners,
	flattenVirtual,
	labelLines,
	labelVirtualInherited,
} from './parsing';

const _javaLabelRules = {
	package: /^package /,
	import: /^import /,
	class: /\bclass /,
	interface: /\binterface /,
	javadoc: /^\/\*\*/,
	comment_multi: /^\/\*[^*]/,
	comment_single: /^\/\//,
	annotation: /^@/,
	opener: /^[[({]/,
	closer: /^[\])}]/,
} as const;
const javaLabelRules: LabelRule<string>[] = buildLabelRules(_javaLabelRules);

export function processJava<L>(originalTree: IndentationTree<L>): IndentationTree<L | string> {
	let tree = originalTree as IndentationTree<L | string>;
	labelLines(tree, javaLabelRules);
	tree = combineClosersAndOpeners(tree);
	tree = flattenVirtual(tree);
	labelVirtualInherited(tree);
	visitTree(
		tree,
		(tree: IndentationTree<L | string>) => {
			if (tree.label === 'class' || tree.label === 'interface') {
				for (const sub of tree.subs) {
					if (!isBlank(sub) && (sub.label === undefined || sub.label === 'annotation')) {
						sub.label = 'member';
					}
				}
			}
		},
		'bottomUp'
	);
	return tree;
}
