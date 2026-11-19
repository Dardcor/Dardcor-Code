/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IndentationTree, isBlank, isLine, isTop, isVirtual, JsonStable, LineNode } from './classes';
import { foldTree } from './manipulation';

export function deparseLine<T>(node: LineNode<T>): string {
	return ' '.repeat(node.indentation) + node.sourceLine + '\n';
}

export function deparseTree<L>(tree: IndentationTree<L>): string {
	function accumulator(tree: IndentationTree<L>, accum: string): string {
		let str = '';
		if (isLine(tree)) {
			str = deparseLine(tree);
		} else if (isBlank(tree)) {
			str = '\n';
		}
		return accum + str;
	}
	return foldTree(tree, '', accumulator, 'topDown');
}

export function deparseAndCutTree<L>(tree: IndentationTree<L>, cutAt: L[]): { label: L | undefined; source: string }[] {
	const cutAtSet = new Set(cutAt);
	const cuts: { label: L | undefined; source: string }[] = [];
	let curUndef = '';
	function visit(tree: IndentationTree<L>) {
		if (tree.label !== undefined && cutAtSet.has(tree.label)) {
			if (curUndef !== '') {
				cuts.push({ label: undefined, source: curUndef });
			}
			cuts.push({
				label: tree.label,
				source: deparseTree(tree),
			});
			curUndef = '';
		} else {
			if (isLine(tree)) {
				curUndef += deparseLine(tree);
			}
			tree.subs.forEach(visit);
		}
	}
	visit(tree);
	if (curUndef !== '') {
		cuts.push({ label: undefined, source: curUndef });
	}
	return cuts;
}

export function describeTree<L>(tree: IndentationTree<L>, indent = 0): string {
	const ind = ' '.repeat(indent);
	if (tree === undefined) {
		return 'UNDEFINED NODE';
	}
	let children: string;
	if (tree.subs === undefined) {
		children = 'UNDEFINED SUBS';
	} else {
		children = tree.subs.map(child => describeTree(child, indent + 2)).join(',\n');
	}
	if (children === '') {
		children = '[]';
	} else {
		children = `[\n${children}\n      ${ind}]`;
	}
	const prefix = (isVirtual(tree) || isTop(tree) ? '   ' : String(tree.lineNumber).padStart(3, ' ')) + `:  ${ind}`;
	const labelString = tree.label === undefined ? '' : JSON.stringify(tree.label);
	if (isVirtual(tree) || isTop(tree)) {
		return `${prefix}vnode(${tree.indentation}, ${labelString}, ${children})`;
	} else if (isBlank(tree)) {
		return `${prefix}blank(${labelString ?? ''})`;
	} else {
		return `${prefix}lnode(${tree.indentation}, ${labelString}, ${JSON.stringify(tree.sourceLine)}, ${children})`;
	}
}

export function encodeTree<T extends JsonStable>(tree: IndentationTree<T>, indent = ''): string {
	const labelString = tree.label === undefined ? '' : `, ${JSON.stringify(tree.label)}`;

	const subString =
		!isBlank(tree) && tree.subs.length > 0
			? `[\n${tree.subs.map(node => encodeTree(node, indent + '  ')).join(', \n')}\n${indent}]`
			: '[]';

	switch (tree.type) {
		case 'blank':
			return `${indent}blankNode(${tree.lineNumber}${labelString})`;
		case 'top':
			return `topNode(${subString}${labelString})`;
		case 'virtual':
			return `${indent}virtualNode(${tree.indentation}, ${subString}${labelString})`;
		case 'line':
			return `${indent}lineNode(${tree.indentation}, ${tree.lineNumber}, "${tree.sourceLine}", ${subString}${labelString})`;
	}
}

export function firstLineOf<L>(tree: IndentationTree<L>): number | undefined {
	if (isLine(tree) || isBlank(tree)) {
		return tree.lineNumber;
	}
	for (const sub of tree.subs) {
		const firstLine = firstLineOf(sub);
		if (firstLine !== undefined) {
			return firstLine;
		}
	}
	return undefined;
}

export function lastLineOf<L>(tree: IndentationTree<L>): number | undefined {
	let lastLine: number | undefined = undefined;
	let i = tree.subs.length - 1;
	while (i >= 0 && lastLine === undefined) {
		lastLine = lastLineOf(tree.subs[i]);
		i--;
	}
	if (lastLine === undefined && !isVirtual(tree) && !isTop(tree)) {
		return tree.lineNumber;
	} else {
		return lastLine;
	}
}
