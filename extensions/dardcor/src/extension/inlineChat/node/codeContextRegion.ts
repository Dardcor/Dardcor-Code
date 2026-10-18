/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import { ILanguage } from '../../../util/common/languages';
import { FilePathCodeMarker } from '../../context/node/resolvers/selectionContextHelpers';

export class CodeContextTracker {
	private _totalChars = 0;

	constructor(private readonly charLimit: number) { }

	public get totalChars(): number {
		return this._totalChars;
	}

	public addLine(line: string): void {
		this._totalChars += line.length + 1;
	}

	public lineWouldFit(line: string): boolean {
		return this._totalChars + line.length + 1 < this.charLimit;
	}
}

export class CodeContextRegion {
	public readonly lines: string[] = [];
	private firstLineIndex: number = this.document.lineCount;
	private lastLineIndex = -1;
	public isComplete = false;
	private nonTrimWhitespaceCharCount = 0;

	private get hasContent(): boolean {
		if (this.lines.length === 0 || this.nonTrimWhitespaceCharCount === 0) {
			return false;
		}
		return this.lines.length > 0;
	}

	constructor(
		private readonly tracker: CodeContextTracker,
		private readonly document: TextDocumentSnapshot,
		public readonly language: ILanguage,
	) {
		this.lines = [];
		this.firstLineIndex = document.lineCount;
		this.lastLineIndex = -1;
	}

	public generatePrompt(): string[] {
		if (!this.hasContent) {
			return [];
		}
		const result: string[] = [];
		result.push('```' + this.language.languageId);
		result.push(FilePathCodeMarker.forDocument(this.language, this.document));
		result.push(...this.lines);
		result.push('```');
		return result;
	}

	public prependLine(lineIndex: number): boolean {
		const line = this.document.lineAt(lineIndex);
		const lineText = line.text;
		if (!this.tracker.lineWouldFit(lineText)) {
			return false;
		}
		this.firstLineIndex = Math.min(this.firstLineIndex, lineIndex);
		this.lastLineIndex = Math.max(this.lastLineIndex, lineIndex);
		this.lines.unshift(lineText);
		this.tracker.addLine(lineText);
		this.nonTrimWhitespaceCharCount += lineText.trim().length;
		return true;
	}

	public appendLine(lineIndex: number): boolean {
		const line = this.document.lineAt(lineIndex);
		const lineText = line.text;
		if (!this.tracker.lineWouldFit(lineText)) {
			return false;
		}
		this.firstLineIndex = Math.min(this.firstLineIndex, lineIndex);
		this.lastLineIndex = Math.max(this.lastLineIndex, lineIndex);
		this.lines.push(lineText);
		this.tracker.addLine(lineText);
		this.nonTrimWhitespaceCharCount += lineText.trim().length;
		return true;
	}

	public trim(rangeToNotModify?: vscode.Range): void {
		const maxFirstLineIndex = rangeToNotModify ? Math.min(this.lastLineIndex, rangeToNotModify.start.line) : this.lastLineIndex;
		while (this.firstLineIndex < maxFirstLineIndex && this.lines.length > 0 && this.lines[0].trim().length === 0) {
			this.firstLineIndex++;
			this.lines.shift();
		}

		const minLastLineIndex = rangeToNotModify ? Math.max(this.firstLineIndex, rangeToNotModify.end.line) : this.firstLineIndex;
		while (minLastLineIndex < this.lastLineIndex &&
			this.lines.length > 0 &&
			this.lines[this.lines.length - 1].trim().length === 0) {
			this.lastLineIndex--;
			this.lines.pop();
		}
	}

	public toString(): string {
		return `{${this.firstLineIndex} -> ${this.lastLineIndex}}`;
	}
}
