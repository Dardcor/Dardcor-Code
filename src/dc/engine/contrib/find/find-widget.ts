/**
 * Dardcor Code - Floating Find & Replace Panel Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, addDisposableListener } from "../../../core/dom/element.js";
import { FindModel } from "./find-model.js";

export interface IFindWidgetAnchor {
	readonly right: number;
	readonly top: number;
}

export class FindWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _findInput: HTMLInputElement;
	private readonly _replaceInput: HTMLInputElement;
	private readonly _countNode: HTMLElement;
	private readonly _toggleRegex: HTMLButtonElement;
	private readonly _toggleCase: HTMLButtonElement;
	private readonly _toggleWord: HTMLButtonElement;
	private readonly _replaceRow: HTMLElement;
	private readonly _model: FindModel;
	private _isVisible: boolean = false;
	private _isReplaceVisible: boolean = false;

	private readonly _onDidNext = this._register(new Emitter<void>());
	readonly onDidNext: Event<void> = this._onDidNext.event;

	private readonly _onDidPrevious = this._register(new Emitter<void>());
	readonly onDidPrevious: Event<void> = this._onDidPrevious.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	private readonly _onDidReplace = this._register(new Emitter<void>());
	readonly onDidReplace: Event<void> = this._onDidReplace.event;

	constructor(parent: HTMLElement, model: FindModel) {
		super();
		this._model = model;

		this._domNode = $<HTMLElement>("div", "dc-find-widget");
		this._findInput = $<HTMLInputElement>("input", "dc-find-input");
		this._replaceInput = $<HTMLInputElement>("input", "dc-find-replace-input");
		this._countNode = $<HTMLElement>("span", "dc-find-count");
		this._toggleRegex = $<HTMLButtonElement>("button", "dc-find-toggle");
		this._toggleCase = $<HTMLButtonElement>("button", "dc-find-toggle");
		this._toggleWord = $<HTMLButtonElement>("button", "dc-find-toggle");
		this._replaceRow = $<HTMLElement>("div", "dc-find-replace-row");

		this._toggleRegex.textContent = ".*";
		this._toggleRegex.title = "Use Regular Expression";
		this._toggleCase.textContent = "Aa";
		this._toggleCase.title = "Match Case";
		this._toggleWord.textContent = "\\b";
		this._toggleWord.title = "Match Whole Word";

		this._domNode.style.cssText = "position:absolute;z-index:55;display:none;right:8px;top:8px;width:280px;background:#2d2d30;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:6px;font-family:Segoe UI, sans-serif;font-size:13px;color:#d4d4d4;";

		const findRow = $<HTMLElement>("div", "dc-find-row");
		findRow.style.cssText = "display:flex;align-items:center;gap:4px;";
		this._findInput.placeholder = "Find";
		this._findInput.style.cssText = "flex:1;background:#3c3c3c;border:1px solid #454545;color:#d4d4d4;padding:3px 6px;border-radius:2px;outline:none;";
		this._countNode.style.cssText = "min-width:32px;text-align:center;color:#969696;font-size:11px;";
		findRow.appendChild(this._findInput);
		findRow.appendChild(this._countNode);

		const toggles = $<HTMLElement>("div", "dc-find-toggles");
		toggles.style.cssText = "display:flex;align-items:center;gap:2px;";
		const btnStyle = "background:transparent;border:1px solid transparent;color:#9e9e9e;padding:2px 6px;cursor:pointer;border-radius:2px;font-size:12px;";
		this._toggleRegex.style.cssText = btnStyle;
		this._toggleCase.style.cssText = btnStyle;
		this._toggleWord.style.cssText = btnStyle;
		toggles.appendChild(this._toggleRegex);
		toggles.appendChild(this._toggleCase);
		toggles.appendChild(this._toggleWord);

		const actions = $<HTMLElement>("div", "dc-find-actions");
		actions.style.cssText = "display:flex;align-items:center;gap:2px;";
		actions.appendChild(this._makeButton("↑", "Find Previous (Shift+Enter)", () => this._onDidPrevious.fire()));
		actions.appendChild(this._makeButton("↓", "Find Next (Enter)", () => this._onDidNext.fire()));
		const toggleReplace = this._makeButton("⇽", "Toggle Replace", () => this.toggleReplace());
		const closeBtn = this._makeButton("✕", "Close (Esc)", () => this.hide());
		actions.appendChild(toggleReplace);
		actions.appendChild(closeBtn);

		const header = $<HTMLElement>("div", "dc-find-header");
		header.style.cssText = "display:flex;align-items:center;gap:6px;";
		header.appendChild(findRow);
		header.appendChild(toggles);
		header.appendChild(actions);
		this._domNode.appendChild(header);

		this._replaceRow.style.cssText = "display:none;margin-top:6px;align-items:center;gap:4px;";
		this._replaceInput.placeholder = "Replace";
		this._replaceInput.style.cssText = "flex:1;background:#3c3c3c;border:1px solid #454545;color:#d4d4d4;padding:3px 6px;border-radius:2px;outline:none;";
		const replaceActions = $<HTMLElement>("div", "dc-find-replace-actions");
		replaceActions.style.cssText = "display:flex;gap:2px;";
		replaceActions.appendChild(this._makeButton("R", "Replace", () => this._doReplace()));
		replaceActions.appendChild(this._makeButton("R.A", "Replace All", () => this._doReplaceAll()));
		this._replaceRow.appendChild(this._replaceInput);
		this._replaceRow.appendChild(replaceActions);
		this._domNode.appendChild(this._replaceRow);

		parent.appendChild(this._domNode);

		this._register(addDisposableListener(this._findInput, "input", () => {
			this._model.setQuery(this._findInput.value);
			this._updateCount();
		}));
		this._register(addDisposableListener(this._findInput, "keydown", e => this._onFindKeyDown(e as KeyboardEvent)));
		this._register(addDisposableListener(this._replaceInput, "keydown", e => {
			const ke = e as KeyboardEvent;
			if (ke.key === "Enter") {
				ke.preventDefault();
				this._doReplace();
			}
		}));
		this._register(addDisposableListener(this._toggleRegex, "click", () => this._toggleOption("isRegex", this._toggleRegex)));
		this._register(addDisposableListener(this._toggleCase, "click", () => this._toggleOption("matchCase", this._toggleCase)));
		this._register(addDisposableListener(this._toggleWord, "click", () => this._toggleOption("wholeWord", this._toggleWord)));
		this._register(this._model.onDidChange(() => this._updateCount()));
	}

	public show(anchor: IFindWidgetAnchor = { right: 8, top: 8 }): void {
		this._isVisible = true;
		this._domNode.style.display = "block";
		this._domNode.style.right = `${anchor.right}px`;
		this._domNode.style.top = `${anchor.top}px`;
		this._findInput.focus();
		this._findInput.select();
		this._updateCount();
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._domNode.style.display = "none";
		this._onDidClose.fire();
	}

	public toggleReplace(): void {
		this._isReplaceVisible = !this._isReplaceVisible;
		this._replaceRow.style.display = this._isReplaceVisible ? "flex" : "none";
		if (this._isReplaceVisible) {
			this._replaceInput.focus();
		}
	}

	public showReplace(): void {
		if (!this._isReplaceVisible) {
			this.toggleReplace();
		}
	}

	public setFindValue(value: string): void {
		this._findInput.value = value;
		this._model.setQuery(value);
		this._updateCount();
	}

	public focus(): void {
		this._findInput.focus();
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	private _onFindKeyDown(e: KeyboardEvent): void {
		switch (e.key) {
			case "Enter":
				e.preventDefault();
				if (e.shiftKey) {
					this._onDidPrevious.fire();
				} else {
					this._onDidNext.fire();
				}
				break;
			case "Escape":
				e.preventDefault();
				this.hide();
				break;
		}
	}

	private _toggleOption(key: "isRegex" | "matchCase" | "wholeWord", button: HTMLButtonElement): void {
		const options = this._model.getOptions();
		const next = !options[key];
		this._model.setOptions({ [key]: next } as Partial<typeof options>);
		button.style.borderColor = next ? "#75beff" : "transparent";
		button.style.color = next ? "#75beff" : "#9e9e9e";
		this._updateCount();
	}

	private _updateCount(): void {
		const count = this._model.getMatchCount();
		const index = this._model.getCurrentMatchIndex();
		if (this._model.isInvalidRegex()) {
			this._countNode.textContent = "!";
			this._countNode.title = "Invalid regular expression";
		} else if (count === 0) {
			this._countNode.textContent = "0";
		} else {
			this._countNode.textContent = `${index + 1}/${count}`;
		}
	}

	private _doReplace(): void {
		const replaced = this._model.replaceCurrent(this._replaceInput.value);
		if (replaced) {
			this._onDidReplace.fire();
			this._updateCount();
		}
	}

	private _doReplaceAll(): void {
		const count = this._model.replaceAll(this._replaceInput.value);
		if (count > 0) {
			this._onDidReplace.fire();
			this._updateCount();
		}
	}

	private _makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
		const button = $<HTMLButtonElement>("button", "dc-find-button");
		button.textContent = label;
		button.title = title;
		button.style.cssText = "background:transparent;border:1px solid transparent;color:#9e9e9e;padding:2px 6px;cursor:pointer;border-radius:2px;font-size:12px;";
		this._register(addDisposableListener(button, "click", () => onClick()));
		return button;
	}

	public layout(): void {
		// Keep the panel inside the container on resize.
		if (this._isVisible && this._domNode.parentElement) {
			const rect = this._domNode.parentElement.getBoundingClientRect();
			this._domNode.style.right = `${Math.min(8, Math.max(0, rect.width - this._domNode.offsetWidth - 8))}px`;
		}
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
