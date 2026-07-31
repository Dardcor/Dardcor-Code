/**
 * Dardcor Code - Public dc / vscode Extension Namespace API Export (Task 605)
 * Mirrors: vs/workbench/api/common/extHost.api.impl.ts
 */

import { URI } from '../../core/types/uri';
import { IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { CancellationToken, CancellationTokenSource } from '../../core/async/cancellation';
import { RPCProtocol } from '../host/rpc-protocol';

export { URI as Uri } from '../../core/types/uri';
export { CancellationToken, CancellationTokenSource } from '../../core/async/cancellation';

export class Position {
	constructor(
		public readonly lineNumber: number,
		public readonly column: number
	) {
		if (lineNumber < 1) {
			throw new Error('lineNumber harus >= 1');
		}
		if (column < 1) {
			throw new Error('column harus >= 1');
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
		if (this.lineNumber !== other.lineNumber) {
			return this.lineNumber < other.lineNumber ? -1 : 1;
		}
		if (this.column !== other.column) {
			return this.column < other.column ? -1 : 1;
		}
		return 0;
	}

	public translate(lineDelta?: number, characterDelta?: number): Position;
	public translate(change: { lineDelta?: number; characterDelta?: number }): Position;
	public translate(lineDeltaOrChange: number | { lineDelta?: number; characterDelta?: number } = 0, characterDelta = 0): Position {
		const lineDelta = typeof lineDeltaOrChange === 'number' ? lineDeltaOrChange : (lineDeltaOrChange.lineDelta ?? 0);
		const charDelta = typeof lineDeltaOrChange === 'number' ? characterDelta : (lineDeltaOrChange.characterDelta ?? 0);
		return new Position(this.lineNumber + lineDelta, this.column + charDelta);
	}

	public with(lineNumber?: number, column?: number): Position {
		return new Position(lineNumber ?? this.lineNumber, column ?? this.column);
	}

	public toJSON(): any {
		return { lineNumber: this.lineNumber, column: this.column };
	}
}

export class Range {
	readonly start: Position;
	readonly end: Position;

	constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number);
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
		return this.start.lineNumber === this.end.lineNumber;
	}

	public contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
		}
		const pos = positionOrRange;
		if (pos.isBefore(this.start) || pos.isAfter(this.end)) {
			return false;
		}
		return !pos.isEqual(this.end) || this.end.column >= pos.column;
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

export class Location {
	constructor(
		public readonly uri: URI,
		public readonly range: Range
	) {}

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

export interface IDiagnosticRelatedInformation {
	location: Location;
	message: string;
}

export class Diagnostic {
	constructor(
		public range: Range,
		public message: string,
		public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
		public code?: string | number,
		public source?: string,
		public relatedInformation?: IDiagnosticRelatedInformation[]
	) {}

	public toJSON(): any {
		return {
			range: this.range.toJSON(),
			message: this.message,
			severity: this.severity,
			code: this.code,
			source: this.source,
			relatedInformation: this.relatedInformation?.map(r => ({ location: r.location.toJSON(), message: r.message }))
		};
	}
}

export class MarkdownString {
	constructor(public value = '') {}

	public isTrusted = false;
	public supportThemeIcons = false;

	public static isMarkdownString(value: any): value is MarkdownString {
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

	public toJSON(): any {
		return { value: this.value, isTrusted: this.isTrusted, supportThemeIcons: this.supportThemeIcons };
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

export interface IWorkspaceEditEntry {
	uri: string;
	edits: Array<{ range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; newText: string }>;
}

export class WorkspaceEdit {
	private readonly _edits = new Map<string, TextEdit[]>();

	public insert(uri: URI, position: Position, newText: string): void {
		this._push(uri, TextEdit.insert(position, newText));
	}

	public delete(uri: URI, range: Range): void {
		this._push(uri, TextEdit.delete(range));
	}

	public replace(uri: URI, range: Range, newText: string): void {
		this._push(uri, TextEdit.replace(range, newText));
	}

	public set(uri: URI, edits: TextEdit[]): void {
		this._edits.set(uri.toString(), edits.slice());
	}

	public has(uri: URI): boolean {
		return this._edits.has(uri.toString());
	}

	public entries(): Array<[URI, TextEdit[]]> {
		return [...this._edits.entries()].map(([key, edits]) => [URI.parse(key), edits.slice()]);
	}

	public toJSON(): IWorkspaceEditEntry[] {
		return this.entries().map(([uri, edits]) => ({
			uri: uri.toString(),
			edits: edits.map(e => ({ range: {
				startLineNumber: e.range.start.lineNumber,
				startColumn: e.range.start.column,
				endLineNumber: e.range.end.lineNumber,
				endColumn: e.range.end.column
			}, newText: e.newText }))
		}));
	}

	public static fromJSON(entries: IWorkspaceEditEntry[]): WorkspaceEdit {
		const edit = new WorkspaceEdit();
		for (const entry of entries) {
			edit.set(URI.parse(entry.uri), entry.edits.map(e => new TextEdit(
				new Range(e.range.startLineNumber, e.range.startColumn, e.range.endLineNumber, e.range.endColumn),
				e.newText
			)));
		}
		return edit;
	}

	private _push(uri: URI, edit: TextEdit): void {
		const key = uri.toString();
		let edits = this._edits.get(key);
		if (!edits) {
			edits = [];
			this._edits.set(key, edits);
		}
		edits.push(edit);
	}
}

export class EventEmitter<T> {
	private readonly _emitter = new Emitter<T>();

	readonly event: Event<T> = this._emitter.event;

	public fire(data: T): void {
		this._emitter.fire(data);
	}

	public dispose(): void {
		this._emitter.dispose();
	}
}

export class Disposable implements IDisposable {
	private _disposed = false;

	public static from(...disposables: Array<IDisposable | undefined | null>): Disposable {
		return new Disposable(() => {
			for (const d of disposables) {
				d?.dispose();
			}
		});
	}

	public static readonly None: Disposable = Object.freeze(new Disposable(() => undefined)) as Disposable;

	constructor(private readonly _disposeCallback?: () => void) {}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._disposeCallback?.();
	}

	public get isDisposed(): boolean {
		return this._disposed;
	}
}

export type DisposableLike = IDisposable | (() => void);

export function toApiDisposable(value: DisposableLike): Disposable {
	if (typeof value === 'function') {
		return new Disposable(value);
	}
	return value as Disposable;
}

export interface IExtHostContext {
	readonly rpc: RPCProtocol;
	readonly documents: import('./ext-host-documents').ExtHostDocuments;
	readonly editors: import('./ext-host-editors').ExtHostEditors;
	readonly workspace: import('./ext-host-workspace').ExtHostWorkspace;
	readonly window: import('./ext-host-window').ExtHostWindow;
	readonly commands: import('./ext-host-commands').ExtHostCommands;
	readonly languages: import('./ext-host-languages').ExtHostLanguageFeatures;
	readonly diagnostics: import('./ext-host-diagnostics').ExtHostDiagnostics;
	readonly debug: import('./ext-host-debug').ExtHostDebugService;
	readonly scm: import('./ext-host-scm').ExtHostSCM;
	readonly terminals: import('./ext-host-terminal').ExtHostTerminal;
	readonly webviews: import('./ext-host-webview').ExtHostWebview;
	readonly env: import('./ext-host-env').ExtHostEnv;
	readonly tasks: import('./ext-host-tasks').ExtHostTasks;
	readonly notebooks: import('./ext-host-notebooks').ExtHostNotebooks;
	readonly chat: import('./ext-host-chat').ExtHostChat;
}

export interface IExtensionApi {
	readonly version: string;
	readonly workspace: import('./ext-host-workspace').IWorkspaceApi;
	readonly window: import('./ext-host-window').IWindowApi;
	readonly commands: import('./ext-host-commands').ICommandsApi;
	readonly languages: import('./ext-host-languages').ILanguagesApi;
	readonly debug: import('./ext-host-debug').IDebugApi;
	readonly scm: import('./ext-host-scm').IScmApi;
	readonly terminal: import('./ext-host-terminal').ITerminalApi;
	readonly env: import('./ext-host-env').IEnvApi;
	readonly tasks: import('./ext-host-tasks').ITasksApi;
	readonly notebooks: import('./ext-host-notebooks').INotebooksApi;
	readonly chat: import('./ext-host-chat').IChatApi;
	readonly Uri: typeof URI;
	readonly Position: typeof Position;
	readonly Range: typeof Range;
	readonly Selection: typeof Selection;
	readonly Location: typeof Location;
	readonly Diagnostic: typeof Diagnostic;
	readonly DiagnosticSeverity: typeof DiagnosticSeverity;
	readonly MarkdownString: typeof MarkdownString;
	readonly TextEdit: typeof TextEdit;
	readonly WorkspaceEdit: typeof WorkspaceEdit;
	readonly EventEmitter: typeof EventEmitter;
	readonly Disposable: typeof Disposable;
	readonly CancellationTokenSource: typeof CancellationTokenSource;
	readonly CancellationToken: typeof CancellationToken;
	readonly ExtensionMode: any;
}

export function createExtensionApi(ctx: IExtHostContext): IExtensionApi {
	const api: IExtensionApi = {
		version: '1.90.0',
		workspace: ctx.workspace.api,
		window: ctx.window.api,
		commands: ctx.commands.api,
		languages: ctx.languages.api,
		debug: ctx.debug.api,
		scm: ctx.scm.api,
		terminal: ctx.terminals.api,
		env: ctx.env.api,
		tasks: ctx.tasks.api,
		notebooks: ctx.notebooks.api,
		chat: ctx.chat.api,
		Uri: URI,
		Position,
		Range,
		Selection,
		Location,
		Diagnostic,
		DiagnosticSeverity,
		MarkdownString,
		TextEdit,
		WorkspaceEdit,
		EventEmitter,
		Disposable,
		CancellationTokenSource,
		CancellationToken,
		ExtensionMode: Object.freeze({ Development: 1, Production: 2, Test: 3 })
	};
	return Object.freeze(api);
}

export function createNoopDisposable(): IDisposable {
	return toDisposable(() => undefined);
}
