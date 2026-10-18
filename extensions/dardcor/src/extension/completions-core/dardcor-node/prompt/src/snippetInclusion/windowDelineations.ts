/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IndentationTree } from '../indentation/classes';
import { clearLabels, visitTree } from '../indentation/manipulation';
import { parseTree } from '../indentation/parsing';

export function getBasicWindowDelineations(windowLength: number, lines: string[]): [number, number][] {
	const windows: [number, number][] = [];
	const length = lines.length;
	if (length === 0) {
		return [];
	}
	if (length < windowLength) {
		return [[0, length]];
	}
	for (let startLine = 0; startLine < length - windowLength + 1; startLine++) {
		windows.push([startLine, startLine + windowLength]);
	}
	return windows;
}

export function getIndentationWindowsDelineations(
	lines: string[],
	languageId: string,
	minLength: number,
	maxLength: number
): [number, number][] {
	if (lines.length < minLength || maxLength === 0) {
		return [];
	}

	const windows: [number, number][] = [];
	type TreeLabel = { totalLength: number; firstLineAfter: number };
	const labeledTree = clearLabels(parseTree(lines.join('\n'), languageId)) as IndentationTree<TreeLabel>;
	visitTree(
		labeledTree,
		node => {
			if (node.type === 'blank') {
				node.label = { totalLength: 1, firstLineAfter: node.lineNumber + 1 };
				return;
			}
			let totalLength = node.type === 'line' ? 1 : 0;
			let firstLineAfter = node.type === 'line' ? node.lineNumber + 1 : NaN;
			function getStartLine(a: number) {
				return a === -1
					? firstLineAfter - totalLength
					: node.subs[a].label!.firstLineAfter - node.subs[a].label!.totalLength;
			}
			function getEndLine(b: number, startLine: number) {
				return b === 0 ? startLine + 1 : node.subs[b - 1].label!.firstLineAfter;
			}
			let a = node.type === 'line' ? -1 : 0;
			let lengthFromAToBInclusive = node.type === 'line' ? 1 : 0;
			let lastBThatWasntABlank = 0;
			for (let b = 0; b < node.subs.length; b++) {
				while (a >= 0 && a < node.subs.length && node.subs[a].type === 'blank') {
					lengthFromAToBInclusive -= node.subs[a].label!.totalLength;
					a++;
				}
				if (node.subs[b].type !== 'blank') {
					lastBThatWasntABlank = b;
				}
				firstLineAfter = node.subs[b].label!.firstLineAfter;
				totalLength += node.subs[b].label!.totalLength;
				lengthFromAToBInclusive += node.subs[b].label!.totalLength;
				if (lengthFromAToBInclusive > maxLength) {
					const startLine = getStartLine(a);
					const endLine = getEndLine(b, startLine);
					const endLineTrimmedForBlanks =
						lastBThatWasntABlank === b ? endLine : getEndLine(lastBThatWasntABlank, startLine);
					if (minLength <= endLine - startLine) {
						windows.push([startLine, endLineTrimmedForBlanks]);
					}
					while (lengthFromAToBInclusive > maxLength) {
						lengthFromAToBInclusive -=
							a === -1
								? node.type === 'line'
									? 1
									:
									0
								: node.subs[a].label!.totalLength;
						a++;
					}
				}
			}
			if (a < node.subs.length) {
				const startLine = getStartLine(a);
				const endLine = firstLineAfter;
				const endLineTrimmedForBlanks =
					a === -1 ? endLine : node.subs[lastBThatWasntABlank].label!.firstLineAfter;
				if (minLength <= endLine - startLine) {
					windows.push([startLine, endLineTrimmedForBlanks]);
				}
			}
			node.label = { totalLength, firstLineAfter };
		},
		'bottomUp'
	);
	return windows
		.sort((a, b) => a[0] - b[0] || a[1] - b[1])
		.filter((a, i, arr) => i === 0 || a[0] !== arr[i - 1][0] || a[1] !== arr[i - 1][1]);
}
