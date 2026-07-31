/**
 * Dardcor Code - Auto-Closing Brackets & Quotes Manager (Task 233)
 * Mirrors: vs/editor/contrib/languageAutoClose/languageAutoClose.ts
 */

import { IPosition } from './text-model';

export interface ICharacterPair {
	readonly open: string;
	readonly close: string;
}

export const DEFAULT_BRACKETS: readonly ICharacterPair[] = [
	{ open: '(', close: ')' },
	{ open: '[', close: ']' },
	{ open: '{', close: '}' },
	{ open: '<', close: '>' },
];

export const DEFAULT_QUOTES: readonly string[] = ['\'', '"', '`'];

export interface ICharacterPairOptions {
	readonly brackets: readonly ICharacterPair[];
	readonly quotes: readonly string[];
}

export class CharacterPairManager {
	private readonly _brackets: readonly ICharacterPair[];
	private readonly _quotes: readonly string[];
	private readonly _openToClose = new Map<string, string>();
	private readonly _closeToOpen = new Map<string, string>();

	constructor(options: ICharacterPairOptions = { brackets: DEFAULT_BRACKETS, quotes: DEFAULT_QUOTES }) {
		this._brackets = options.brackets;
		this._quotes = options.quotes;
		for (const pair of this._brackets) {
			this._openToClose.set(pair.open, pair.close);
			this._closeToOpen.set(pair.close, pair.open);
		}
	}

	public getClosingCharacter(char: string): string | undefined {
		return this._openToClose.get(char);
	}

	public getOpeningCharacter(char: string): string | undefined {
		return this._closeToOpen.get(char);
	}

	public isOpeningBracket(char: string): boolean {
		return this._openToClose.has(char);
	}

	public isClosingBracket(char: string): boolean {
		return this._closeToOpen.has(char);
	}

	public isQuote(char: string): boolean {
		return this._quotes.indexOf(char) !== -1;
	}

	public isAnyPairCharacter(char: string): boolean {
		return this.isOpeningBracket(char) || this.isClosingBracket(char) || this.isQuote(char);
	}

	public shouldAutoClose(typedChar: string, lineContent: string, position: IPosition): boolean {
		if (typedChar === ' ') {
			return false;
		}
		const closing = this.getClosingCharacter(typedChar);
		if (closing !== undefined) {
			const nextChar = lineContent.charAt(position.column - 1);
			return nextChar === '' || nextChar === '\t' || /[\s\)\]\}\",;.]/.test(nextChar);
		}
		if (this.isQuote(typedChar)) {
			const prevChar = position.column > 1 ? lineContent.charAt(position.column - 2) : '';
			const nextChar = lineContent.charAt(position.column - 1);
			const prevIsWord = /[\w\d]/.test(prevChar);
			const nextIsQuote = nextChar === typedChar;
			const isInsideWord = prevIsWord && /[\w\d]/.test(nextChar);
			return !isInsideWord && !nextIsQuote && !prevIsWord;
		}
		return false;
	}

	public getInsertionText(typedChar: string, lineContent: string, position: IPosition): { text: string; overtype: boolean } {
		const closing = this.getClosingCharacter(typedChar);
		if (closing !== undefined && this.shouldAutoClose(typedChar, lineContent, position)) {
			const nextChar = lineContent.charAt(position.column - 1);
			if (nextChar === closing) {
				return { text: '', overtype: true };
			}
			return { text: closing, overtype: false };
		}
		if (this.isQuote(typedChar) && this.shouldAutoClose(typedChar, lineContent, position)) {
			const nextChar = lineContent.charAt(position.column - 1);
			if (nextChar === typedChar) {
				return { text: '', overtype: true };
			}
			return { text: typedChar, overtype: false };
		}
		return { text: '', overtype: false };
	}

	public isBalanced(lineContent: string): boolean {
		const stack: string[] = [];
		for (const ch of lineContent) {
			if (this.isOpeningBracket(ch)) {
				stack.push(ch);
			} else if (this.isClosingBracket(ch)) {
				const open = this.getOpeningCharacter(ch);
				if (stack.length === 0 || stack[stack.length - 1] !== open) {
					return false;
				}
				stack.pop();
			}
		}
		return stack.length === 0;
	}

	public getPairForChar(char: string): ICharacterPair | undefined {
		if (this.isOpeningBracket(char)) {
			return { open: char, close: this.getClosingCharacter(char)! };
		}
		if (this.isClosingBracket(char)) {
			return { open: this.getOpeningCharacter(char)!, close: char };
		}
		return undefined;
	}

	public static readonly Default: CharacterPairManager = new CharacterPairManager();
}
