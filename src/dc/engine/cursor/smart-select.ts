import { ITextModel } from '../model/text-model.js';
import { Position } from '../model/position.js';
import { Selection } from '../model/selection.js';
import { CursorWord, DEFAULT_WORD_SEPARATORS } from './cursor-word.js';

const OPEN_TO_CLOSE: Record<string, string> = {
	'(': ')',
	'[': ']',
	'{': '}',
	'"': '"',
	"'": "'",
	'`': '`',
};

const CLOSE_TO_OPEN: Record<string, string> = {
	')': '(',
	']': '[',
	'}': '{',
	'"': '"',
	"'": "'",
	'`': '`',
};

function isOpenBracket(ch: string): boolean {
	return ch in OPEN_TO_CLOSE;
}

function isCloseBracket(ch: string): boolean {
	return ch in CLOSE_TO_OPEN;
}

function charAt(model: ITextModel, position: Position): string {
	const line = model.getLineContent(position.lineNumber);
	if (position.column < 1 || position.column > line.length) {
		return '';
	}
	return line.charAt(position.column - 1);
}

function charBefore(model: ITextModel, position: Position): string {
	if (position.column <= 1) {
		return '';
	}
	const line = model.getLineContent(position.lineNumber);
	return line.charAt(position.column - 2);
}

function findMatchingClose(model: ITextModel, open: Position, openChar: string): Position | null {
	const closeChar = OPEN_TO_CLOSE[openChar];
	if (!closeChar) {
		return null;
	}
	const sameCharPair = openChar === closeChar;
	const lineCount = model.getLineCount();
	let depth = 0;
	for (let line = open.lineNumber; line <= lineCount; line++) {
		const content = model.getLineContent(line);
		const startIndex = line === open.lineNumber ? open.column : 0;
		for (let i = startIndex; i < content.length; i++) {
			const ch = content.charAt(i);
			if (sameCharPair) {
				if (ch === openChar) {
					return new Position(line, i + 1);
				}
				continue;
			}
			if (ch === openChar) {
				depth++;
			} else if (ch === closeChar) {
				depth--;
				if (depth === 0) {
					return new Position(line, i + 1);
				}
			}
		}
	}
	return null;
}

function findEnclosingPair(model: ITextModel, start: Position, end: Position): { open: Position; close: Position } | null {
	for (let line = start.lineNumber; line >= 1; line--) {
		const content = model.getLineContent(line);
		const firstIndex = line === start.lineNumber ? start.column - 2 : content.length - 1;
		for (let i = firstIndex; i >= 0; i--) {
			const ch = content.charAt(i);
			if (!isOpenBracket(ch)) {
				continue;
			}
			const open = new Position(line, i + 1);
			const close = findMatchingClose(model, open, ch);
			if (close && Position.isAfterOrEqual(close, end)) {
				return { open, close };
			}
		}
	}
	return null;
}

function positionsDiffer(a: Position, b: Position): boolean {
	return a.lineNumber !== b.lineNumber || a.column !== b.column;
}

export class SmartSelect {
	static expand(model: ITextModel, selection: Selection): Selection | null {
		if (selection.isEmpty) {
			return SmartSelect._expandEmpty(model, selection.position);
		}
		const start = selection.start;
		const end = selection.end;
		const openBefore = charBefore(model, start);
		const closeAtEnd = charAt(model, end);
		if (isOpenBracket(openBefore) && OPEN_TO_CLOSE[openBefore] === closeAtEnd) {
			const match = findMatchingClose(model, new Position(start.lineNumber, start.column - 1), openBefore);
			if (match && match.lineNumber === end.lineNumber && match.column === end.column) {
				const candidate = new Selection(start.lineNumber, start.column - 1, end.lineNumber, end.column + 1);
				return candidate;
			}
		}
		const openAtStart = charAt(model, start);
		const closeBeforeEnd = charBefore(model, end);
		if (isOpenBracket(openAtStart) && OPEN_TO_CLOSE[openAtStart] === closeBeforeEnd) {
			const match = findMatchingClose(model, start, openAtStart);
			if (match && match.lineNumber === end.lineNumber && match.column === end.column - 1) {
				const candidate = new Selection(start.lineNumber, start.column + 1, end.lineNumber, end.column - 1);
				if (positionsDiffer(candidate.start, start) || positionsDiffer(candidate.end, end)) {
					return candidate;
				}
			}
		}
		const pair = findEnclosingPair(model, start, end);
		if (pair) {
			const candidate = new Selection(pair.open.lineNumber, pair.open.column + 1, pair.close.lineNumber, pair.close.column);
			if (positionsDiffer(candidate.start, start) || positionsDiffer(candidate.end, end)) {
				return candidate;
			}
		}
		const startLineLength = model.getLineContent(start.lineNumber).length;
		const endLineLength = model.getLineContent(end.lineNumber).length;
		if (start.lineNumber === end.lineNumber && start.column === 1 && end.column === startLineLength + 1) {
			return null;
		}
		const lineSelection = new Selection(start.lineNumber, 1, end.lineNumber, endLineLength + 1);
		if (positionsDiffer(lineSelection.start, start) || positionsDiffer(lineSelection.end, end)) {
			return lineSelection;
		}
		return null;
	}

	static shrink(model: ITextModel, selection: Selection): Selection | null {
		if (selection.isEmpty) {
			return null;
		}
		const start = selection.start;
		const end = selection.end;
		const startLineLength = model.getLineContent(start.lineNumber).length;
		const isFullLine = start.column === 1 && end.column === startLineLength + 1;
		if (isFullLine || start.lineNumber !== end.lineNumber) {
			const pair = findEnclosingPair(model, start, end);
			if (pair) {
				return new Selection(pair.open.lineNumber, pair.open.column, pair.close.lineNumber, pair.close.column + 1);
			}
		}
		const openAtStart = charAt(model, start);
		const closeBeforeEnd = charBefore(model, end);
		if (isOpenBracket(openAtStart) && OPEN_TO_CLOSE[openAtStart] === closeBeforeEnd) {
			const match = findMatchingClose(model, start, openAtStart);
			if (match && match.lineNumber === end.lineNumber && match.column === end.column - 1) {
				return new Selection(start.lineNumber, start.column + 1, end.lineNumber, end.column - 1);
			}
		}
		const openBefore = charBefore(model, start);
		const closeAtEnd = charAt(model, end);
		if (isOpenBracket(openBefore) && OPEN_TO_CLOSE[openBefore] === closeAtEnd) {
			const word = CursorWord.wordAt(model, start, DEFAULT_WORD_SEPARATORS);
			if (word) {
				const candidate = new Selection(word.start.lineNumber, word.start.column, word.end.lineNumber, word.end.column);
				if (positionsDiffer(candidate.start, start) || positionsDiffer(candidate.end, end)) {
					return candidate;
				}
			}
			return null;
		}
		const word = CursorWord.wordAt(model, start, DEFAULT_WORD_SEPARATORS);
		if (word) {
			const candidate = new Selection(word.start.lineNumber, word.start.column, word.end.lineNumber, word.end.column);
			if (positionsDiffer(candidate.start, start) || positionsDiffer(candidate.end, end)) {
				return candidate;
			}
		}
		return null;
	}

	static expandAll(model: ITextModel, selection: Selection, maxIterations: number = 100): Selection[] {
		const result: Selection[] = [];
		let current = selection;
		for (let i = 0; i < maxIterations; i++) {
			const next = SmartSelect.expand(model, current);
			if (!next) {
				break;
			}
			result.push(next);
			current = next;
		}
		return result;
	}

	static shrinkAll(model: ITextModel, selection: Selection, maxIterations: number = 100): Selection[] {
		const result: Selection[] = [];
		let current = selection;
		for (let i = 0; i < maxIterations; i++) {
			const next = SmartSelect.shrink(model, current);
			if (!next) {
				break;
			}
			result.push(next);
			current = next;
		}
		return result;
	}

	private static _expandEmpty(model: ITextModel, position: Position): Selection | null {
		const word = CursorWord.wordAt(model, position, DEFAULT_WORD_SEPARATORS);
		if (word) {
			if (word.start.column !== word.end.column) {
				return new Selection(word.start.lineNumber, word.start.column, word.end.lineNumber, word.end.column);
			}
		}
		const openBefore = charBefore(model, position);
		if (isOpenBracket(openBefore)) {
			const open = new Position(position.lineNumber, position.column - 1);
			const close = findMatchingClose(model, open, openBefore);
			if (close) {
				return new Selection(open.lineNumber, open.column, close.lineNumber, close.column + 1);
			}
		}
		const openAt = charAt(model, position);
		if (isOpenBracket(openAt)) {
			const close = findMatchingClose(model, position, openAt);
			if (close) {
				return new Selection(position.lineNumber, position.column, close.lineNumber, close.column + 1);
			}
		}
		return null;
	}
}
