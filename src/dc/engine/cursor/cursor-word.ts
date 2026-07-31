import { ITextModel, Position } from '../model/text-model.js';
import { Selection } from '../model/selection.js';

export const DEFAULT_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

function isLower(ch: string): boolean {
	return ch.length > 0 && ch >= 'a' && ch <= 'z';
}

function isUpper(ch: string): boolean {
	return ch.length > 0 && ch >= 'A' && ch <= 'Z';
}

export class CursorWord {
	static isWordSeparator(ch: string, wordSeparators: string): boolean {
		return ch.length === 0 || wordSeparators.indexOf(ch) !== -1 || /\s/.test(ch);
	}

	static isWordChar(ch: string, wordSeparators: string): boolean {
		return !CursorWord.isWordSeparator(ch, wordSeparators);
	}

	static left(model: ITextModel, selection: Selection, wordSeparators: string = DEFAULT_WORD_SEPARATORS): Position {
		const position = selection.isEmpty ? selection.position : selection.start;
		return CursorWord.moveWordLeft(model, position, wordSeparators);
	}

	static right(model: ITextModel, selection: Selection, wordSeparators: string = DEFAULT_WORD_SEPARATORS): Position {
		const position = selection.isEmpty ? selection.position : selection.end;
		return CursorWord.moveWordRight(model, position, wordSeparators);
	}

	static moveWordLeft(model: ITextModel, position: Position, wordSeparators: string): Position {
		let lineNumber = position.lineNumber;
		let column = position.column;
		while (true) {
			if (column <= 1) {
				if (lineNumber <= 1) {
					return new Position(1, 1);
				}
				lineNumber--;
				column = model.getLineContent(lineNumber).length + 1;
				continue;
			}
			const line = model.getLineContent(lineNumber);
			while (column > 1 && CursorWord.isWordSeparator(line.charAt(column - 2), wordSeparators)) {
				column--;
			}
			if (column <= 1) {
				if (lineNumber <= 1) {
					return new Position(1, 1);
				}
				lineNumber--;
				column = model.getLineContent(lineNumber).length + 1;
				continue;
			}
			let advanced = false;
			while (column > 1 && CursorWord.isWordChar(line.charAt(column - 2), wordSeparators)) {
				const current = line.charAt(column - 1);
				const previous = line.charAt(column - 2);
				if (advanced && isUpper(current) && isLower(previous)) {
					break;
				}
				column--;
				advanced = true;
			}
			return new Position(lineNumber, column);
		}
	}

	static moveWordRight(model: ITextModel, position: Position, wordSeparators: string): Position {
		let lineNumber = position.lineNumber;
		let column = position.column;
		while (true) {
			const line = model.getLineContent(lineNumber);
			const length = line.length;
			if (column > length) {
				if (lineNumber >= model.getLineCount()) {
					return new Position(lineNumber, length + 1);
				}
				lineNumber++;
				column = 1;
				continue;
			}
			while (column <= length && CursorWord.isWordSeparator(line.charAt(column - 1), wordSeparators)) {
				column++;
			}
			if (column > length) {
				if (lineNumber >= model.getLineCount()) {
					return new Position(lineNumber, length + 1);
				}
				lineNumber++;
				column = 1;
				continue;
			}
			const scanStart = column;
			const charBefore = scanStart > 1 ? line.charAt(scanStart - 2) : '';
			const startedInsideWord = CursorWord.isWordChar(charBefore, wordSeparators);
			const startedAtBoundary = scanStart <= length
				&& isUpper(line.charAt(scanStart - 1))
				&& isLower(line.charAt(scanStart - 2));
			const applyCamelBreaks = startedInsideWord && !startedAtBoundary;
			let advanced = false;
			while (column <= length && CursorWord.isWordChar(line.charAt(column - 1), wordSeparators)) {
				const current = line.charAt(column - 1);
				const next = column < length ? line.charAt(column) : '';
				if (applyCamelBreaks && advanced && isUpper(next) && isLower(current)) {
					break;
				}
				column++;
				advanced = true;
			}
			return new Position(lineNumber, column);
		}
	}

	static nextWordStart(model: ITextModel, position: Position, wordSeparators: string): Position {
		return CursorWord.moveWordRight(model, position, wordSeparators);
	}

	static previousWordEnd(model: ITextModel, position: Position, wordSeparators: string): Position {
		return CursorWord.moveWordLeft(model, position, wordSeparators);
	}

	static wordAt(model: ITextModel, position: Position, wordSeparators: string = DEFAULT_WORD_SEPARATORS): { start: Position; end: Position } | null {
		const line = model.getLineContent(position.lineNumber);
		const length = line.length;
		if (position.column > length + 1) {
			return null;
		}
		let startColumn = position.column - 1;
		if (startColumn >= 1 && CursorWord.isWordSeparator(line.charAt(startColumn - 1), wordSeparators)) {
			return null;
		}
		let start = startColumn;
		while (start > 0 && CursorWord.isWordChar(line.charAt(start - 1), wordSeparators)) {
			start--;
		}
		let end = startColumn;
		while (end < length && CursorWord.isWordChar(line.charAt(end), wordSeparators)) {
			end++;
		}
		if (start === end) {
			return null;
		}
		return {
			start: new Position(position.lineNumber, start + 1),
			end: new Position(position.lineNumber, end + 1),
		};
	}
}
