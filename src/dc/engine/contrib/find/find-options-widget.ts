/**
 * Dardcor Code - Find Options Toggle Buttons Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, addDisposableListener } from "../../../core/dom/element.js";
import { IFindOptions } from "./find-model.js";

export interface IFindOptionsState extends IFindOptions {
	readonly preserveCase: boolean;
}

export interface IFindOptionsWidgetOptions {
	readonly showPreserveCase: boolean;
}

const DEFAULT_STATE: IFindOptionsState = {
	isRegex: false,
	matchCase: false,
	wholeWord: false,
	preserveCase: false
};

export type FindOptionToggle = "isRegex" | "matchCase" | "wholeWord" | "preserveCase";

/**
 * The regex / case sensitivity / whole word toggle button group. Renders
 * small icon buttons and reports state changes through `onDidChange`, while
 * `sync` allows an external owner (find widget) to push state into it.
 */
export class FindOptionsWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _buttons = new Map<FindOptionToggle, HTMLButtonElement>();
	private _state: IFindOptionsState = { ...DEFAULT_STATE };

	private readonly _onDidChange = this._register(new Emitter<IFindOptionsState>());
	readonly onDidChange: Event<IFindOptionsState> = this._onDidChange.event;

	constructor(parent: HTMLElement, options: IFindOptionsWidgetOptions = { showPreserveCase: true }) {
		super();
		this._domNode = $<HTMLElement>("div", "dc-find-options-widget");
		this._domNode.style.cssText = "display:flex;align-items:center;gap:2px;";
		this._buildButton("isRegex", ".*", "Use Regular Expression");
		this._buildButton("matchCase", "Aa", "Match Case");
		this._buildButton("wholeWord", "\\b", "Match Whole Word");
		if (options.showPreserveCase) {
			this._buildButton("preserveCase", "AB", "Preserve Case");
		}
		parent.appendChild(this._domNode);
		this._applyActiveState();
	}

	public sync(state: Partial<IFindOptionsState>): void {
		this._state = { ...this._state, ...state };
		this._applyActiveState();
	}

	public getState(): IFindOptionsState {
		return { ...this._state };
	}

	public toFindOptions(): IFindOptions {
		return {
			isRegex: this._state.isRegex,
			matchCase: this._state.matchCase,
			wholeWord: this._state.wholeWord
		};
	}

	public isActive(toggle: FindOptionToggle): boolean {
		return this._state[toggle];
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	private _buildButton(toggle: FindOptionToggle, label: string, title: string): void {
		const button = $<HTMLButtonElement>("button", "dc-find-options-toggle");
		button.textContent = label;
		button.title = title;
		button.style.cssText = "background:transparent;border:1px solid transparent;color:#9e9e9e;padding:2px 6px;cursor:pointer;border-radius:2px;font-size:12px;";
		this._register(addDisposableListener(button, "click", () => this._toggle(toggle)));
		this._buttons.set(toggle, button);
		this._domNode.appendChild(button);
	}

	private _toggle(toggle: FindOptionToggle): void {
		this._state = { ...this._state, [toggle]: !this._state[toggle] };
		this._applyActiveState();
		this._onDidChange.fire(this.getState());
	}

	private _applyActiveState(): void {
		for (const [toggle, button] of this._buttons) {
			const active = this._state[toggle];
			button.style.borderColor = active ? "#75beff" : "transparent";
			button.style.color = active ? "#75beff" : "#9e9e9e";
			button.setAttribute("aria-pressed", String(active));
		}
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
