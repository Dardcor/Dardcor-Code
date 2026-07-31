/**
 * Dardcor Code - dc.TextEditor Object Wrapper (Task 632)
 * Mirrors: vs/workbench/api/common/extHostTextEditor.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol.js';
import { TextDocument } from './ext-host-documents.js';
import { Position, Range, Selection } from './ext-host-api-impl.js';

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3
}

export enum TextEditorSelectionChangeKind {
	Keyboard = 1,
	Mouse = 2,
	Command = 3
}

export interface ITextEditorOptionsData {
	tabSize?: number | string;
	insertSpaces?: boolean | string;
	cursorStyle?: string;
}

export interface ITextEditorData {
	uri: string;
	viewColumn: number;
	selection: { anchor: Position; active: Position };
	selections: Array<{ anchor: Position; active: Position }>;
	options: ITextEditorOptionsData;
	visibleRanges: Range[];
	visible: boolean;
	active: boolean;
}

export interface ITextEditorEditData {
	range: Range;
	text: string;
	forceMoveMarkers?: boolean;
}

export interface ITextEditorEditBuilder {
	replace(location: Range | Selection | Position, value: string): void;
	insert(location: Position, value: string): void;
	delete(location: Range | Selection): void;
}

export class TextEditorEdit implements ITextEditorEditBuilder {
	private readonly _edits: ITextEditorEditData[] = [];

	constructor(private readonly _document: TextDocument) {}

	public replace(location: Range | Selection | Position, value: string): void {
		const range = this._toRange(location);
		this._edits.push({ range, text: value });
	}

	public insert(location: Position, value: string): void {
		this._edits.push({ range: new Range(location, location), text: value });
	}

	public delete(location: Range | Selection): void {
		this._edits.push({ range: this._toRange(location), text: '' });
	}

	public get edits(): ITextEditorEditData[] {
		return this._edits.slice();
	}

	private _toRange(location: Range | Selection | Position): Range {
		if (location instanceof Range) {
			return new Range(location.start, location.end);
		}
		return new Range(location, location);
	}
}

export class TextEditorDecorationType implements IDisposable {
	private readonly _onDidDispose = new Emitter<void>();
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	constructor(
		public readonly key: string,
		private readonly _rpc: RPCProtocol
	) {}

	public dispose(): void {
		this._rpc.notify('editors', 'decorationType.dispose', { key: this.key });
		this._onDidDispose.fire();
	}
}

export interface ITextEditorDecorationOptions {
	readonly range: Range;
	readonly hoverMessage?: string;
	readonly renderOptions?: Record<string, unknown>;
}

export class TextEditor {
	private _selection: Selection;
	private _selections: Selection[];
	private _options: ITextEditorOptionsData;
	private _visibleRanges: Range[];
	private _viewColumn: number;
	private _visible: boolean;
	private _active: boolean;

	constructor(
		private readonly _rpc: RPCProtocol,
		readonly document: TextDocument,
		data: Partial<ITextEditorData> = {}
	) {
		const anchor = data.selection?.anchor ?? new Position(1, 1);
		const active = data.selection?.active ?? new Position(1, 1);
		this._selection = new Selection(anchor, active);
		this._selections = (data.selections ?? []).map(s => new Selection(s.anchor, s.active));
		this._options = data.options ?? {};
		this._visibleRanges = data.visibleRanges ?? [new Range(new Position(1, 1), new Position(1, 1))];
		this._viewColumn = data.viewColumn ?? 1;
		this._visible = data.visible ?? true;
		this._active = data.active ?? false;
	}

	public get selection(): Selection {
		return this._selection;
	}

	public set selection(value: Selection) {
		this._selection = value;
		this._rpc.notify('editors', 'setSelection', {
			uri: this.document.uri.toString(),
			selection: { anchor: value.anchor, active: value.active }
		});
	}

	public get selections(): Selection[] {
		return this._selections;
	}

	public set selections(value: Selection[]) {
		this._selections = value;
		this._rpc.notify('editors', 'setSelections', {
			uri: this.document.uri.toString(),
			selections: value.map(s => ({ anchor: s.anchor, active: s.active }))
		});
	}

	public get options(): ITextEditorOptionsData {
		return { ...this._options };
	}

	public set options(value: ITextEditorOptionsData) {
		this._options = { ...this._options, ...value };
		this._rpc.notify('editors', 'setOptions', { uri: this.document.uri.toString(), options: this._options });
	}

	public get viewColumn(): number {
		return this._viewColumn;
	}

	public get visibleRanges(): Range[] {
		return this._visibleRanges;
	}

	public get visible(): boolean {
		return this._visible;
	}

	public get active(): boolean {
		return this._active;
	}

	public async edit(callback: (editBuilder: TextEditorEdit) => void, options?: { undoStopBefore: boolean; undoStopAfter: boolean }): Promise<boolean> {
		const builder = new TextEditorEdit(this.document);
		callback(builder);
		const edits = builder.edits;
		if (edits.length === 0) {
			return true;
		}
		return this._rpc.call<boolean>('editors', 'edit', {
			uri: this.document.uri.toString(),
			edits,
			options
		});
	}

	public insert(position: Position, value: string): Promise<boolean> {
		return this.edit(builder => builder.insert(position, value));
	}

	public delete(range: Range): Promise<boolean> {
		return this.edit(builder => builder.delete(range));
	}

	public replace(range: Range, value: string): Promise<boolean> {
		return this.edit(builder => builder.replace(range, value));
	}

	public setDecorations(decorationType: TextEditorDecorationType, rangesOrOptions: Range[] | ITextEditorDecorationOptions[]): void {
		this._rpc.notify('editors', 'setDecorations', {
			uri: this.document.uri.toString(),
			key: decorationType.key,
			ranges: rangesOrOptions.map(r => (r instanceof Range ? r : r.range))
		});
	}

	public revealRange(range: Range, revealType: TextEditorRevealType = TextEditorRevealType.Default): void {
		this._rpc.notify('editors', 'revealRange', { uri: this.document.uri.toString(), range, revealType });
	}

	public show(column?: number): void {
		this._rpc.notify('editors', 'show', { uri: this.document.uri.toString(), column });
	}

	public hide(): void {
		this._rpc.notify('editors', 'hide', { uri: this.document.uri.toString() });
	}

	public toJSON(): ITextEditorData {
		return {
			uri: this.document.uri.toString(),
			viewColumn: this._viewColumn,
			selection: { anchor: this._selection.anchor, active: this._selection.active },
			selections: this._selections.map(s => ({ anchor: s.anchor, active: s.active })),
			options: this._options,
			visibleRanges: this._visibleRanges,
			visible: this._visible,
			active: this._active
		};
	}

	public updateFromData(data: Partial<ITextEditorData>): void {
		if (data.selection) {
			this._selection = new Selection(data.selection.anchor, data.selection.active);
		}
		if (data.selections) {
			this._selections = data.selections.map(s => new Selection(s.anchor, s.active));
		}
		if (data.options) {
			this._options = data.options;
		}
		if (data.visibleRanges) {
			this._visibleRanges = data.visibleRanges;
		}
		if (data.viewColumn !== undefined) {
			this._viewColumn = data.viewColumn;
		}
		if (data.visible !== undefined) {
			this._visible = data.visible;
		}
		if (data.active !== undefined) {
			this._active = data.active;
		}
	}
}

export function createDecorationType(rpc: RPCProtocol, key: string): TextEditorDecorationType {
	return new TextEditorDecorationType(key, rpc);
}
