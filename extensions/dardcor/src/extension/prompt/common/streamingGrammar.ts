/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Iterable } from '../../../util/dardcor/base/common/iterator';

export interface IToken<S> {
	state: S;
	transitionTo?: S;
	token: string;
}

export class StreamingGrammar<S extends string | number> {
	public state: S;
	private accumulator = '';

	private currentEntries: [string, S][] = [];

	public readonly tokens: IToken<S>[] = [];

	constructor(
		initialState: S,
		private readonly grammar: { [K in S]?: { [token: string]: S } },
	) {
		this.state = initialState;
		this.currentEntries = Object.entries(grammar[initialState] || {});
	}

	public visited(state: S) {
		return this.tokens.some(token => token.state === state);
	}

	public accumulate(fromIndex = 0, toIndex = this.tokens.length, whenState?: S) {
		let str = '';
		for (let i = fromIndex; i < toIndex && i < this.tokens.length; i++) {
			const token = this.tokens[i];
			if (whenState !== undefined) {
				if (token.state === whenState && !token.transitionTo) {
					str += token.token;
				}
			} else {
				str += token.token;
			}
		}

		return str;
	}

	public append(deltaText: string): Iterable<IToken<S>> {
		let maxLength = 0;
		let found: { index: number; length: number; toState: S } | undefined;
		const startIndex = this.tokens.length;

		this.accumulator += deltaText;
		for (const [key, toState] of this.currentEntries) {
			const index = this.accumulator.indexOf(key);
			if (index !== -1 && (!found || index < found.index)) {
				found = { index, toState, length: key.length };
			}

			maxLength = Math.max(maxLength, key.length);
		}

		if (found) {
			if (found.index > 0) {
				this.tokens.push({ state: this.state, token: this.accumulator.slice(0, found.index) });
			}
			this.tokens.push({ state: this.state, token: this.accumulator.slice(found.index, found.index + found.length), transitionTo: found.toState });

			const remainder = this.accumulator.slice(found.index + found.length);
			this.state = found.toState;
			this.currentEntries = Object.entries(this.grammar[found.toState] || {});
			this.accumulator = '';
			this.append(remainder);
		} else if (this.accumulator.length > maxLength) {
			this.tokens.push({ state: this.state, token: this.accumulator.slice(0, this.accumulator.length - maxLength) });
			this.accumulator = this.accumulator.slice(this.accumulator.length - maxLength);
		}

		return Iterable.slice(this.tokens, startIndex);
	}

	public flush(): Iterable<IToken<S>> {
		if (this.accumulator) {
			this.tokens.push({ state: this.state, token: this.accumulator });
			return Iterable.slice(this.tokens, -1);
		}

		return Iterable.empty();
	}
}
