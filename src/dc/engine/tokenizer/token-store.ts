/**
 * Dardcor Code - Line Syntax Token Cache (Task 253)
 * Mirrors: vs/editor/common/tokens/tokensStore.ts
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { LineTokens } from '../model/line-tokens.js';
import { NullTokenizer } from './null-tokenizer.js';

export interface ITokenStoreChangeEvent {
	readonly lineNumber: number;
}

export class TokenStore extends Disposable {
	private readonly _tokens = new Map<number, LineTokens>();
	private _maxLineNumber = 0;

	private readonly _onDidChangeTokens = this._register(new Emitter<ITokenStoreChangeEvent>());
	readonly onDidChangeTokens: Event<ITokenStoreChangeEvent> = this._onDidChangeTokens.event;

	public setToken(lineNumber: number, tokens: LineTokens | null): void {
		if (lineNumber < 1) {
			return;
		}
		if (tokens === null) {
			this._tokens.delete(lineNumber);
		} else {
			this._tokens.set(lineNumber, tokens);
		}
		this._maxLineNumber = Math.max(this._maxLineNumber, lineNumber);
		this._onDidChangeTokens.fire({ lineNumber });
	}

	public getToken(lineNumber: number): LineTokens | undefined {
		return this._tokens.get(lineNumber);
	}

	public getOrCreate(lineNumber: number, lineContent: string): LineTokens {
		const existing = this._tokens.get(lineNumber);
		if (existing) {
			return existing;
		}
		const tokens = NullTokenizer.tokenize(lineContent);
		this._tokens.set(lineNumber, tokens);
		this._maxLineNumber = Math.max(this._maxLineNumber, lineNumber);
		return tokens;
	}

	public hasToken(lineNumber: number): boolean {
		return this._tokens.has(lineNumber);
	}

	public removeLine(lineNumber: number): void {
		this._tokens.delete(lineNumber);
		this._onDidChangeTokens.fire({ lineNumber });
	}

	public shiftLines(startLineNumber: number, delta: number): void {
		const entries = Array.from(this._tokens.entries()).filter(([line]) => line >= startLineNumber);
		for (const [line] of entries) {
			this._tokens.delete(line);
		}
		for (const [line, tokens] of entries) {
			const newLine = line + delta;
			if (newLine >= 1) {
				this._tokens.set(newLine, tokens);
			}
		}
	}

	public clear(): void {
		this._tokens.clear();
		this._maxLineNumber = 0;
	}

	public getMaxLineNumber(): number {
		return this._maxLineNumber;
	}

	public getLineNumbers(): number[] {
		return Array.from(this._tokens.keys()).sort((a, b) => a - b);
	}

	public getTokenCount(): number {
		return this._tokens.size;
	}
}
