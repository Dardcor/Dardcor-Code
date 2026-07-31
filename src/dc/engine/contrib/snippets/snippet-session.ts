/**
 * Dardcor Code - Active Snippet Tab Stop Cursor Session
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { SnippetParser, SnippetNode, SnippetNodeKind, snippetNodesToText } from "./snippet-parser.js";

export interface ISnippetTabStop {
	readonly index: number;
	range: IRange;

	readonly defaultValue: string;
}

export interface ISnippetSessionState {
	readonly isActive: boolean;
	readonly snippetText: string;
	readonly tabStops: readonly ISnippetTabStop[];
	readonly currentIndex: number;
}

export class SnippetSession extends Disposable {
	private _model: ITextModel | null = null;
	private _tabStops: ISnippetTabStop[] = [];
	private _currentIndex: number = 0;
	private _isActive: boolean = false;
	private _snippetText: string = "";
	private _baseOffset: number = 0;
	private _sessionId: number = 0;

	private readonly _onDidChange = this._register(new Emitter<ISnippetSessionState | null>());
	readonly onDidChange: Event<ISnippetSessionState | null> = this._onDidChange.event;

	private readonly _onDidEnd = this._register(new Emitter<void>());
	readonly onDidEnd: Event<void> = this._onDidEnd.event;

	public static start(model: ITextModel, snippetString: string, position: IPosition): SnippetSession | null {
		const session = new SnippetSession();
		if (!session._start(model, snippetString, position)) {
			session.dispose();
			return null;
		}
		return session;
	}

	private _start(model: ITextModel, snippetString: string, position: IPosition): boolean {
		const parsed = SnippetParser.parse(snippetString);
		if (parsed.error) {
			return false;
		}
		this._model = model;
		const offset = this._offsetAt(model, position.lineNumber, position.column);
		if (offset < 0) {
			return false;
		}
		const text = snippetNodesToText(parsed.ast.nodes);
		const value = model.getValue();
		model.setValue(value.substring(0, offset) + text + value.substring(offset));

		const tabStops = this._collectTabStops(parsed.ast.nodes, offset);
		this._tabStops = this._toRanges(model, tabStops);
		this._baseOffset = offset;
		this._snippetText = text;
		this._currentIndex = this._tabStops.length > 0 ? 0 : -1;
		this._isActive = this._tabStops.length > 0;
		this._sessionId++;
		this._onDidChange.fire(this.getState());
		return this._isActive;
	}

	private _collectTabStops(nodes: SnippetNode[], baseOffset: number): { index: number; offset: number; length: number }[] {
		const tabStops = new Map<number, { index: number; offset: number; length: number }>();
		let cursor = baseOffset;
		const walk = (node: SnippetNode): number => {
			switch (node.kind) {
				case SnippetNodeKind.Text:
				case SnippetNodeKind.EscapedText:
					return cursor + node.value.length;
				case SnippetNodeKind.TabStop:
					if (node.index > 0) {
						tabStops.set(node.index, { index: node.index, offset: cursor, length: node.defaultValue?.length ?? 0 });
					}
					return cursor + (node.defaultValue?.length ?? 0);
				case SnippetNodeKind.Placeholder:
					if (node.index > 0) {
						tabStops.set(node.index, { index: node.index, offset: cursor, length: node.defaultValue.length });
					}
					return cursor + node.defaultValue.length;
				case SnippetNodeKind.Variable:
					return cursor + (node.defaultValue?.length ?? 0);
				case SnippetNodeKind.Choice:
					tabStops.set(node.index, { index: node.index, offset: cursor, length: node.choices[0]?.length ?? 0 });
					return cursor + (node.choices[0]?.length ?? 0);
			}
		};
		for (const node of nodes) {
			cursor = walk(node);
		}
		return [...tabStops.values()].sort((a, b) => a.index - b.index);
	}

	private _toRanges(model: ITextModel, tabStops: { index: number; offset: number; length: number }[]): ISnippetTabStop[] {
		const offsets = this._computeLineOffsets(model);
		return tabStops.map(ts => {
			const start = this._positionAt(offsets, ts.offset);
			const end = this._positionAt(offsets, ts.offset + ts.length);
			const line = model.getLineContent(start.lineNumber);
			return {
				index: ts.index,
				defaultValue: line.substring(start.column - 1, end.column - 1),
				range: {
					startLineNumber: start.lineNumber,
					startColumn: start.column,
					endLineNumber: end.lineNumber,
					endColumn: end.column
				}
			};
		});
	}

	public advance(): boolean {
		if (!this._isActive) {
			return false;
		}
		if (this._currentIndex >= this._tabStops.length - 1) {
			this.end();
			return false;
		}
		this._currentIndex++;
		this._onDidChange.fire(this.getState());
		return true;
	}

	public goToPrevious(): boolean {
		if (!this._isActive || this._currentIndex <= 0) {
			return false;
		}
		this._currentIndex--;
		this._onDidChange.fire(this.getState());
		return true;
	}

	public goToTabStop(index: number): boolean {
		if (!this._isActive) {
			return false;
		}
		const tabStopIndex = this._tabStops.findIndex(ts => ts.index === index);
		if (tabStopIndex === -1) {
			return false;
		}
		this._currentIndex = tabStopIndex;
		this._onDidChange.fire(this.getState());
		return true;
	}

	public updateCurrentText(newText: string): boolean {
		const model = this._model;
		const current = this.getCurrentTabStop();
		if (!model || !current) {
			return false;
		}
		const value = model.getValue();
		const offsets = this._computeLineOffsets(model);
		const start = this._offsetAt(model, current.range.startLineNumber, current.range.startColumn);
		const end = this._offsetAt(model, current.range.endLineNumber, current.range.endColumn);
		if (start < 0 || end < start || end > value.length) {
			return false;
		}
		const next = value.substring(0, start) + newText + value.substring(end);
		model.setValue(next);
		void offsets;
		const delta = newText.length - (end - start);
		for (const ts of this._tabStops) {
			const tsStart = this._offsetAt(model, ts.range.startLineNumber, ts.range.startColumn);
			const tsEnd = this._offsetAt(model, ts.range.endLineNumber, ts.range.endColumn);
			const wasAfter = tsStart >= end;
			const wasCurrent = ts === current;
			if (wasAfter) {
				ts.range = this._shiftRange(ts.range, delta);
			} else if (wasCurrent) {
				ts.range = this._shiftRange(ts.range, delta);
			}
		}
		this._onDidChange.fire(this.getState());
		return true;
	}

	private _shiftRange(range: IRange, delta: number): IRange {
		if (delta === 0) {
			return range;
		}
		const model = this._model!;
		const offsets = this._computeLineOffsets(model);
		const startOffset = this._offsetAt(model, range.startLineNumber, range.startColumn);
		const endOffset = this._offsetAt(model, range.endLineNumber, range.endColumn);
		const newStart = this._positionAt(offsets, startOffset + delta);
		const newEnd = this._positionAt(offsets, endOffset + delta);
		return {
			startLineNumber: newStart.lineNumber,
			startColumn: newStart.column,
			endLineNumber: newEnd.lineNumber,
			endColumn: newEnd.column
		};
	}

	public end(): void {
		if (!this._isActive) {
			return;
		}
		this._isActive = false;
		this._tabStops = [];
		this._currentIndex = -1;
		this._sessionId++;
		this._onDidChange.fire(null);
		this._onDidEnd.fire();
	}

	public getCurrentTabStop(): ISnippetTabStop | null {
		if (!this._isActive || this._currentIndex < 0 || this._currentIndex >= this._tabStops.length) {
			return null;
		}
		return this._tabStops[this._currentIndex];
	}

	public getTabStops(): readonly ISnippetTabStop[] {
		return this._tabStops;
	}

	public hasActiveSession(): boolean {
		return this._isActive;
	}

	public getCurrentIndex(): number {
		return this._currentIndex;
	}

	public getSessionId(): number {
		return this._sessionId;
	}

	public getState(): ISnippetSessionState | null {
		if (!this._isActive) {
			return null;
		}
		return {
			isActive: true,
			snippetText: this._snippetText,
			tabStops: this._tabStops,
			currentIndex: this._currentIndex
		};
	}

	private _computeLineOffsets(model: ITextModel): number[] {
		const offsets: number[] = [0];
		for (let line = 1; line <= model.getLineCount(); line++) {
			offsets.push(offsets[offsets.length - 1] + model.getLineContent(line).length + 1);
		}
		return offsets;
	}

	private _offsetAt(model: ITextModel, lineNumber: number, column: number): number {
		if (lineNumber < 1 || lineNumber > model.getLineCount()) {
			return -1;
		}
		const offsets = this._computeLineOffsets(model);
		return offsets[lineNumber - 1] + (column - 1);
	}

	private _positionAt(offsets: number[], offset: number): IPosition {
		let lineNumber = 1;
		for (let line = 1; line < offsets.length; line++) {
			if (offset < offsets[line]) {
				lineNumber = line;
				break;
			}
			lineNumber = line;
		}
		return { lineNumber, column: offset - offsets[lineNumber - 1] + 1 };
	}
}
