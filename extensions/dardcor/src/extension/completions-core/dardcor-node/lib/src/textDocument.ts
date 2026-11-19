/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { detectLanguage } from './language/languageDetection';
import { normalizeUri } from './util/uri';
import { TextEdit } from '../../types/src';
import { TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import { TextDocument as LspTextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, SelectedCompletionInfo } from 'vscode-languageserver-types';

export { type Position as IPosition, type Range as IRange } from '../../types/src';

export class LocationFactory {
	static range = Range.create.bind(Range);
	static position = Position.create.bind(Position);
}

interface Line {
	text: string;
	range: Range;
	isEmptyOrWhitespace: boolean;
}

export type IntelliSenseInsertion = SelectedCompletionInfo & {
	tooltipSignature?: string;
};

export type TextDocumentValidation =
	| { status: 'invalid'; reason: string }
	| { status: 'notfound'; message: string }
	| { status: 'valid' };
export type TextDocumentResult<TD = TextDocumentContents> =
	| { status: 'invalid'; reason: string }
	| { status: 'notfound'; message: string }
	| { status: 'valid'; document: TD };

export interface TextDocumentIdentifier {
	readonly uri: string;
}

export interface TextDocumentContents {
	readonly uri: string;

	readonly detectedLanguageId: string;

	getText(range?: Range): string;

	positionAt(offset: number): Position;

	offsetAt(position: Position): number;

	readonly lineCount: number;

	lineAt(position: number | Position): Line;

	applyEdits(edits: TextEdit[]): TextDocumentContents;
}

export interface ITextDocument extends TextDocumentContents {
	readonly clientUri: string;

	readonly languageId: string;

	readonly clientLanguageId: string;

	readonly version: number;

	applyEdits(edits: TextEdit[]): ITextDocument;
}

export interface INotebookCell {
	readonly index: number;

	readonly document: ITextDocument;

	readonly metadata: { [key: string]: unknown };

	readonly kind: 1 | 2;
}

export interface INotebookDocument {
	getCells(): INotebookCell[];

	getCellFor({ uri }: { uri: string }): INotebookCell | undefined;
}

export class DardcorTextDocument implements ITextDocument {
	private constructor(
		readonly uri: string,
		private readonly _textDocument: LspTextDocument,
		readonly detectedLanguageId: string
	) { }

	static withChanges(textDocument: ITextDocument, changes: TextDocumentContentChangeEvent[], version: number) {
		const lspDoc = LspTextDocument.create(
			textDocument.clientUri,
			textDocument.clientLanguageId,
			version,
			textDocument.getText()
		);
		LspTextDocument.update(lspDoc, changes, version);
		return new DardcorTextDocument(textDocument.uri, lspDoc, textDocument.detectedLanguageId);
	}

	applyEdits(edits: TextEdit[]) {
		const lspDoc = LspTextDocument.create(this.clientUri, this.clientLanguageId, this.version, this.getText());
		LspTextDocument.update(
			lspDoc,
			edits.map(c => ({ text: c.newText, range: c.range })),
			this.version
		);
		return new DardcorTextDocument(this.uri, lspDoc, this.detectedLanguageId);
	}

	static create(
		uri: string,
		languageId: string,
		version: number,
		text: string,
		detectedLanguageId = detectLanguage({ uri, languageId })
	) {
		return new DardcorTextDocument(
			normalizeUri(uri),
			LspTextDocument.create(uri, languageId, version, text),
			detectedLanguageId
		);
	}

	get clientUri(): string {
		return this._textDocument.uri;
	}

	get clientLanguageId(): string {
		return this._textDocument.languageId;
	}

	get languageId(): string {
		return this._textDocument.languageId;
	}

	get version(): number {
		return this._textDocument.version;
	}

	get lineCount() {
		return this._textDocument.lineCount;
	}

	getText(range?: Range): string {
		return this._textDocument.getText(range);
	}

	positionAt(offset: number): Position {
		return this._textDocument.positionAt(offset);
	}

	offsetAt(position: Position): number {
		return this._textDocument.offsetAt(position);
	}

	lineAt(position: number | Position) {
		const lineNumber = typeof position === 'number' ? position : position.line;
		if (lineNumber < 0 || lineNumber >= this.lineCount) {
			throw new RangeError('Illegal value for lineNumber');
		}
		const rangeWithNewline = Range.create(lineNumber, 0, lineNumber + 1, 0);
		const text = this.getText(rangeWithNewline).replace(/\r\n$|\r$|\n$/g, '');
		const range = Range.create(Position.create(lineNumber, 0), Position.create(lineNumber, text.length));

		const isEmptyOrWhitespace = text.trim().length === 0;
		return { text, range, isEmptyOrWhitespace };
	}
}
