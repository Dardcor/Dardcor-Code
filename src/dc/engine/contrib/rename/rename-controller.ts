/**
 * Dardcor Code - Inline Symbol Rename Controller
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

export interface IRenameResult {
	readonly oldName: string;
	readonly newName: string;
	readonly range: IRange;
	readonly occurrenceCount: number;
}

export interface IRenameHost {
	getContainer(): HTMLElement;
	getCoordinates(lineNumber: number, column: number): { x: number; y: number; height: number } | null;
}

export class RenameController extends Disposable {
	private readonly _host: IRenameHost;
	private readonly _input: HTMLInputElement;
	private _model: ITextModel | null = null;
	private _wordRange: IRange | null = null;
	private _isActive: boolean = false;

	private readonly _onDidComplete = this._register(new Emitter<IRenameResult>());
	readonly onDidComplete: Event<IRenameResult> = this._onDidComplete.event;

	private readonly _onDidCancel = this._register(new Emitter<void>());
	readonly onDidCancel: Event<void> = this._onDidCancel.event;

	constructor(host: IRenameHost) {
		super();
		this._host = host;
		this._input = $<HTMLInputElement>("input", "dc-rename-input");
		this._input.style.cssText = "position:absolute;z-index:58;display:none;background:#3c3c3c;border:1px solid #75beff;color:#d4d4d4;padding:1px 2px;font-family:Consolas, monospace;font-size:14px;outline:none;min-width:80px;box-shadow:0 2px 8px rgba(0,0,0,0.4);";
		host.getContainer().appendChild(this._input);

		this._register(addDisposableListener(this._input, "keydown", e => {
			if (!this._isActive) {
				return;
			}
			const ke = e as KeyboardEvent;
			switch (ke.key) {
				case "Enter":
					ke.preventDefault();
					this.accept();
					break;
				case "Escape":
					ke.preventDefault();
					this.cancel();
					break;
				case "Tab":
					ke.preventDefault();
					this.accept();
					break;
			}
		}));
		this._register(addDisposableListener(this._input, "blur", () => {
			if (this._isActive) {
				this.accept();
			}
		}));
	}

	public startRename(model: ITextModel, position: IPosition): IRange | null {
		this._model = model;
		const range = this._findWordRange(model, position);
		if (!range) {
			return null;
		}
		this._wordRange = range;
		const line = model.getLineContent(range.startLineNumber);
		const name = line.substring(range.startColumn - 1, range.endColumn - 1);
		const anchor = this._host.getCoordinates(range.startLineNumber, range.startColumn);
		if (!anchor) {
			return null;
		}
		this._input.value = name;
		this._input.style.display = "block";
		this._input.style.left = `${Math.round(anchor.x)}px`;
		this._input.style.top = `${Math.round(anchor.y)}px`;
		this._input.style.width = `${Math.max(80, name.length * 9 + 16)}px`;
		this._isActive = true;
		this._input.focus();
		this._input.select();
		return range;
	}

	public accept(): void {
		const model = this._model;
		const range = this._wordRange;
		if (!model || !range || !this._isActive) {
			this._reset();
			return;
		}
		const newName = this._input.value;
		const line = model.getLineContent(range.startLineNumber);
		const oldName = line.substring(range.startColumn - 1, range.endColumn - 1);
		if (newName.length > 0 && newName !== oldName) {
			const count = this._renameOccurrences(model, oldName, newName, range);
			this._onDidComplete.fire({ oldName, newName, range, occurrenceCount: count });
		}
		this._reset();
	}

	public cancel(): void {
		if (this._isActive) {
			this._onDidCancel.fire();
		}
		this._reset();
	}

	public get isActive(): boolean {
		return this._isActive;
	}

	private _renameOccurrences(model: ITextModel, oldName: string, newName: string, wordRange: IRange): number {
		const text = model.getValue();
		const lines = text.split(/\r?\n/);
		let count = 0;
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			let result = "";
			let pos = 0;
			while (pos < line.length) {
				const start = line.indexOf(oldName, pos);
				if (start === -1) {
					result += line.substring(pos);
					break;
				}
				result += line.substring(pos, start);
				const beforeOk = start === 0 || !isWord(line[start - 1]);
				const afterOk = start + oldName.length >= line.length || !isWord(line[start + oldName.length]);
				if (beforeOk && afterOk) {
					result += newName;
					count++;
				} else {
					result += oldName;
				}
				pos = start + oldName.length;
			}
			lines[i] = result;
		}
		model.setValue(lines.join("\n"));
		void wordRange;
		return count;
	}

	private _findWordRange(model: ITextModel, position: IPosition): IRange | null {
		const line = model.getLineContent(position.lineNumber);
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		if (!isWord(line[position.column - 1] ?? "")) {
			return null;
		}
		let start = position.column - 1;
		while (start > 0 && isWord(line[start - 1])) {
			start--;
		}
		let end = position.column;
		while (end < line.length && isWord(line[end])) {
			end++;
		}
		return { startLineNumber: position.lineNumber, startColumn: start + 1, endLineNumber: position.lineNumber, endColumn: end + 1 };
	}

	private _reset(): void {
		this._isActive = false;
		this._input.style.display = "none";
		this._model = null;
		this._wordRange = null;
	}

	public override dispose(): void {
		this._input.remove();
		super.dispose();
	}
}
