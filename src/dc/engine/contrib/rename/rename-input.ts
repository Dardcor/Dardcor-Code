/**
 * Dardcor Code - Rename Input Overlay Element
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, addDisposableListener } from "../../../core/dom/element.js";
import { IRange } from "../../model/text-model.js";

export interface IRenameInputHost {
	getContainer(): HTMLElement;
	getCoordinates(lineNumber: number, column: number): { x: number; y: number; height: number } | null;
}

export class RenameInput extends Disposable {
	private readonly _host: IRenameInputHost;
	private readonly _input: HTMLInputElement;
	private _range: IRange | null = null;
	private _isVisible: boolean = false;

	private readonly _onDidAccept = this._register(new Emitter<string>());
	readonly onDidAccept: Event<string> = this._onDidAccept.event;

	private readonly _onDidCancel = this._register(new Emitter<void>());
	readonly onDidCancel: Event<void> = this._onDidCancel.event;

	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor(host: IRenameInputHost) {
		super();
		this._host = host;
		this._input = $<HTMLInputElement>("input", "dc-rename-input-element");
		this._input.style.cssText = "position:absolute;z-index:58;display:none;background:#3c3c3c;border:1px solid #75beff;color:#d4d4d4;padding:1px 2px;font-family:Consolas, monospace;font-size:14px;outline:none;min-width:80px;box-shadow:0 2px 8px rgba(0,0,0,0.4);";
		host.getContainer().appendChild(this._input);

		this._register(addDisposableListener(this._input, "keydown", e => {
			if (!this._isVisible) {
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
		this._register(addDisposableListener(this._input, "input", () => {
			this._onDidChange.fire(this._input.value);
		}));
		this._register(addDisposableListener(this._input, "blur", () => {
			if (this._isVisible) {
				this.accept();
			}
		}));
	}

	public show(range: IRange, initialValue: string): boolean {
		const anchor = this._host.getCoordinates(range.startLineNumber, range.startColumn);
		if (!anchor) {
			return false;
		}
		this._range = range;
		this._input.value = initialValue;
		this._input.style.display = "block";
		this._input.style.left = `${Math.round(anchor.x)}px`;
		this._input.style.top = `${Math.round(anchor.y)}px`;
		this._input.style.width = `${Math.max(80, initialValue.length * 9 + 16)}px`;
		this._isVisible = true;
		this._input.focus();
		this._input.select();
		return true;
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._input.style.display = "none";
		this._range = null;
	}

	public accept(): void {
		if (!this._isVisible) {
			return;
		}
		const value = this._input.value;
		this.hide();
		this._onDidAccept.fire(value);
	}

	public cancel(): void {
		if (!this._isVisible) {
			return;
		}
		this.hide();
		this._onDidCancel.fire();
	}

	public setValue(value: string): void {
		this._input.value = value;
	}

	public getValue(): string {
		return this._input.value;
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getRange(): IRange | null {
		return this._range;
	}

	public getDomNode(): HTMLInputElement {
		return this._input;
	}

	public override dispose(): void {
		this._input.remove();
		super.dispose();
	}
}
