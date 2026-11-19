/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringText } from '../../../util/dardcor/editor/common/core/text/abstractText';

const continuations = [
	'\\{',
	'\\}',
	'\\[',
	'\\]',
	'\\(',
	'\\)',
].concat(
	[
		'then',
		'else',
		'elseif',
		'elif',
		'catch',
		'finally',
		'fi',
		'done',
		'end',
		'loop',
		'until',
		'where',
		'when',
	].map(s => s + '\\b')
);
const continuationRegex = new RegExp(`^(${continuations.join('|')})`);

function isContinuationLine(line: string) {
	return continuationRegex.test(line.trimLeft().toLowerCase());
}

function indentationOfLine(line: string): number | undefined {
	const match = /^(\s*)([^]*)$/.exec(line);
	if (match && match[2] && match[2].length > 0) {
		return match[1].length;
	} else {
		return undefined;
	}
}

export interface ContextIndentation {
	prev: number | undefined;
	current: number;
	next: number | undefined;
}

export function contextIndentation(doc: StringText, offset: number, languageId: string): ContextIndentation {
	return contextIndentationFromText(doc.value, offset, languageId);
}

export function contextIndentationFromText(source: string, offset: number, languageId: string): ContextIndentation {
	const prevLines = source.slice(0, offset).split('\n');
	const nextLines = source.slice(offset).split('\n');
	function seekNonBlank(lines: string[], start: number, direction: -1 | 1): [number | undefined, number | undefined] {
		let i = start;
		let ind,
			indIdx: number | undefined = undefined;
		while (ind === undefined && i >= 0 && i < lines.length) {
			ind = indentationOfLine(lines[i]);
			indIdx = i;
			i += direction;
		}
		if (languageId === 'python' && direction === -1) {

			i++;
			const trimmedLine = lines[i].trim();

			if (trimmedLine.endsWith(`"""`)) {
				const isSingleLineDocString = trimmedLine.startsWith(`"""`) && trimmedLine !== `"""`;
				if (!isSingleLineDocString) {
					i--;
					while (i >= 0 && !lines[i].trim().startsWith(`"""`)) {
						i--;
					}
				}
				if (i >= 0) {
					ind = undefined;
					i--;
					while (ind === undefined && i >= 0) {
						ind = indentationOfLine(lines[i]);
						indIdx = i;
						i--;
					}
				}
			}
		}
		return [ind, indIdx];
	}
	const [current, currentIdx] = seekNonBlank(prevLines, prevLines.length - 1, -1);
	const prev = (() => {
		if (current === undefined || currentIdx === undefined) {
			return undefined;
		}
		for (let i = currentIdx - 1; i >= 0; i--) {
			const ind = indentationOfLine(prevLines[i]);
			if (ind !== undefined && ind < current) {
				return ind;
			}
		}
	})();
	const [next] = seekNonBlank(nextLines, 1, 1);
	return {
		prev,
		current: current ?? 0,
		next,
	};
}

const OfferNextLineCompletion = false;

export function completionCutOrContinue(
	completion: string,
	contextIndentation: ContextIndentation,
	previewText: string | undefined
): number | 'continue' {
	const completionLines = completion.split('\n');
	const isContinuation = previewText !== undefined;
	const lastLineOfPreview = previewText?.split('\n').pop();
	let startLine = 0;
	if (isContinuation) {
		if (lastLineOfPreview?.trim() !== '' && completionLines[0].trim() !== '') {
			startLine++;
		}
	}
	if (!isContinuation && OfferNextLineCompletion && completionLines[0].trim() === '') {
		startLine++;
	}
	if (!isContinuation) {
		startLine++;
	}
	if (completionLines.length === startLine) {
		return 'continue';
	}
	const breakIndentation = Math.max(contextIndentation.current, contextIndentation.next ?? 0);
	for (let i = startLine; i < completionLines.length; i++) {
		let line = completionLines[i];
		if (i === 0 && lastLineOfPreview !== undefined) {
			line = lastLineOfPreview + line;
		}
		const ind = indentationOfLine(line);
		if (ind !== undefined && (ind < breakIndentation || (ind === breakIndentation && !isContinuationLine(line)))) {
			return completionLines.slice(0, i).join('\n').length;
		}
	}
	return 'continue';
}

export function indentationBlockFinished(
	contextIndentation: ContextIndentation,
	previewText: string | undefined
): (completion: string) => Promise<number | undefined> {
	return async (completion: string) => {
		const res = completionCutOrContinue(completion, contextIndentation, previewText);
		return res === 'continue' ? undefined : res;
	};
}
