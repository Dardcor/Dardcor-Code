/**
 * Dardcor Code - Single Line Text Content & Token Holder (Task 241)
 * Mirrors: vs/editor/common/model/textModel.ts (single line abstraction)
 */

import { LineToken, LineTokens } from './line-tokens.js';
import { getWordAtPosition, IWordAtPosition } from './word-helper.js';

export class LineModel {
	private _tokens: LineTokens | null = null;

	constructor(private _content: string) {}

	public getContent(): string {
		return this._content;
	}

	public setContent(content: string): void {
		this._content = content;
	}

	public getLength(): number {
		return this._content.length;
	}

	public isEmpty(): boolean {
		return this._content.length === 0;
	}

	public getCharAt(offset: number): string {
		if (offset < 0 || offset >= this._content.length) {
			return '';
		}
		return this._content.charAt(offset);
	}

	public getCharCodeAt(offset: number): number {
		if (offset < 0 || offset >= this._content.length) {
			return 0;
		}
		return this._content.charCodeAt(offset);
	}

	public getTokens(): LineTokens | null {
		return this._tokens;
	}

	public setTokens(tokens: LineTokens | null): void {
		this._tokens = tokens;
	}

	public getTokenCount(): number {
		return this._tokens ? this._tokens.getCount() : 1;
	}

	public getTokenAtOffset(offset: number): LineToken | undefined {
		if (!this._tokens || this._tokens.getCount() === 0) {
			return undefined;
		}
		const index = this._tokens.findTokenIndexAtOffset(offset);
		return this._tokens.getToken(index);
	}

	public getWordAtColumn(column: number): IWordAtPosition | null {
		return getWordAtPosition(this._content, column);
	}

	public substring(startOffset: number, endOffset: number): string {
		return this._content.substring(startOffset, endOffset);
	}

	public static createPlain(content: string): LineModel {
		const model = new LineModel(content);
		model._tokens = new LineTokens(
			content.length > 0 ? [new LineToken(0, content.length, 0, '')] : [],
			content.length
		);
		return model;
	}
}
