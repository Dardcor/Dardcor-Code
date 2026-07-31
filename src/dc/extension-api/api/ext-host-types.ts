import { URI } from '../../core/types/uri';
import { Event } from '../../core/events/emitter';
import { CancellationToken, CancellationTokenSource } from '../../core/async/cancellation';

export { CancellationToken, CancellationTokenSource } from '../../core/async/cancellation';
export { URI } from '../../core/types/uri';

export interface IExtHostRpc {
	call<T = unknown>(channel: string, method: string, args?: unknown[]): Promise<T>;
	notify(channel: string, method: string, args?: unknown[]): void;
	onEvent<T = unknown>(channel: string, event: string): Event<T>;
}

export interface IPosition {
	readonly line: number;
	readonly character: number;
}

export class Position implements IPosition {
	constructor(
		public readonly line: number,
		public readonly character: number
	) {
		if (line < 0) {
			throw new Error('line harus >= 0');
		}
		if (character < 0) {
			throw new Error('character harus >= 0');
		}
	}

	public isBefore(other: Position): boolean {
		return this.compareTo(other) < 0;
	}

	public isBeforeOrEqual(other: Position): boolean {
		return this.compareTo(other) <= 0;
	}

	public isAfter(other: Position): boolean {
		return this.compareTo(other) > 0;
	}

	public isAfterOrEqual(other: Position): boolean {
		return this.compareTo(other) >= 0;
	}

	public isEqual(other: Position): boolean {
		return this.compareTo(other) === 0;
	}

	public compareTo(other: Position): number {
		if (this.line !== other.line) {
			return this.line < other.line ? -1 : 1;
		}
		if (this.character !== other.character) {
			return this.character < other.character ? -1 : 1;
		}
		return 0;
	}

	public translate(lineDelta?: number, characterDelta?: number): Position;
	public translate(change: { lineDelta?: number; characterDelta?: number }): Position;
	public translate(lineDeltaOrChange: number | { lineDelta?: number; characterDelta?: number } = 0, characterDelta = 0): Position {
		const lineDelta = typeof lineDeltaOrChange === 'number' ? lineDeltaOrChange : (lineDeltaOrChange.lineDelta ?? 0);
		const charDelta = typeof lineDeltaOrChange === 'number' ? characterDelta : (lineDeltaOrChange.characterDelta ?? 0);
		return new Position(this.line + lineDelta, this.character + charDelta);
	}

	public with(line?: number, character?: number): Position {
		return new Position(line ?? this.line, character ?? this.character);
	}

	public toJSON(): any {
		return { line: this.line, character: this.character };
	}
}

export interface IRange {
	readonly start: IPosition;
	readonly end: IPosition;
}

export class Range implements IRange {
	readonly start: Position;
	readonly end: Position;

	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
	constructor(start: Position, end: Position);
	constructor(a1: number | Position, a2: number | Position, a3?: number, a4?: number) {
		if (typeof a1 === 'number') {
			this.start = new Position(a1, a2 as number);
			this.end = new Position(a3!, a4!);
		} else {
			this.start = a1;
			this.end = a2 as Position;
		}
	}

	get isEmpty(): boolean {
		return this.start.isEqual(this.end);
	}

	get isSingleLine(): boolean {
		return this.start.line === this.end.line;
	}

	public contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
		}
		const position = positionOrRange;
		if (position.isBefore(this.start) || position.isAfter(this.end)) {
			return false;
		}
		return !position.isEqual(this.end) || this.end.character >= position.character;
	}

	public isEqual(other: Range): boolean {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end);
	}

	public union(other: Range): Range {
		return new Range(
			this.start.isBefore(other.start) ? this.start : other.start,
			this.end.isAfter(other.end) ? this.end : other.end
		);
	}

	public intersection(other: Range): Range | undefined {
		const start = this.start.isAfter(other.start) ? this.start : other.start;
		const end = this.end.isBefore(other.end) ? this.end : other.end;
		if (start.isAfter(end)) {
			return undefined;
		}
		return new Range(start, end);
	}

	public with(start?: Position, end?: Position): Range {
		return new Range(start ?? this.start, end ?? this.end);
	}

	public toJSON(): any {
		return { start: this.start.toJSON(), end: this.end.toJSON() };
	}
}

export class Selection extends Range {
	constructor(
		anchor: Position,
		active: Position
	) {
		const start = anchor.isBeforeOrEqual(active) ? anchor : active;
		const end = anchor.isBeforeOrEqual(active) ? active : anchor;
		super(start, end);
		this.anchor = anchor;
		this.active = active;
	}

	readonly anchor: Position;
	readonly active: Position;

	get isReversed(): boolean {
		return this.anchor === this.end;
	}

	public toJSON(): any {
		return { anchor: this.anchor.toJSON(), active: this.active.toJSON(), start: this.start.toJSON(), end: this.end.toJSON() };
	}
}

export class Uri {
	private readonly _uri: URI;

	private constructor(uri: URI) {
		this._uri = uri;
	}

	public static parse(value: string): Uri {
		return new Uri(URI.parse(value));
	}

	public static file(path: string): Uri {
		return new Uri(URI.file(path));
	}

	public static from(components: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
		return new Uri(URI.from(components));
	}

	public static isUri(value: unknown): value is Uri {
		return value instanceof Uri;
	}

	public get scheme(): string {
		return this._uri.scheme;
	}

	public get authority(): string {
		return this._uri.authority;
	}

	public get path(): string {
		return this._uri.path;
	}

	public get query(): string {
		return this._uri.query;
	}

	public get fragment(): string {
		return this._uri.fragment;
	}

	public toCoreUri(): URI {
		return this._uri;
	}

	public toString(): string {
		return this._uri.toString();
	}

	public toJSON(): any {
		return this._uri.toJSON();
	}
}

export class Location {
	constructor(
		public readonly uri: Uri,
		public readonly range: Range
	) {}

	public static create(uri: Uri, range: Range): Location {
		return new Location(uri, range);
	}

	public toJSON(): any {
		return { uri: this.uri.toString(), range: this.range.toJSON() };
	}
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3
}

export interface IDiagnostic {
	severity: DiagnosticSeverity;
	range: Range;
	message: string;
	code?: string | number;
	source?: string;
}

export class Diagnostic implements IDiagnostic {
	constructor(
		public severity: DiagnosticSeverity,
		public range: Range,
		public message: string,
		public code?: string | number,
		public source?: string
	) {}

	public toJSON(): any {
		return {
			severity: this.severity,
			range: this.range.toJSON(),
			message: this.message,
			code: this.code,
			source: this.source
		};
	}
}

export class TextEdit {
	constructor(
		public readonly range: Range,
		public readonly newText: string
	) {}

	public static replace(range: Range, newText: string): TextEdit {
		return new TextEdit(range, newText);
	}

	public static insert(position: Position, newText: string): TextEdit {
		return new TextEdit(new Range(position, position), newText);
	}

	public static delete(range: Range): TextEdit {
		return new TextEdit(range, '');
	}

	public toJSON(): any {
		return { range: this.range.toJSON(), newText: this.newText };
	}
}

export class WorkspaceEdit {
	private readonly _edits = new Map<string, TextEdit[]>();

	public insert(uri: Uri, position: Position, newText: string): void {
		this._push(uri, TextEdit.insert(position, newText));
	}

	public delete(uri: Uri, range: Range): void {
		this._push(uri, TextEdit.delete(range));
	}

	public replace(uri: Uri, range: Range, newText: string): void {
		this._push(uri, TextEdit.replace(range, newText));
	}

	public set(uri: Uri, edits: TextEdit[]): void {
		this._edits.set(uri.toString(), edits.slice());
	}

	public has(uri: Uri): boolean {
		return this._edits.has(uri.toString());
	}

	public entries(): Array<[Uri, TextEdit[]]> {
		return [...this._edits.entries()].map(([key, edits]) => [Uri.parse(key), edits.slice()]);
	}

	public toJSON(): any {
		return this.entries().map(([uri, edits]) => ({
			uri: uri.toString(),
			edits: edits.map(edit => edit.toJSON())
		}));
	}

	private _push(uri: Uri, edit: TextEdit): void {
		const key = uri.toString();
		let edits = this._edits.get(key);
		if (!edits) {
			edits = [];
			this._edits.set(key, edits);
		}
		edits.push(edit);
	}
}

export class MarkdownString {
	constructor(public value = '') {}

	public isTrusted = false;
	public supportThemeIcons = false;

	public static isMarkdownString(value: unknown): value is MarkdownString {
		return value instanceof MarkdownString;
	}

	public appendText(text: string): MarkdownString {
		this.value += text;
		return this;
	}

	public appendMarkdown(value: string): MarkdownString {
		this.value += value;
		return this;
	}

	public appendCodeblock(code: string, language = ''): MarkdownString {
		this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
		return this;
	}
}

export interface CompletionItem {
	label: string;
	kind?: number;
	detail?: string;
	documentation?: string | MarkdownString;
	insertText?: string;
	sortText?: string;
	filterText?: string;
	preselect?: boolean;
	command?: { title: string; command: string; arguments?: any[] };
}

export interface Hover {
	contents: Array<string | MarkdownString> | string | MarkdownString;
	range?: Range;
}

export interface DecorationOptions {
	range: Range;
	hoverMessage?: string | MarkdownString;
	renderOptions?: Record<string, any>;
}

export class FileSystemError extends Error {
	constructor(message: string, public readonly code: string) {
		super(message);
		this.name = 'FileSystemError';
	}

	public static FileNotFound(messageOrUri?: string | Uri): FileSystemError {
		return new FileSystemError(messageOrUri !== undefined ? String(messageOrUri) : 'File not found', 'FileNotFound');
	}

	public static FileIsADirectory(messageOrUri?: string | Uri): FileSystemError {
		return new FileSystemError(messageOrUri !== undefined ? String(messageOrUri) : 'File is a directory', 'FileIsADirectory');
	}

	public static NoPermissions(messageOrUri?: string | Uri): FileSystemError {
		return new FileSystemError(messageOrUri !== undefined ? String(messageOrUri) : 'No permissions', 'NoPermissions');
	}

	public static Unknown(messageOrUri?: string | Uri): FileSystemError {
		return new FileSystemError(messageOrUri !== undefined ? String(messageOrUri) : 'Unknown error', 'Unknown');
	}

	public static isFileSystemError(error: unknown): error is FileSystemError {
		return error instanceof FileSystemError;
	}
}
