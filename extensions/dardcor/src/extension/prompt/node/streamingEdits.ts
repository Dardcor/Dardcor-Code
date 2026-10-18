/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { AsyncIterableObject } from '../../../util/dardcor/base/common/async';
import { CharCode } from '../../../util/dardcor/base/common/charCode';
import { Constants } from '../../../util/dardcor/base/common/uint';
import { Range, TextEdit } from '../../../dardcorTypes';
import { looksLikeCode } from '../common/codeGuesser';
import { isImportStatement } from '../common/importStatement';
import { EditStrategy, Lines, trimLeadingWhitespace } from './editGeneration';
import { computeIndentLevel2, guessIndentation, normalizeIndentation } from './indentationGuesser';

export interface IStreamingEditsStrategy {
	processStream(stream: AsyncIterable<LineOfText>): Promise<StreamingEditsResult>;
}

export interface IStreamingEditsStrategyFactory {
	(lineFilter: ILineFilter, streamingWorkingCopyDocument: StreamingWorkingCopyDocument): IStreamingEditsStrategy;
}

export class InsertOrReplaceStreamingEdits implements IStreamingEditsStrategy {

	private replyIndentationTracker: ReplyIndentationTracker | null = null;

	constructor(
		private readonly myDocument: StreamingWorkingCopyDocument,
		private readonly initialSelection: vscode.Range,
		private readonly adjustedSelection: vscode.Range,
		private readonly editStrategy: EditStrategy,
		private readonly collectImports: boolean = true,
		private readonly lineFilter: ILineFilter = LineFilters.noop,
	) {
	}

	public async processStream(_stream: AsyncIterable<LineOfText>): Promise<StreamingEditsResult> {
		let stream = AsyncIterableObject.filter(_stream, this.lineFilter);
		if (this.collectImports) {
			stream = collectImportsIfNoneWereSentInRange(stream, this.myDocument, this.adjustedSelection);
		}

		let anchorLineIndex = this.myDocument.firstSentLineIndex;

		for await (const el of this.findInitialAnchor(stream)) {
			if (el instanceof LineWithAnchorInfo) {
				anchorLineIndex = this.handleFirstReplyLine(el.anchor, el.line);
			} else {
				anchorLineIndex = this.handleSubsequentReplyLine(anchorLineIndex, el.value);
			}
		}

		if (this.myDocument.didReplaceEdits && anchorLineIndex <= this.adjustedSelection.end.line) {
			this.myDocument.deleteLines(anchorLineIndex, this.adjustedSelection.end.line);
		}

		return new StreamingEditsResult(
			this.myDocument.didNoopEdits,
			this.myDocument.didEdits,
			this.myDocument.additionalImports
		);
	}

	private handleFirstReplyLine(anchor: MatchedDocumentLine | null, line: string): number {

		if (anchor) {
			this.replyIndentationTracker = new ReplyIndentationTracker(this.myDocument, anchor.lineIndex, line);
			const fixedLine = this.replyIndentationTracker.reindent(line, this.myDocument.indentStyle);
			if (this.myDocument.getLine(anchor.lineIndex).sentInCodeBlock === SentInCodeBlock.Range) {
				return this.myDocument.replaceLines(this.adjustedSelection.start.line, anchor.lineIndex, fixedLine);
			} else {
				return this.myDocument.replaceLine(anchor.lineIndex, fixedLine);
			}
		}

		const firstRangeLine = this.adjustedSelection.start.line;
		this.replyIndentationTracker = new ReplyIndentationTracker(this.myDocument, firstRangeLine, line);
		const fixedLine = this.replyIndentationTracker.reindent(line, this.myDocument.indentStyle);

		if (this.initialSelection.isEmpty) {
			const cursorLineContent = this.myDocument.getLine(firstRangeLine).content;
			if (
				/^\s*$/.test(cursorLineContent)
				|| fixedLine.adjustedContent.startsWith(cursorLineContent)
			) {
				return this.myDocument.replaceLine(firstRangeLine, fixedLine, true);
			}
		}

		if (this.editStrategy === EditStrategy.FallbackToInsertAboveRange) {
			return this.myDocument.insertLineBefore(firstRangeLine, fixedLine);
		}
		if (this.editStrategy === EditStrategy.FallbackToInsertBelowRange || this.editStrategy === EditStrategy.ForceInsertion) {
			return this.myDocument.insertLineAfter(firstRangeLine, fixedLine);
		}
		return this.myDocument.replaceLine(firstRangeLine, fixedLine);
	}

	private handleSubsequentReplyLine(anchorLineIndex: number, line: string): number {
		const fixedLine = this.replyIndentationTracker!.reindent(line, this.myDocument.indentStyle);

		if (fixedLine.trimmedContent !== '' || this.myDocument.didReplaceEdits) {
			const matchedLine = this.matchReplyLine(fixedLine, anchorLineIndex);
			if (matchedLine) {
				return this.myDocument.replaceLines(anchorLineIndex, matchedLine.lineIndex, fixedLine);
			}
		}


		if (anchorLineIndex >= this.myDocument.getLineCount()) {
			return this.myDocument.appendLineAtEndOfDocument(fixedLine);
		}

		const existingLine = this.myDocument.getLine(anchorLineIndex);
		if (!existingLine.isSent || existingLine.content === '' || fixedLine.trimmedContent === '') {
			return this.myDocument.insertLineBefore(anchorLineIndex, fixedLine);
		}

		if (existingLine.indentLevel < fixedLine.adjustedIndentLevel) {
			return this.myDocument.insertLineBefore(anchorLineIndex, fixedLine);
		}

		if (existingLine.indentLevel === fixedLine.adjustedIndentLevel && !this.myDocument.didReplaceEdits) {
			return this.myDocument.insertLineBefore(anchorLineIndex, fixedLine);
		}

		return this.myDocument.replaceLine(anchorLineIndex, fixedLine);
	}

	private matchReplyLine(replyLine: ReplyLine, minimumLineIndex: number): MatchedDocumentLine | null {
		const isVeryShortReplyLine = replyLine.trimmedContent.length <= 3;

		for (let lineIndex = minimumLineIndex; lineIndex < this.myDocument.getLineCount(); lineIndex++) {
			const documentLine = this.myDocument.getLine(lineIndex);
			if (!documentLine.isSent) {
				continue;
			}
			if (documentLine.normalizedContent === replyLine.adjustedContent) {
				return new MatchedDocumentLine(lineIndex);
			}
			if (documentLine.trimmedContent.length > 0 && documentLine.indentLevel < replyLine.adjustedIndentLevel) {
				return null;
			}
			if (isVeryShortReplyLine && documentLine.trimmedContent.length > 0) {
				return null;
			}
		}
		return null;
	}

	private findInitialAnchor(lineStream: AsyncIterable<LineOfText>): AsyncIterable<LineOfText | LineWithAnchorInfo> {
		return new AsyncIterableObject<LineOfText | LineWithAnchorInfo>(async (emitter) => {
			const accumulatedLines: LineOfText[] = [];
			let accumulatedRealChars = 0;
			let anchorFound = false;
			for await (const line of lineStream) {
				if (!anchorFound) {
					accumulatedLines.push(line);
					accumulatedRealChars += line.value.trim().length;
					if (accumulatedRealChars > 10) {
						const anchor = this.searchForEqualSentLines(accumulatedLines);
						anchorFound = true;
						emitter.emitOne(new LineWithAnchorInfo(accumulatedLines[0].value, anchor));
						emitter.emitMany(accumulatedLines.slice(1));
					}
				} else {
					emitter.emitOne(line);
				}
			}
		});
	}

	private searchForEqualSentLines(lines: LineOfText[]): MatchedDocumentLine | null {
		const trimmedLines = lines.map(line => line.value.trim());

		for (let i = this.myDocument.firstSentLineIndex, stopAt = this.myDocument.getLineCount() - lines.length; i <= stopAt; i++) {
			if (!this.myDocument.getLine(i).isSent) {
				continue;
			}
			let matchedAllLines = true;
			for (let j = 0; j < trimmedLines.length; j++) {
				const documentLine = this.myDocument.getLine(i + j);
				if (!documentLine.isSent || documentLine.trimmedContent !== trimmedLines[j]) {
					matchedAllLines = false;
					break;
				}
			}
			if (matchedAllLines) {
				return new MatchedDocumentLine(i);
			}
		}
		return null;
	}
}

export class InsertionStreamingEdits implements IStreamingEditsStrategy {

	private replyIndentationTracker: ReplyIndentationTracker | null = null;

	constructor(
		private readonly _myDocument: IStreamingWorkingCopyDocument,
		private readonly _cursorPosition: vscode.Position,
		private readonly _lineFilter: ILineFilter = LineFilters.noop
	) { }

	public async processStream(_stream: AsyncIterable<LineOfText>): Promise<StreamingEditsResult> {
		let stream = AsyncIterableObject.filter(_stream, this._lineFilter);
		stream = collectImportsIfNoneWereSentInRange(stream, this._myDocument, new Range(this._cursorPosition, this._cursorPosition));

		let anchorLineIndex = 0;

		for await (const line of stream) {
			if (!this.replyIndentationTracker) {
				anchorLineIndex = this.handleFirstReplyLine(line.value);
			} else {
				anchorLineIndex = this.handleSubsequentReplyLine(anchorLineIndex, line.value);
			}
		}

		return new StreamingEditsResult(
			this._myDocument.didNoopEdits,
			this._myDocument.didEdits,
			this._myDocument.additionalImports,
		);
	}

	private handleFirstReplyLine(replyLine: string): number {

		const firstRangeLine = this._cursorPosition.line;

		const cursorLineContent = this._myDocument.getLine(firstRangeLine).content;

		const shouldLineBeReplaced = /^\s*$/.test(cursorLineContent) || replyLine.trimStart().startsWith(cursorLineContent.trimStart());

		const lineNumForIndentGuessing = shouldLineBeReplaced
			? firstRangeLine
			: (this._myDocument.getLineCount() <= firstRangeLine + 1 ? firstRangeLine : firstRangeLine + 1);

		this.replyIndentationTracker = new ReplyIndentationTracker(this._myDocument, lineNumForIndentGuessing, replyLine);
		const fixedLine = this.replyIndentationTracker.reindent(replyLine, this._myDocument.indentStyle);

		if (shouldLineBeReplaced) {
			return this._myDocument.replaceLine(firstRangeLine, fixedLine, true);
		}

		return this._myDocument.insertLineAfter(firstRangeLine, fixedLine);
	}

	private handleSubsequentReplyLine(anchorLineIndex: number, line: string): number {
		const fixedLine = this.replyIndentationTracker!.reindent(line, this._myDocument.indentStyle);

		return this._myDocument.insertLineBefore(anchorLineIndex, fixedLine);
	}
}

export class ReplaceSelectionStreamingEdits implements IStreamingEditsStrategy {

	private replyIndentationTracker: ReplyIndentationTracker | null = null;

	constructor(
		private readonly _myDocument: IStreamingWorkingCopyDocument,
		private readonly _selection: vscode.Range,
		private readonly _lineFilter: ILineFilter = LineFilters.noop
	) { }

	public async processStream(_stream: AsyncIterable<LineOfText>): Promise<StreamingEditsResult> {
		let stream = AsyncIterableObject.filter(_stream, this._lineFilter);
		stream = collectImportsIfNoneWereSentInRange(stream, this._myDocument, this._selection);

		let anchorLineIndex = 0;

		let replaceLineCount: number;
		let initialTextOnLineAfterSelection: string = '';
		if (this._selection.end.line > this._selection.start.line && this._selection.end.character === 0) {
			replaceLineCount = this._selection.end.line - this._selection.start.line;
		} else {
			replaceLineCount = this._selection.end.line - this._selection.start.line + 1;
			initialTextOnLineAfterSelection = this._myDocument.getLine(this._selection.end.line).content.substring(this._selection.end.character);
		}

		for await (const line of stream) {
			if (!this.replyIndentationTracker) {
				const firstRangeLine = this._selection.start.line;
				this.replyIndentationTracker = new ReplyIndentationTracker(this._myDocument, firstRangeLine, line.value);
				const fixedLine = this.replyIndentationTracker.reindent(line.value, this._myDocument.indentStyle);
				anchorLineIndex = this._myDocument.replaceLine(firstRangeLine, fixedLine);
				replaceLineCount--;
			} else {
				const fixedLine = this.replyIndentationTracker!.reindent(line.value, this._myDocument.indentStyle);
				if (replaceLineCount > 0) {
					anchorLineIndex = this._myDocument.replaceLine(anchorLineIndex, fixedLine);
					replaceLineCount--;
				} else {
					anchorLineIndex = this._myDocument.insertLineAfter(anchorLineIndex - 1, fixedLine);
				}
			}
		}

		if (this._myDocument.didEdits && replaceLineCount > 0) {
			this._myDocument.deleteLines(anchorLineIndex, anchorLineIndex + replaceLineCount - 1);
		}
		if (this._myDocument.didEdits && initialTextOnLineAfterSelection.length > 0) {
			this._myDocument.replaceLine(anchorLineIndex - 1, this._myDocument.getLine(anchorLineIndex - 1).content + initialTextOnLineAfterSelection);
		}

		return new StreamingEditsResult(
			this._myDocument.didNoopEdits,
			this._myDocument.didEdits,
			this._myDocument.additionalImports
		);
	}
}

export interface ILineFilter {
	(line: LineOfText): boolean;
}

export class StreamingEditsResult {
	constructor(
		public readonly didNoopEdits: boolean,
		public readonly didEdits: boolean,
		public readonly additionalImports: string[],
	) { }
}

class ReplyIndentationTracker {

	private _replyIndentStyle: vscode.FormattingOptions | undefined;
	private indentDelta: number;

	constructor(
		document: IStreamingWorkingCopyDocument,
		documentLineIdx: number,
		replyLine: string
	) {
		let docIndentLevel = 0;
		for (let i = documentLineIdx; i >= 0; i--) {
			const documentLine = document.getLine(i);
			if (documentLine.content.length > 0) {
				docIndentLevel = documentLine.indentLevel;
				if (i !== documentLineIdx) {
					if (
						documentLine.content.endsWith('{') ||
						(document.languageId === 'python' && documentLine.content.endsWith(':'))
					) {
						docIndentLevel += 1;
					}
				}
				break;
			}
		}

		this._replyIndentStyle = IndentUtils.guessIndentStyleFromLine(replyLine);
		const replyIndentLevel = computeIndentLevel2(replyLine, this._replyIndentStyle?.tabSize ?? 4);

		this.indentDelta = replyIndentLevel - docIndentLevel;
	}

	public reindent(replyLine: string, desiredStyle: vscode.FormattingOptions): ReplyLine {
		if (replyLine === '') {
			return new ReplyLine('', 0, '', 0);
		}

		if (!this._replyIndentStyle) {
			this._replyIndentStyle = IndentUtils.guessIndentStyleFromLine(replyLine);
		}

		let originalIndentLevel = 0;
		let adjustedIndentLevel = 0;
		const determineAdjustedIndentLevel = (currentIndentLevel: number) => {
			originalIndentLevel = currentIndentLevel;
			adjustedIndentLevel = Math.max(originalIndentLevel - this.indentDelta, 0);
			return adjustedIndentLevel;
		};
		const adjustedContent = IndentUtils.reindentLine(replyLine, this._replyIndentStyle ?? { insertSpaces: true, tabSize: 4 }, desiredStyle, determineAdjustedIndentLevel);

		return new ReplyLine(replyLine, originalIndentLevel, adjustedContent, adjustedIndentLevel);
	}
}

class LineWithAnchorInfo {
	constructor(
		readonly line: string,
		readonly anchor: MatchedDocumentLine | null,
	) { }
}

export class SentLine {
	constructor(
		readonly lineIndex: number,
		readonly sentInCodeBlock: SentInCodeBlock.Above | SentInCodeBlock.Range | SentInCodeBlock.Below | SentInCodeBlock.Other
	) { }
}

export class LineRange {
	constructor(
		readonly startLineIndex: number,
		readonly endLineIndex: number
	) { }
}

export interface IStreamingWorkingCopyDocument {
	readonly languageId: string;
	readonly indentStyle: vscode.FormattingOptions;
	readonly didNoopEdits: boolean;
	readonly didEdits: boolean;
	readonly additionalImports: string[];

	getLineCount(): number;
	getLine(index: number): DocumentLine;
	addAdditionalImport(importStatement: string): void;
	replaceLine(index: number, line: ReplyLine | string, isPreserving?: boolean): number;
	replaceLines(fromIndex: number, toIndex: number, line: ReplyLine): number;
	appendLineAtEndOfDocument(line: ReplyLine): number;
	insertLineAfter(index: number, line: ReplyLine): number;
	insertLineBefore(index: number, line: ReplyLine): number;
	deleteLines(fromIndex: number, toIndex: number): number;
}

export class StreamingWorkingCopyDocument implements IStreamingWorkingCopyDocument {

	public readonly indentStyle: vscode.FormattingOptions;
	private readonly _originalLines: string[] = [];
	private lines: DocumentLine[] = [];
	public readonly firstSentLineIndex: number;
	private _didNoopEdits = false;
	private _didEdits = false;
	private _didReplaceEdits = false;
	private readonly _additionalImports: string[] = [];

	public get didNoopEdits(): boolean {
		return this._didNoopEdits;
	}

	public get didEdits(): boolean {
		return this._didEdits;
	}

	public get didReplaceEdits(): boolean {
		return this._didReplaceEdits;
	}

	public get additionalImports(): string[] {
		return this._additionalImports;
	}

	constructor(
		private readonly outputStream: vscode.ChatResponseStream,
		private readonly uri: vscode.Uri,
		sourceCode: string,
		sentLines: SentLine[],
		selection: LineRange,
		public readonly languageId: string,
		fileIndentInfo: vscode.FormattingOptions | undefined
	) {
		this.indentStyle = IndentUtils.getDocumentIndentStyle(sourceCode, fileIndentInfo);

		this._originalLines = sourceCode.split(/\r\n|\r|\n/g);
		for (let i = 0; i < this._originalLines.length; i++) {
			this.lines[i] = new DocumentLine(this._originalLines[i], this.indentStyle);
		}

		this.firstSentLineIndex = Number.MAX_SAFE_INTEGER;
		for (const sentLine of sentLines) {
			this.lines[sentLine.lineIndex].markSent(sentLine.sentInCodeBlock);
			this.firstSentLineIndex = Math.min(this.firstSentLineIndex, sentLine.lineIndex);
		}

		this.firstSentLineIndex = Math.min(this.firstSentLineIndex, selection.startLineIndex);
	}

	public getText(): string {
		return this.lines.map(line => line.content).join('\n');
	}

	public getLineCount(): number {
		return this.lines.length;
	}

	public getLine(index: number): DocumentLine {
		if (index < 0 || index >= this.lines.length) {
			throw new Error(`Invalid index`);
		}
		return this.lines[index];
	}

	public addAdditionalImport(importStatement: string): void {
		this._additionalImports.push(importStatement);
	}

	public replaceLine(index: number, line: ReplyLine | string, isPreserving: boolean = false): number {
		const newLineContent = typeof line === 'string' ? line : line.adjustedContent;
		if (this.lines[index].content === newLineContent) {
			this._didNoopEdits = true;
			return index + 1;
		}
		this.lines[index] = new DocumentLine(newLineContent, this.indentStyle);
		this.outputStream.textEdit(this.uri, [new TextEdit(new Range(index, 0, index, Constants.MAX_SAFE_SMALL_INTEGER), newLineContent)]);
		this._didEdits = true;
		this._didReplaceEdits = this._didReplaceEdits || (isPreserving ? false : true);
		return index + 1;
	}

	public replaceLines(fromIndex: number, toIndex: number, line: ReplyLine): number {
		if (fromIndex > toIndex) {
			throw new Error(`Invalid range`);
		}
		if (fromIndex === toIndex) {
			return this.replaceLine(fromIndex, line);
		}
		this.lines.splice(fromIndex, toIndex - fromIndex + 1, new DocumentLine(line.adjustedContent, this.indentStyle));
		this.outputStream.textEdit(this.uri, [new TextEdit(new Range(fromIndex, 0, toIndex, Constants.MAX_SAFE_SMALL_INTEGER), line.adjustedContent)]);
		this._didEdits = true;
		this._didReplaceEdits = true;
		return fromIndex + 1;
	}

	public appendLineAtEndOfDocument(line: ReplyLine): number {
		this.lines.push(new DocumentLine(line.adjustedContent, this.indentStyle));
		this.outputStream.textEdit(this.uri, [new TextEdit(new Range(this.lines.length - 1, Constants.MAX_SAFE_SMALL_INTEGER, this.lines.length - 1, Constants.MAX_SAFE_SMALL_INTEGER), '\n' + line.adjustedContent)]);
		this._didEdits = true;
		return this.lines.length;
	}

	public insertLineAfter(index: number, line: ReplyLine): number {
		this.lines.splice(index + 1, 0, new DocumentLine(line.adjustedContent, this.indentStyle));
		this.outputStream.textEdit(this.uri, [new TextEdit(new Range(index, Constants.MAX_SAFE_SMALL_INTEGER, index, Constants.MAX_SAFE_SMALL_INTEGER), '\n' + line.adjustedContent)]);
		this._didEdits = true;
		return index + 2;
	}

	public insertLineBefore(index: number, line: ReplyLine): number {
		if (index === this.lines.length) {
			return this.insertLineAfter(index - 1, line);
		}
		this.lines.splice(index, 0, new DocumentLine(line.adjustedContent, this.indentStyle));
		this.outputStream.textEdit(this.uri, [new TextEdit(new Range(index, 0, index, 0), line.adjustedContent + '\n')]);
		this._didEdits = true;
		return index + 1;
	}

	public deleteLines(fromIndex: number, toIndex: number): number {
		this.lines.splice(fromIndex, toIndex - fromIndex + 1);
		this.outputStream.textEdit(this.uri, [new TextEdit(new Range(fromIndex, 0, toIndex + 1, 0), '')]);
		this._didEdits = true;
		this._didReplaceEdits = true;
		return fromIndex + 1;
	}
}

class ReplyLine {
	public readonly trimmedContent: string = this.originalContent.trim();

	constructor(
		public readonly originalContent: string,
		public readonly originalIndentLevel: number,
		public readonly adjustedContent: string,
		public readonly adjustedIndentLevel: number
	) { }
}

class MatchedDocumentLine {
	constructor(
		public readonly lineIndex: number
	) { }
}

export const enum SentInCodeBlock {
	None,
	Above,
	Range,
	Below,
	Other,
}

class DocumentLine {

	private _sentInCodeBlock: SentInCodeBlock = SentInCodeBlock.None;
	public get isSent(): boolean {
		return this._sentInCodeBlock !== SentInCodeBlock.None;
	}
	public get sentInCodeBlock(): SentInCodeBlock {
		return this._sentInCodeBlock;
	}

	private _trimmedContent: string | null = null;
	public get trimmedContent(): string {
		if (this._trimmedContent === null) {
			this._trimmedContent = this.content.trim();
		}
		return this._trimmedContent;
	}

	private _normalizedContent: string | null = null;
	public get normalizedContent(): string {
		if (this._normalizedContent === null) {
			this._normalizedContent = normalizeIndentation(this.content, this._indentStyle.tabSize, this._indentStyle.insertSpaces);
		}
		return this._normalizedContent;
	}

	private _indentLevel: number = -1;
	public get indentLevel(): number {
		if (this._indentLevel === -1) {
			this._indentLevel = computeIndentLevel2(this.content, this._indentStyle.tabSize);
		}
		return this._indentLevel;
	}

	constructor(
		public readonly content: string,
		private readonly _indentStyle: vscode.FormattingOptions
	) { }

	public markSent(sentInCodeBlock: SentInCodeBlock): void {
		this._sentInCodeBlock = sentInCodeBlock;
	}
}

class IndentUtils {

	public static getDocumentIndentStyle(sourceCode: string, fileIndentInfo: vscode.FormattingOptions | undefined): vscode.FormattingOptions {
		if (fileIndentInfo) {
			return fileIndentInfo;
		}

		return <vscode.FormattingOptions>guessIndentation(Lines.fromString(sourceCode), 4, false);
	}

	public static guessIndentStyleFromLine(line: string): vscode.FormattingOptions | undefined {
		const leadingWhitespace = IndentUtils._getLeadingWhitespace(line);
		if (leadingWhitespace === '' || leadingWhitespace === ' ') {
			return undefined;
		}
		return <vscode.FormattingOptions>guessIndentation([line], 4, false);
	}

	public static reindentLine(line: string, originalIndentStyle: vscode.FormattingOptions, desiredIndentStyle: vscode.FormattingOptions, getDesiredIndentLevel: (currentIndentLevel: number) => number = (n) => n): string {
		let indentLevel = computeIndentLevel2(line, originalIndentStyle.tabSize);
		const desiredIndentLevel = getDesiredIndentLevel(indentLevel);

		while (indentLevel > 0) {
			line = this._outdent(line, originalIndentStyle);
			indentLevel--;
		}

		while (indentLevel < desiredIndentLevel) {
			line = '\t' + line;
			indentLevel++;
		}

		return normalizeIndentation(line, desiredIndentStyle.tabSize, desiredIndentStyle.insertSpaces);
	}

	private static _outdent(line: string, indentStyle: vscode.FormattingOptions): string {
		let chrIndex = 0;
		while (chrIndex < line.length) {
			const chr = line.charCodeAt(chrIndex);
			if (chr === CharCode.Tab) {
				chrIndex++;
				break;
			}
			if (chr !== CharCode.Space) {
				break;
			}
			if (chrIndex === indentStyle.tabSize) {
				break;
			}
			chrIndex++;
		}
		return line.substring(chrIndex);
	}

	private static _getLeadingWhitespace(line: string): string {
		for (let i = 0; i < line.length; i++) {
			const char = line.charCodeAt(i);
			if (char !== 32 && char !== 9) {
				return line.substring(0, i);
			}
		}
		return line;
	}
}

export class LineFilters {

	public static combine(...filters: (ILineFilter | undefined)[]): ILineFilter {
		return (line: LineOfText) => filters.every(filter => filter ? filter(line) : true);
	}

	public static noop: ILineFilter = () => true;

	public static createCodeBlockFilter(): ILineFilter {
		const enum State {
			BeforeCodeBlock,
			InCodeBlock,
			AfterCodeBlock
		}
		let state = State.BeforeCodeBlock;
		return (line: LineOfText) => {
			if (state === State.BeforeCodeBlock) {
				if (/^```/.test(line.value)) {
					state = State.InCodeBlock;
				}
				return false;
			}
			if (state === State.InCodeBlock) {
				if (/^```/.test(line.value)) {
					state = State.AfterCodeBlock;
					return false;
				}
				return true;
			}
			return false;
		};
	}
}

export class LineOfText {
	readonly __lineOfTextBrand: void = undefined;
	public readonly value: string;
	constructor(
		value: string
	) {
		this.value = value.replace(/\r$/, '');
	}
}

export const enum TextPieceKind {
	OutsideCodeBlock,
	InsideCodeBlock,
	Delimiter,
}

export class ClassifiedTextPiece {
	constructor(
		public readonly value: string,
		public readonly kind: TextPieceKind
	) { }
}

export interface IStreamingTextPieceClassifier {
	(textSource: AsyncIterable<string>): AsyncIterableObject<ClassifiedTextPiece>;
}

export class TextPieceClassifiers {
	public static createCodeBlockClassifier(): IStreamingTextPieceClassifier {
		return TextPieceClassifiers.attemptToRecoverFromMissingCodeBlock(
			TextPieceClassifiers.createFencedBlockClassifier('```')
		);
	}

	private static attemptToRecoverFromMissingCodeBlock(classifier: IStreamingTextPieceClassifier): IStreamingTextPieceClassifier {
		return (source: AsyncIterable<string>) => {
			return new AsyncIterableObject<ClassifiedTextPiece>(async (emitter) => {
				const bufferedPieces: ClassifiedTextPiece[] = [];
				let sawOnlyLeadingText = true;
				for await (const piece of classifier(source)) {
					if (!sawOnlyLeadingText) {
						emitter.emitOne(piece);
					} else if (piece.kind === TextPieceKind.OutsideCodeBlock) {
						bufferedPieces.push(piece);
					} else {
						sawOnlyLeadingText = false;
						for (const p of bufferedPieces) {
							emitter.emitOne(p);
						}
						bufferedPieces.length = 0;
						emitter.emitOne(piece);
					}
				}

				if (sawOnlyLeadingText) {
					const allText = bufferedPieces.map(p => p.value).join('');
					if (looksLikeCode(allText)) {
						emitter.emitOne(new ClassifiedTextPiece(allText, TextPieceKind.InsideCodeBlock));
					} else {
						emitter.emitOne(new ClassifiedTextPiece(allText, TextPieceKind.OutsideCodeBlock));
					}
				}
			});
		};
	}

	public static createAlwaysInsideCodeBlockClassifier(): IStreamingTextPieceClassifier {
		return (source: AsyncIterable<string>) => {
			return AsyncIterableObject.map(source, line => new ClassifiedTextPiece(line, TextPieceKind.InsideCodeBlock));
		};
	}

	public static createFencedBlockClassifier(fence: string): IStreamingTextPieceClassifier {
		return (source: AsyncIterable<string>) => {
			return new AsyncIterableObject<ClassifiedTextPiece>(async (emitter) => {
				const reader = new PartialAsyncTextReader(source[Symbol.asyncIterator]());

				let state = TextPieceKind.OutsideCodeBlock;

				while (!reader.endOfStream) {

					const text = await reader.peek(fence.length);

					if (text !== fence) {

						while (!reader.endOfStream) {
							const piece = reader.readImmediateExcept('\n');
							if (piece.length > 0) {
								emitter.emitOne(new ClassifiedTextPiece(piece, state));
							}
							const nextChar = await reader.peek(1);
							if (nextChar === '\n') {
								reader.readImmediate(1);
								emitter.emitOne(new ClassifiedTextPiece('\n', state));
								break;
							}
						}

					} else {

						const lineWithFence = await reader.readLineIncludingLF();
						state = state === TextPieceKind.InsideCodeBlock ? TextPieceKind.OutsideCodeBlock : TextPieceKind.InsideCodeBlock;
						emitter.emitOne(new ClassifiedTextPiece(lineWithFence, TextPieceKind.Delimiter));

					}
				}
			});
		};
	}

}

export class PartialAsyncTextReader {

	private _buffer: string = '';
	private _atEnd = false;

	public get endOfStream(): boolean { return this._buffer.length === 0 && this._atEnd; }

	constructor(
		private readonly _source: AsyncIterator<string>
	) {
	}

	private async extendBuffer(): Promise<void> {
		if (this._atEnd) {
			return;
		}
		const { value, done } = await this._source.next();
		if (done) {
			this._atEnd = true;
		} else {
			this._buffer += value;
		}
	}

	async waitForLength(n: number): Promise<void> {
		while (this._buffer.length < n && !this._atEnd) {
			await this.extendBuffer();
		}
	}

	async peek(n: number): Promise<string> {
		await this.waitForLength(n);
		return this._buffer.substring(0, n);
	}

	async read(n: number): Promise<string> {
		await this.waitForLength(n);
		const result = this._buffer.substring(0, n);
		this._buffer = this._buffer.substring(n);
		return result;
	}

	async readUntil(char: string): Promise<string> {
		let result = '';
		while (!this.endOfStream) {
			const piece = this.readImmediateExcept(char);
			result += piece;
			const nextChar = await this.peek(1);

			if (nextChar === char) {
				break;
			}
		}

		return result;
	}

	async readLineIncludingLF(): Promise<string> {
		let line = await this.readUntil('\n');
		line += await this.read(1);
		return line;
	}

	async readLine(): Promise<string> {
		const line = await this.readUntil('\n');
		await this.read(1);
		return line;
	}

	readImmediateExcept(char: string): string {
		const endIndex = this._buffer.indexOf(char);
		return this.readImmediate(endIndex === -1 ? this._buffer.length : endIndex);
	}

	readImmediate(n: number): string {
		const result = this._buffer.substring(0, n);
		this._buffer = this._buffer.substring(n);
		return result;
	}
}

export class AsyncReaderEndOfStream { }

export class AsyncReader<T> {

	public static EOS = new AsyncReaderEndOfStream();

	private _buffer: T[] = [];
	private _atEnd = false;

	public get endOfStream(): boolean { return this._buffer.length === 0 && this._atEnd; }

	constructor(
		private readonly _source: AsyncIterator<T>
	) {
	}

	private async extendBuffer(): Promise<void> {
		if (this._atEnd) {
			return;
		}
		const { value, done } = await this._source.next();
		if (done) {
			this._atEnd = true;
		} else {
			this._buffer.push(value);
		}
	}

	public async peek(): Promise<T | AsyncReaderEndOfStream> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await this.extendBuffer();
		}
		if (this._buffer.length === 0) {
			return AsyncReader.EOS;
		}
		return this._buffer[0];
	}

	public async read(): Promise<T | AsyncReaderEndOfStream> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await this.extendBuffer();
		}
		if (this._buffer.length === 0) {
			return AsyncReader.EOS;
		}
		return this._buffer.shift()!;
	}

	public async readWhile(predicate: (value: T) => boolean, callback: (element: T) => unknown): Promise<void> {
		do {
			const piece = await this.peek();
			if (piece instanceof AsyncReaderEndOfStream) {
				break;
			}
			if (!predicate(piece)) {
				break;
			}
			await this.read();
			await callback(piece);
		} while (true);
	}

	public async consumeToEnd(): Promise<void> {
		while (!this.endOfStream) {
			await this.read();
		}
	}
}

export function streamLines(source: AsyncIterable<string>): AsyncIterableObject<LineOfText> {
	return new AsyncIterableObject<LineOfText>(async (emitter) => {
		let buffer = '';
		for await (const str of source) {
			buffer += str;
			do {
				const newlineIndex = buffer.indexOf('\n');
				if (newlineIndex === -1) {
					break;
				}

				const line = buffer.substring(0, newlineIndex);
				buffer = buffer.substring(newlineIndex + 1);

				emitter.emitOne(new LineOfText(line));
			} while (true);
		}

		if (buffer.length > 0) {
			emitter.emitOne(new LineOfText(buffer));
		}
	});
}

function hasImportsInRange(doc: IStreamingWorkingCopyDocument, range: vscode.Range): boolean {
	const startLine = (range.start.character === 0 ? range.start.line : range.start.line + 1);
	const endLine = (doc.getLine(range.end.line).content.length === range.end.character ? range.end.line : range.end.line - 1);
	for (let i = startLine; i <= endLine; i++) {
		if (isImportStatement(doc.getLine(i).content, doc.languageId)) {
			return true;
		}
	}
	return false;
}

function collectImportsIfNoneWereSentInRange(stream: AsyncIterableObject<LineOfText>, doc: IStreamingWorkingCopyDocument, rangeToCheckForImports: vscode.Range): AsyncIterableObject<LineOfText> {
	if (hasImportsInRange(doc, rangeToCheckForImports)) {
		return stream;
	}
	let extractedImports = false;
	let hasCode = false;
	return stream.filter(line => {
		if (isImportStatement(line.value, doc.languageId)) {
			doc.addAdditionalImport(trimLeadingWhitespace(line.value));
			extractedImports = true;
			return false;
		}
		const isOnlyWhitespace = (line.value.trim().length === 0);
		if (isOnlyWhitespace && extractedImports) {
			return hasCode;
		}
		hasCode = true;
		return true;
	});
}
