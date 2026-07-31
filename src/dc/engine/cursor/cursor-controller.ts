/**
 * Dardcor Code - Cursor Movement & Selection State Machine (Task 218)
 * Mirrors: vs/editor/common/cursor/cursor.ts
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { ITextModel, Position, Range } from '../model/text-model.js';
import { EditStack } from '../model/edit-stack.js';
import { EditorOptions } from '../options/editor-options.js';
import { ViewLayout } from '../view/view-layout.js';
import { MultiCursor } from './multi-cursor.js';
import { CursorOperations, CursorSelection, positionsEqual } from './cursor-operations.js';

export enum CursorMoveCommand {
	Left = 'left',
	Right = 'right',
	Up = 'up',
	Down = 'down',
	WordLeft = 'wordLeft',
	WordRight = 'wordRight',
	LineStart = 'lineStart',
	LineEnd = 'lineEnd',
	PageUp = 'pageUp',
	PageDown = 'pageDown',
	Top = 'top',
	Bottom = 'bottom',
}

export interface IEditOperationInput {
	readonly range: Range;
	readonly text: string;
}

export interface ICursorState {
	position: Position;
	selection: Range;
	stickyColumn: number;
}


export interface ICursorControllerContext {
	readonly model: ITextModel;
	readonly multiCursor: MultiCursor;
	readonly editStack?: EditStack;
	readonly layout?: ViewLayout;
	readonly options?: EditorOptions;
}

export interface ICursorPositionChangedEvent {
	readonly position: Position;
	readonly reason: 'set' | 'move' | 'edit' | 'undo' | 'redo';
}

export interface IEditEvent {
	readonly edits: IEditOperationInput[];
	readonly label?: string;
}

function rangeFromPositions(start: Position, end: Position): Range {
	return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

function applyEditsToText(text: string, edits: IEditOperationInput[]): string {
	const lines = text.split('\n');
	const lineStarts: number[] = [];
	let total = 0;
	for (const line of lines) {
		lineStarts.push(total);
		total += line.length + 1;
	}
	const offsetAt = (lineNumber: number, column: number): number => lineStarts[lineNumber - 1] + (column - 1);
	const normalized = edits.map(e => ({
		startOffset: offsetAt(e.range.startLineNumber, e.range.startColumn),
		endOffset: offsetAt(e.range.endLineNumber, e.range.endColumn),
		text: e.text,
	})).sort((a, b) => a.startOffset - b.startOffset);

	let result = '';
	let cursor = 0;
	for (const edit of normalized) {
		if (edit.startOffset < cursor || edit.endOffset < edit.startOffset) {
			continue;
		}
		result += text.substring(cursor, edit.startOffset);
		result += edit.text;
		cursor = edit.endOffset;
	}
	result += text.substring(cursor);
	return result;
}

export class CursorController extends Disposable {
	private _desiredColumn: number | null = null;
	private _lastEditReason: 'undo' | 'redo' | 'edit' = 'edit';

	private readonly _onDidChangeCursorPosition = this._register(new Emitter<ICursorPositionChangedEvent>());
	readonly onDidChangeCursorPosition: Event<ICursorPositionChangedEvent> = this._onDidChangeCursorPosition.event;

	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	readonly onDidChangeSelection: Event<void> = this._onDidChangeSelection.event;

	private readonly _onDidEdit = this._register(new Emitter<IEditEvent>());
	readonly onDidEdit: Event<IEditEvent> = this._onDidEdit.event;

	constructor(
		private readonly _model: ITextModel,
		private readonly _multiCursor: MultiCursor,
		private readonly _editStack?: EditStack,
		private readonly _layout?: ViewLayout,
		private readonly _options?: EditorOptions
	) {
		super();
	}

	getModel(): ITextModel {
		return this._model;
	}

	getPrimarySelection(): CursorSelection {
		return this._multiCursor.getPrimarySelection();
	}

	getSelections(): CursorSelection[] {
		return this._multiCursor.getSelections();
	}

	getPosition(): Position {
		return this._multiCursor.getPrimarySelection().active;
	}

	setPosition(position: Position, inSelectionMode = false): void {
		const primary = this._multiCursor.getPrimarySelection();
		const anchor = inSelectionMode ? primary.anchor : position;
		this._multiCursor.setSelections([CursorSelection.fromPositions(anchor, position), ...this._multiCursor.getSelections().slice(1)]);
		this._desiredColumn = null;
		this._firePositionChanged(position, 'set');
		this._onDidChangeSelection.fire();
	}

	setSelections(selections: CursorSelection[]): void {
		this._multiCursor.setSelections(selections);
		this._desiredColumn = null;
		this._firePositionChanged(selections[0].active, 'set');
		this._onDidChangeSelection.fire();
	}

	setSelection(anchor: Position, active: Position): void {
		this.setSelections([CursorSelection.fromPositions(anchor, active), ...this._multiCursor.getSelections().slice(1)]);
	}

	move(command: CursorMoveCommand, inSelectionMode = false): void {
		const model = this._model;
		const primary = this._multiCursor.getPrimarySelection();
		let position = primary.active;
		let desiredColumn = this._desiredColumn;

		switch (command) {
			case CursorMoveCommand.Left:
				position = CursorOperations.moveCharacterLeft(model, position);
				desiredColumn = null;
				break;
			case CursorMoveCommand.Right:
				position = CursorOperations.moveCharacterRight(model, position);
				desiredColumn = null;
				break;
			case CursorMoveCommand.WordLeft:
				position = CursorOperations.moveWordLeft(model, position);
				desiredColumn = null;
				break;
			case CursorMoveCommand.WordRight:
				position = CursorOperations.moveWordRight(model, position);
				desiredColumn = null;
				break;
			case CursorMoveCommand.LineStart:
				position = CursorOperations.moveToLineStart(model, position);
				desiredColumn = null;
				break;
			case CursorMoveCommand.LineEnd:
				position = CursorOperations.moveToLineEnd(model, position);
				desiredColumn = null;
				break;
			case CursorMoveCommand.Up:
				position = CursorOperations.moveVertically(model, position, -1, { desiredColumn: desiredColumn ?? position.column });
				desiredColumn = desiredColumn ?? position.column;
				break;
			case CursorMoveCommand.Down:
				position = CursorOperations.moveVertically(model, position, 1, { desiredColumn: desiredColumn ?? position.column });
				desiredColumn = desiredColumn ?? position.column;
				break;
			case CursorMoveCommand.PageUp:
				position = CursorOperations.movePageUp(model, position, this._getLinesInViewport());
				desiredColumn = null;
				break;
			case CursorMoveCommand.PageDown:
				position = CursorOperations.movePageDown(model, position, this._getLinesInViewport());
				desiredColumn = null;
				break;
			case CursorMoveCommand.Top:
				position = CursorOperations.moveToTop(model, { desiredColumn: position.column });
				desiredColumn = null;
				break;
			case CursorMoveCommand.Bottom:
				position = CursorOperations.moveToBottom(model, { desiredColumn: position.column });
				desiredColumn = null;
				break;
		}

		this._desiredColumn = desiredColumn;
		this._setPrimaryActive(position, inSelectionMode);
		this._firePositionChanged(position, 'move');
	}

	selectWord(): void {
		const primary = this._multiCursor.getPrimarySelection();
		const sel = CursorOperations.selectWord(this._model, primary.active);
		this.setSelections([sel, ...this._multiCursor.getSelections().slice(1)]);
	}

	selectLine(): void {
		const primary = this._multiCursor.getPrimarySelection();
		const sel = CursorOperations.selectLine(this._model, primary.active);
		this.setSelections([sel, ...this._multiCursor.getSelections().slice(1)]);
	}

	selectAll(): void {
		this.setSelections([CursorOperations.selectAll(this._model)]);
	}

	clearSelection(): void {
		const primary = this._multiCursor.getPrimarySelection();
		this.setPosition(primary.active, false);
	}

	/**
	 * Applies a batch of edits to the model, adjusts every cursor and
	 * records an undo/redo transaction on the edit stack.
	 */
	applyEdits(edits: IEditOperationInput[], label = 'edit'): void {
		if (edits.length === 0) {
			return;
		}
		const before = this._model.getValue();
		const beforeSelections = this._multiCursor.getSelections();
		const after = applyEditsToText(before, edits);
		const afterSelections = this._adjustSelections(beforeSelections, edits);

		this._lastEditReason = 'edit';
		this._model.setValue(after);
		this._multiCursor.setSelections(afterSelections);

		if (this._editStack) {
			this._editStack.push([{
				undo: () => {
					this._lastEditReason = 'undo';
					this._model.setValue(before);
					this._multiCursor.setSelections(beforeSelections);
					this._afterModelChange();
				},
				redo: () => {
					this._lastEditReason = 'redo';
					this._model.setValue(after);
					this._multiCursor.setSelections(afterSelections);
					this._afterModelChange();
				},
			}]);
		}
		this._afterModelChange();
		this._onDidEdit.fire({ edits, label });
	}

	typeText(text: string): void {
		const selections = this._multiCursor.getSelections();
		const edits: IEditOperationInput[] = selections.map(sel => ({
			range: rangeFromPositions(sel.start, sel.end),
			text,
		}));
		this.applyEdits(edits, 'type');
		this._desiredColumn = null;
	}

	typeTab(): void {
		const options = this._options;
		const tabSize = options ? options.getOption('tabSize') : 4;
		const insertSpaces = options ? options.getOption('insertSpaces') : true;
		this.typeText(insertSpaces ? ' '.repeat(tabSize) : '\t');
	}

	insertTextAt(position: Position, text: string): void {
		this.applyEdits([{ range: rangeFromPositions(position, position), text }], 'insert');
	}

	backspace(): void {
		const selections = this._multiCursor.getSelections();
		const edits: IEditOperationInput[] = [];
		for (const sel of selections) {
			if (sel.isSelection) {
				edits.push({ range: rangeFromPositions(sel.start, sel.end), text: '' });
			} else {
				edits.push({ range: this._getBackspaceRange(sel.active), text: '' });
			}
		}
		this.applyEdits(edits, 'delete');
	}

	delete(): void {
		const selections = this._multiCursor.getSelections();
		const edits: IEditOperationInput[] = [];
		for (const sel of selections) {
			if (sel.isSelection) {
				edits.push({ range: rangeFromPositions(sel.start, sel.end), text: '' });
			} else {
				const next = CursorOperations.moveCharacterRight(this._model, sel.active);
				if (!positionsEqual(next, sel.active)) {
					edits.push({ range: rangeFromPositions(sel.active, next), text: '' });
				}
			}
		}
		this.applyEdits(edits, 'delete');
	}

	deleteWord(direction: 'left' | 'right'): void {
		const selections = this._multiCursor.getSelections();
		const edits: IEditOperationInput[] = [];
		for (const sel of selections) {
			if (sel.isSelection) {
				edits.push({ range: rangeFromPositions(sel.start, sel.end), text: '' });
				continue;
			}
			const target = direction === 'left'
				? CursorOperations.moveWordLeft(this._model, sel.active)
				: CursorOperations.moveWordRight(this._model, sel.active);
			if (!positionsEqual(target, sel.active)) {
				const range = direction === 'left'
					? rangeFromPositions(target, sel.active)
					: rangeFromPositions(sel.active, target);
				edits.push({ range, text: '' });
			}
		}
		this.applyEdits(edits, 'deleteWord');
	}

	undo(): void {
		this._editStack?.undo();
	}

	redo(): void {
		this._editStack?.redo();
	}

	canUndo(): boolean {
		return this._editStack?.canUndo() ?? false;
	}

	canRedo(): boolean {
		return this._editStack?.canRedo() ?? false;
	}

	getTextInRange(range: Range): string {
		const lines = this._model.getValue().split('\n');
		if (range.startLineNumber === range.endLineNumber) {
			const line = lines[range.startLineNumber - 1] ?? '';
			return line.substring(range.startColumn - 1, range.endColumn - 1);
		}
		const parts: string[] = [];
		for (let line = range.startLineNumber; line <= range.endLineNumber; line++) {
			const content = lines[line - 1] ?? '';
			if (line === range.startLineNumber) {
				parts.push(content.substring(range.startColumn - 1));
			} else if (line === range.endLineNumber) {
				parts.push(content.substring(0, range.endColumn - 1));
			} else {
				parts.push(content);
			}
		}
		return parts.join('\n');
	}

	private _setPrimaryActive(position: Position, inSelectionMode: boolean): void {
		const primary = this._multiCursor.getPrimarySelection();
		const anchor = inSelectionMode ? primary.anchor : position;
		this._multiCursor.setSelections([CursorSelection.fromPositions(anchor, position), ...this._multiCursor.getSelections().slice(1)]);
		this._onDidChangeSelection.fire();
	}

	private _adjustSelections(selections: CursorSelection[], edits: IEditOperationInput[]): CursorSelection[] {
		let adjusted = selections.map(s => s);
		for (let i = edits.length - 1; i >= 0; i--) {
			const edit = edits[i];
			adjusted = adjusted.map(sel => CursorSelection.fromPositions(
				CursorOperations.adjustPositionForEdit(sel.anchor, edit.range, edit.text),
				CursorOperations.adjustPositionForEdit(sel.active, edit.range, edit.text)
			));
		}
		return adjusted;
	}

	private _getBackspaceRange(position: Position): Range {
		if (position.column > 1) {
			return rangeFromPositions(new Position(position.lineNumber, position.column - 1), position);
		}
		if (position.lineNumber > 1) {
			const prevLineLength = this._model.getLineContent(position.lineNumber - 1).length;
			return rangeFromPositions(new Position(position.lineNumber - 1, prevLineLength + 1), position);
		}
		return rangeFromPositions(position, position);
	}

	private _getLinesInViewport(): number {
		if (!this._layout) {
			return 10;
		}
		return 10;
	}

	private _afterModelChange(): void {
		this._desiredColumn = null;
		this._firePositionChanged(this._multiCursor.getPrimarySelection().active, this._lastEditReason);
		this._onDidChangeSelection.fire();
	}

	private _firePositionChanged(position: Position, reason: ICursorPositionChangedEvent['reason']): void {
		this._onDidChangeCursorPosition.fire({ position, reason });
	}
}
