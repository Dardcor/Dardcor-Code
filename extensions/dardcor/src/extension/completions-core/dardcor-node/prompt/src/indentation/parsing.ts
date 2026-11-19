/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	blankNode,
	IndentationSubTree,
	IndentationTree,
	isBlank,
	isLine,
	isVirtual,
	lineNode,
	LineNode,
	TopNode,
	topNode,
	virtualNode,
	VirtualNode,
} from './classes';
import { clearLabelsIf, Rebuilder, rebuildTree, visitTree } from './manipulation';

export function parseRaw(source: string): IndentationTree<never> {
	const rawLines = source.split('\n');
	const indentations = rawLines.map(line => line.match(/^\s*/)![0].length);
	const lines = rawLines.map(line => line.trimLeft());
	function parseNode(line: number): [LineNode<never>, number] {
		const [subs, nextLine] = parseSubs(line + 1, indentations[line]);
		const node: LineNode<never> = lineNode(indentations[line], line, lines[line], subs);
		return [node, nextLine];
	}
	function parseSubs(initialLine: number, parentIndentation: number): [IndentationSubTree<never>[], number] {
		let sub: IndentationTree<never> | undefined;
		const subs: IndentationSubTree<never>[] = [];
		let line = initialLine;
		let lastBlank: number | undefined = undefined;
		while (line < lines.length && (lines[line] === '' || indentations[line] > parentIndentation)) {
			if (lines[line] === '') {
				if (lastBlank === undefined) {
					lastBlank = line;
				}
				line += 1;
			} else {
				if (lastBlank !== undefined) {
					for (let i = lastBlank; i < line; i++) {
						subs.push(blankNode(i));
					}
					lastBlank = undefined;
				}
				[sub, line] = parseNode(line);
				subs.push(sub);
			}
		}
		if (lastBlank !== undefined) {
			line = lastBlank;
		}
		return [subs, line];
	}
	const [subs, parsedLine] = parseSubs(0, -1);
	let line = parsedLine;
	while (line < lines.length && lines[line] === '') {
		subs.push(blankNode(line));
		line += 1;
	}
	if (line < lines.length) {
		throw new Error(`Parsing did not go to end of file. Ended at ${line} out of ${lines.length}`);
	}
	return topNode(subs);
}

type LineMatcher = (sourceLine: string) => boolean;
export interface LabelRule<L> {
	matches: LineMatcher;
	label: L | undefined;
}

export function labelLines<L>(tree: IndentationTree<L>, labelRules: LabelRule<L>[]): void {
	function visitor(tree: IndentationTree<L>): void {
		if (isLine(tree)) {
			const rule = labelRules.find(rule => rule.matches(tree.sourceLine));
			if (rule) {
				tree.label = rule.label;
			}
		}
	}
	visitTree(tree, visitor, 'bottomUp');
}

export function labelVirtualInherited<L>(tree: IndentationTree<L>): void {
	function visitor(tree: IndentationTree<L>): void {
		if (isVirtual(tree) && tree.label === undefined) {
			const subs = tree.subs.filter(sub => !isBlank(sub));
			if (subs.length === 1) {
				tree.label = subs[0].label;
			}
		}
	}
	visitTree(tree, visitor, 'bottomUp');
}

export function buildLabelRules<L extends { [key: string]: RegExp | LineMatcher }>(ruleMap: L): LabelRule<keyof L>[] {
	return (Object.keys(ruleMap) as (keyof L)[]).map(key => {
		let matches: (sourceLine: string) => boolean;
		if ((ruleMap[key] as RegExp).test) {
			matches = sourceLine => (ruleMap[key] as RegExp).test(sourceLine);
		} else {
			matches = ruleMap[key] as LineMatcher;
		}
		return {
			matches,
			label: key,
		};
	});
}

export function combineClosersAndOpeners<L>(
	tree: IndentationTree<L | 'opener' | 'closer'>
): IndentationTree<L | 'opener' | 'closer'> {
	type S = L | 'opener' | 'closer' | 'newVirtual';
	const rebuilder: Rebuilder<S> = function (tree: IndentationTree<S>) {
		if (
			tree.subs.length === 0 ||
			tree.subs.findIndex(sub => sub.label === 'closer' || sub.label === 'opener') === -1
		) {
			return tree;
		}
		const newSubs: IndentationSubTree<S>[] = [];
		let lastNew: TopNode<S> | VirtualNode<S> | LineNode<S> | undefined;
		for (let i = 0; i < tree.subs.length; i++) {
			const sub = tree.subs[i];
			const directOlderSibling = tree.subs[i - 1];
			if (sub.label === 'opener' && directOlderSibling !== undefined && isLine(directOlderSibling)) {
				directOlderSibling.subs.push(sub);
				sub.subs.forEach(sub => directOlderSibling.subs.push(sub));
				sub.subs = [];
			}
			else if (
				sub.label === 'closer' &&
				lastNew !== undefined &&
				(isLine(sub) || isVirtual(sub)) &&
				sub.indentation >= lastNew.indentation
			) {
				let j = newSubs.length - 1;
				while (j > 0 && isBlank(newSubs[j])) {
					j -= 1;
				}
				lastNew.subs.push(...newSubs.splice(j + 1));

				if (sub.subs.length > 0) {
					const firstNonVirtual = lastNew.subs.findIndex(sub => sub.label !== 'newVirtual');
					const subsToKeep = lastNew.subs.slice(0, firstNonVirtual);
					const subsToWrap = lastNew.subs.slice(firstNonVirtual);
					const wrappedSubs =
						subsToWrap.length > 0 ? [virtualNode(sub.indentation, subsToWrap, 'newVirtual')] : [];
					lastNew.subs = [...subsToKeep, ...wrappedSubs, sub];
				} else {
					lastNew.subs.push(sub);
				}
			} else {
				newSubs.push(sub);
				if (!isBlank(sub)) {
					lastNew = sub;
				}
			}
		}
		tree.subs = newSubs;
		return tree;
	};
	const returnTree = rebuildTree(tree, rebuilder);
	clearLabelsIf<S, 'newVirtual'>(tree, (arg: S): arg is 'newVirtual' => arg === 'newVirtual');
	return returnTree as IndentationTree<L | 'opener' | 'closer'>;
}

export function groupBlocks<L>(
	tree: IndentationTree<L>,
	isDelimiter: (node: IndentationTree<L>) => boolean = isBlank,
	label?: L
): IndentationTree<L> {
	const rebuilder: Rebuilder<L> = function (tree: IndentationTree<L>) {
		if (tree.subs.length <= 1) {
			return tree;
		}
		const newSubs: IndentationSubTree<L>[] = [];
		let nodesSinceLastFlush: IndentationSubTree<L>[] = [];
		let currentBlockIndentation: number | undefined;
		let lastNodeWasDelimiter = false;


		function flushBlockIntoNewSubs(
			final: boolean = false
		): void {
			if (currentBlockIndentation !== undefined && (newSubs.length > 0 || !final)) {
				const virtual = virtualNode(currentBlockIndentation, nodesSinceLastFlush, label);
				newSubs.push(virtual);
			} else {
				nodesSinceLastFlush.forEach(node => newSubs.push(node));
			}
		}

		for (let i = 0; i < tree.subs.length; i++) {
			const sub = tree.subs[i];
			const subIsDelimiter = isDelimiter(sub);
			if (!subIsDelimiter && lastNodeWasDelimiter) {
				flushBlockIntoNewSubs();
				nodesSinceLastFlush = [];
			}
			lastNodeWasDelimiter = subIsDelimiter;
			nodesSinceLastFlush.push(sub);
			if (!isBlank(sub)) {
				currentBlockIndentation = currentBlockIndentation ?? sub.indentation;
			}
		}

		flushBlockIntoNewSubs(true);
		tree.subs = newSubs;
		return tree;
	};
	return rebuildTree(tree, rebuilder);
}

export function flattenVirtual<L>(tree: IndentationTree<L>): IndentationTree<L> {
	const rebuilder: Rebuilder<L> = function (tree) {
		if (isVirtual(tree) && tree.label === undefined && tree.subs.length <= 1) {
			if (tree.subs.length === 0) {
				return undefined;
			} else {
				return tree.subs[0];
			}
		} else if (tree.subs.length === 1 && isVirtual(tree.subs[0]) && tree.subs[0].label === undefined) {
			tree.subs = tree.subs[0].subs;
		}
		return tree;
	};
	return rebuildTree(tree, rebuilder);
}

const _genericLabelRules = {
	opener: /^[[({]/,
	closer: /^[\])}]/,
} as const;
const genericLabelRules: LabelRule<'opener' | 'closer'>[] = buildLabelRules(_genericLabelRules);

const LANGUAGE_SPECIFIC_PARSERS: { [key: string]: (raw: IndentationTree<never>) => IndentationTree<string> } = {};
export function registerLanguageSpecificParser(
	language: string,
	parser: (raw: IndentationTree<never>) => IndentationTree<string>
): void {
	LANGUAGE_SPECIFIC_PARSERS[language] = parser;
}

export function parseTree(source: string, languageId?: string): IndentationTree<string> {
	const raw = parseRaw(source);
	const languageSpecificParser = LANGUAGE_SPECIFIC_PARSERS[languageId ?? ''];
	if (languageSpecificParser) {
		return languageSpecificParser(raw);
	} else {
		labelLines(raw, genericLabelRules);
		const processedTree = combineClosersAndOpeners(raw);
		return processedTree;
	}
}
