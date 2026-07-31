/**
 * Dardcor Code - Sync Mirror of Open Workspace Documents in Extension Host (Task 633)
 * Mirrors: vs/workbench/api/common/extHostDocuments.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { URI } from '../../core/types/uri';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol';
import { Position, Range } from './ext-host-api-impl';

export interface ITextDocumentData {
	uri: string;
	languageId: string;
	version: number;
	text: string;
	eol: 'lf' | 'crlf';
}

export interface TextLine {
	readonly lineNumber: number;
	readonly text: string;
	readonly range: Range;
	readonly rangeIncludingLineBreak: Range;
	readonly firstNonWhitespaceCharacterIndex: number;
	readonly isEmptyOrWhitespace: boolean;
}

export interface TextDocumentContentChangeEvent {
	readonly range: Range;
	readonly rangeOffset: number;
	readonly rangeLength: number;
	readonly text: string;
}

export interface TextDocumentChangeEvent {
	readonly document: TextDocument;
	readonly contentChanges: TextDocumentContentChangeEvent[];
}

export class TextDocument {
	private _text: string;
	private _eol: 'lf' | 'crlf';

	constructor(
		readonly uri: URI,
		private _languageId: string,
		private _version: number,
		initialText: string,
		eol: 'lf' | 'crlf' = 'lf'
	) {
		this._text = initialText;
		this._eol = eol;
	}

	public get languageId(): string {
		return this._languageId;
	}

	public get version(): number {
		return this._version;
	}

	public get isDirty(): boolean {
		return false;
	}

	public get isClosed(): boolean {
		return false;
	}

	public get isUntitled(): boolean {
		return this.uri.scheme === 'untitled';
	}

	public get lineCount(): number {
		return this._lines().length;
	}

	public get eol(): 'lf' | 'crlf' {
		return this._eol;
	}

	public getText(range?: Range): string {
		if (!range) {
			return this._text;
		}
		const lines = this._lines();
		const startLine = range.start.lineNumber - 1;
		const endLine = range.end.lineNumber - 1;
		if (startLine === endLine) {
			return lines[startLine]?.substring(range.start.column - 1, range.end.column - 1) ?? '';
		}
		const parts: string[] = [];
		parts.push(lines[startLine]?.substring(range.start.column - 1) ?? '');
		for (let i = startLine + 1; i < endLine; i++) {
			parts.push(lines[i] ?? '');
		}
		parts.push(lines[endLine]?.substring(0, range.end.column - 1) ?? '');
		return parts.join('\n');
	}

	public lineAt(lineOrPosition: number | Position): TextLine {
		const lineNumber = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.lineNumber;
		const lines = this._lines();
		const text = lines[lineNumber - 1] ?? '';
		const offset = this._offsetForLine(lineNumber);
		const start = new Position(lineNumber, 1);
		const end = new Position(lineNumber, text.length + 1);
		const firstNonWhitespace = text.search(/\S/);
		return {
			lineNumber,
			text,
			range: new Range(start, end),
			rangeIncludingLineBreak: new Range(start, new Position(lineNumber + 1, 1)),
			firstNonWhitespaceCharacterIndex: firstNonWhitespace === -1 ? 0 : firstNonWhitespace,
			isEmptyOrWhitespace: firstNonWhitespace === -1
		};
	}

	public offsetAt(position: Position): number {
		const lines = this._lines();
		const lineIndex = position.lineNumber - 1;
		let offset = 0;
		for (let i = 0; i < lineIndex; i++) {
			offset += (lines[i]?.length ?? 0) + 1;
		}
		return offset + (position.column - 1);
	}

	public positionAt(offset: number): Position {
		const lines = this._lines();
		let remaining = Math.max(0, offset);
		for (let i = 0; i < lines.length; i++) {
			const lineLength = lines[i].length;
			if (remaining <= lineLength) {
				return new Position(i + 1, remaining + 1);
			}
			remaining -= lineLength + 1;
		}
		return new Position(lines.length, (lines[lines.length - 1]?.length ?? 0) + 1);
	}

	public save(): Promise<boolean> {
		return Promise.resolve(true);
	}

	public applyContentChanges(changes: TextDocumentContentChangeEvent[], version: number): void {
		for (const change of changes) {
			const startOffset = this.offsetAt(change.range.start);
			const endOffset = this.offsetAt(change.range.end);
			this._text = this._text.substring(0, startOffset) + change.text + this._text.substring(endOffset);
		}
		this._version = version;
	}

	public toJSON(): ITextDocumentData {
		return {
			uri: this.uri.toString(),
			languageId: this._languageId,
			version: this._version,
			text: this._text,
			eol: this._eol
		};
	}

	public static fromJSON(data: ITextDocumentData): TextDocument {
		return new TextDocument(URI.parse(data.uri), data.languageId, data.version, data.text, data.eol);
	}

	private _lines(): string[] {
		return this._text.split(/\r?\n/);
	}

	private _offsetForLine(lineNumber: number): number {
		const lines = this._lines();
		let offset = 0;
		for (let i = 0; i < lineNumber - 1; i++) {
			offset += (lines[i]?.length ?? 0) + 1;
		}
		return offset;
	}
}

/**
 * Mirror of the documents currently open in the main editor. The main
 * side pushes open/change/close notifications through the RPC channel.
 */
export class ExtHostDocuments extends Disposable {
	private readonly _documents = new Map<string, TextDocument>();

	private readonly _onDidOpenTextDocument = this._register(new Emitter<TextDocument>());
	readonly onDidOpenTextDocument: Event<TextDocument> = this._onDidOpenTextDocument.event;

	private readonly _onDidChangeTextDocument = this._register(new Emitter<TextDocumentChangeEvent>());
	readonly onDidChangeTextDocument: Event<TextDocumentChangeEvent> = this._onDidChangeTextDocument.event;

	private readonly _onDidCloseTextDocument = this._register(new Emitter<TextDocument>());
	readonly onDidCloseTextDocument: Event<TextDocument> = this._onDidCloseTextDocument.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
	}

	public getDocument(uri: URI | string): TextDocument | undefined {
		return this._documents.get(typeof uri === 'string' ? uri : uri.toString());
	}

	public getAllDocuments(): TextDocument[] {
		return [...this._documents.values()];
	}

	public addDocument(data: ITextDocumentData): TextDocument {
		const existing = this._documents.get(data.uri);
		if (existing) {
			return existing;
		}
		const document = TextDocument.fromJSON(data);
		this._documents.set(data.uri, document);
		this._onDidOpenTextDocument.fire(document);
		return document;
	}

	public removeDocument(uri: string): void {
		const document = this._documents.get(uri);
		if (document) {
			this._documents.delete(uri);
			this._onDidCloseTextDocument.fire(document);
		}
	}

	public changeDocument(uri: string, changes: TextDocumentContentChangeEvent[], version: number): void {
		const document = this._documents.get(uri);
		if (!document) {
			return;
		}
		document.applyContentChanges(changes, version);
		this._onDidChangeTextDocument.fire({ document, contentChanges: changes });
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$open':
						return this.addDocument(payload as ITextDocumentData)?.toJSON();
					case '$change':
						this.changeDocument(payload.uri, payload.changes, payload.version);
						return undefined;
					case '$close':
						this.removeDocument(payload.uri);
						return undefined;
					case '$all':
						this._documents.clear();
						for (const doc of (payload as ITextDocumentData[])) {
							this._documents.set(doc.uri, TextDocument.fromJSON(doc));
						}
						return this.getAllDocuments().map(d => d.toJSON());
					case '$get':
						return this.getDocument(payload.uri)?.toJSON();
					default:
						throw new Error(`Perintah dokumen tidak dikenal: ${command}`);
				}
			},
			notify: (command: string, payload: any) => {
				if (command === '$open') {
					this.addDocument(payload as ITextDocumentData);
				} else if (command === '$change') {
					this.changeDocument(payload.uri, payload.changes, payload.version);
				} else if (command === '$close') {
					this.removeDocument(payload.uri);
				}
			}
		};
	}
}
