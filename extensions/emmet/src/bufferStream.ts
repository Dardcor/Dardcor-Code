/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { TextDocument } from 'vscode';

export class DocumentStreamReader {
	private document: TextDocument;
	private start: number;
	private _eof: number;
	private _sof: number;
	public pos: number;

	constructor(document: TextDocument, pos?: number, limit?: [number, number]) {
		this.document = document;
		this.start = this.pos = pos ? pos : 0;
		this._sof = limit ? limit[0] : 0;
		this._eof = limit ? limit[1] : document.getText().length;
	}

	sof(): boolean {
		return this.pos <= this._sof;
	}

	eof(): boolean {
		return this.pos >= this._eof;
	}

	limit(start: number, end: number): DocumentStreamReader {
		return new DocumentStreamReader(this.document, start, [start, end]);
	}

	peek(): number {
		if (this.eof()) {
			return NaN;
		}
		return this.document.getText().charCodeAt(this.pos);
	}

	next(): number {
		if (this.eof()) {
			return NaN;
		}

		const code = this.document.getText().charCodeAt(this.pos);
		this.pos++;

		if (this.eof()) {
			this.pos = this._eof;
		}

		return code;
	}

	backUp(n: number): number {
		this.pos -= n;
		if (this.pos < 0) {
			this.pos = 0;
		}
		return this.peek();
	}

	current(): string {
		return this.substring(this.start, this.pos);
	}

	substring(from: number, to: number): string {
		return this.document.getText().substring(from, to);
	}

	error(message: string): Error {
		const err = new Error(`${message} at offset ${this.pos}`);
		return err;
	}

	eat(match: number | Function): boolean {
		const ch = this.peek();
		const ok = typeof match === 'function' ? match(ch) : ch === match;

		if (ok) {
			this.next();
		}

		return ok;
	}

	eatWhile(match: number | Function): boolean {
		const start = this.pos;
		while (!this.eof() && this.eat(match)) { }
		return this.pos !== start;
	}
}
