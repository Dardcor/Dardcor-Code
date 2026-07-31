/**
 * Dardcor Code - Ghost Text Edit Insertion Model
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { IInlineCompletion } from "./inline-completions-controller.js";

export interface IGhostTextModelState {
	readonly hasGhostText: boolean;
	readonly insertText: string;
	readonly position: IPosition | null;
	readonly range: IRange | null;
	readonly isDirty: boolean;
}

export interface IGhostTextApplyResult {
	readonly insertedText: string;
	readonly insertedAt: IPosition;
}

/**
 * Model for the pending ghost (inline) completion. Keeps the candidate text
 * and insertion position separate from the document; `insert` commits the
 * ghost text into the underlying TextModel and `reject` clears it. The state
 * survives typing as long as the typed text remains a prefix of the ghost
 * text (mirroring the "typed ahead" behavior of ghost text widgets).
 */
export class GhostTextModel extends Disposable {
	private _model: ITextModel | null = null;
	private _insertText: string = "";
	private _position: IPosition | null = null;
	private _range: IRange | null = null;
	private _isDirty: boolean = false;

	private readonly _onDidChange = this._register(new Emitter<IGhostTextModelState>());
	readonly onDidChange: Event<IGhostTextModelState> = this._onDidChange.event;

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.reject();
	}

	public setDirty(dirty: boolean): void {
		this._isDirty = dirty;
		this._emit();
	}

	public update(completion: IInlineCompletion, position: IPosition): boolean {
		if (!completion.insertText) {
			return false;
		}
		this._insertText = completion.insertText;
		this._position = position;
		this._range = completion.range ?? null;
		this._emit();
		return true;
	}

	public clear(): void {
		this._insertText = "";
		this._position = null;
		this._range = null;
		this._emit();
	}

	public accept(): boolean {
		return this.insert() !== null;
	}

	public insert(): IGhostTextApplyResult | null {
		const model = this._model;
		const position = this._position;
		if (!model || !position || this._insertText.length === 0) {
			return null;
		}
		const offsets = this._computeLineOffsets(model);
		const value = model.getValue();
		const insertOffset = offsets[position.lineNumber - 1] + (position.column - 1);
		if (insertOffset < 0 || insertOffset > value.length) {
			return null;
		}
		const result: IGhostTextApplyResult = {
			insertedText: this._insertText,
			insertedAt: position
		};
		model.setValue(value.substring(0, insertOffset) + this._insertText + value.substring(insertOffset));
		this._insertText = "";
		this._position = null;
		this._range = null;
		this._emit();
		return result;
	}

	public reject(): void {
		this._insertText = "";
		this._position = null;
		this._range = null;
		this._emit();
	}

	public updateAfterTyping(model: ITextModel, position: IPosition): void {
		if (this._insertText.length === 0 || !this._position) {
			return;
		}
		const line = model.getLineContent(position.lineNumber);
		const typed = line.substring(this._position.column - 1, position.column - 1);
		if (typed.length === 0) {
			return;
		}
		if (!this._insertText.startsWith(typed)) {
			this.reject();
			return;
		}
		this._insertText = this._insertText.substring(typed.length);
		this._position = position;
		this._emit();
	}

	public getState(): IGhostTextModelState {
		return {
			hasGhostText: this._insertText.length > 0,
			insertText: this._insertText,
			position: this._position,
			range: this._range,
			isDirty: this._isDirty
		};
	}

	public getInsertText(): string {
		return this._insertText;
	}

	public getPosition(): IPosition | null {
		return this._position;
	}

	public hasGhostText(): boolean {
		return this._insertText.length > 0;
	}

	private _emit(): void {
		this._onDidChange.fire(this.getState());
	}

	private _computeLineOffsets(model: ITextModel): number[] {
		const offsets: number[] = [0];
		for (let line = 1; line <= model.getLineCount(); line++) {
			offsets.push(offsets[offsets.length - 1] + model.getLineContent(line).length + 1);
		}
		return offsets;
	}

	public override dispose(): void {
		super.dispose();
	}
}
