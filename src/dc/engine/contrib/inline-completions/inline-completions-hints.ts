/**
 * Dardcor Code - Inline Completion Keyboard Shortcut Hint Toolbar
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { IInlineCompletion, InlineCompletionsController } from "./inline-completions-controller.js";

export interface IInlineCompletionHintsHost {
	getContainer(): HTMLElement;
	getAnchorFor(position: { lineNumber: number; column: number }): { x: number; y: number; height: number } | null;
}

export interface IInlineCompletionHintsActions {
	accept(): void;
	reject(): void;
}

export type InlineCompletionHintAction = "accept" | "reject" | "next" | "previous";

/**
 * Small floating toolbar rendered near the ghost text showing the available
 * shortcut hints (Tab to accept, Esc to reject) with clickable buttons.
 * It follows the completion position and hides automatically when no ghost
 * text is visible.
 */
export class InlineCompletionsHints extends Disposable {
	private readonly _host: IInlineCompletionHintsHost;
	private readonly _controller: InlineCompletionsController;
	private readonly _actions: IInlineCompletionHintsActions;
	private readonly _domNode: HTMLElement;
	private _isVisible: boolean = false;

	private readonly _onDidAction = this._register(new Emitter<InlineCompletionHintAction>());
	readonly onDidAction: Event<InlineCompletionHintAction> = this._onDidAction.event;

	constructor(host: IInlineCompletionHintsHost, controller: InlineCompletionsController, actions: IInlineCompletionHintsActions) {
		super();
		this._host = host;
		this._controller = controller;
		this._actions = actions;
		this._domNode = $<HTMLElement>("div", "dc-inline-completions-hints");
		this._domNode.style.cssText = "position:absolute;z-index:36;display:none;align-items:center;gap:2px;background:#2d2d30;border:1px solid #454545;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,0.4);padding:1px 3px;font-family:Segoe UI, sans-serif;font-size:11px;color:#9e9e9e;user-select:none;";
		host.getContainer().appendChild(this._domNode);
		this._register(this._controller.onDidChange(completion => this._sync(completion)));
		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
	}

	public show(): void {
		const completion = this._controller.getCurrentCompletion();
		this._sync(completion);
	}

	public hide(): void {
		this._isVisible = false;
		this._domNode.style.display = "none";
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	private _sync(completion: IInlineCompletion | null): void {
		if (!completion) {
			this.hide();
			return;
		}
		const position = this._controller.getCurrentCompletion() ? this._anchorPosition() : null;
		if (!position) {
			this.hide();
			return;
		}
		const anchor = this._host.getAnchorFor(position);
		if (!anchor) {
			this.hide();
			return;
		}
		clearNode(this._domNode);
		this._domNode.appendChild(this._buildButton("Tab", "Accept (Tab)", "accept"));
		this._domNode.appendChild(this._buildButton("Esc", "Reject (Esc)", "reject"));
		this._domNode.style.display = "flex";
		this._domNode.style.left = `${Math.round(anchor.x)}px`;
		this._domNode.style.top = `${Math.round(anchor.y + anchor.height + 2)}px`;
		this._isVisible = true;
	}

	private _anchorPosition(): { lineNumber: number; column: number } | null {
		const model = this._modelPosition();
		return model;
	}

	private _modelPosition(): { lineNumber: number; column: number } | null {
		// The controller does not expose its position; derive it from the
		// host by searching for the ghost node sibling in the container.
		const ghostNode = this._controller.getGhostTextNode();
		const rect = ghostNode.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) {
			return null;
		}
		const lines = this._host.getContainer().querySelectorAll("[data-line]");
		for (const lineEl of Array.from(lines)) {
			const lineRect = lineEl.getBoundingClientRect();
			if (lineRect.top <= rect.top && rect.top < lineRect.bottom) {
				const lineNumber = Number(lineEl.getAttribute("data-line"));
				const column = Math.max(1, Math.round((rect.left - lineRect.left) / 8) + 1);
				return { lineNumber, column };
			}
		}
		return null;
	}

	private _buildButton(label: string, title: string, action: InlineCompletionHintAction): HTMLElement {
		const button = $<HTMLElement>("span", "dc-inline-completions-hint");
		button.textContent = label;
		button.title = title;
		button.style.cssText = "cursor:pointer;padding:0 4px;border-radius:2px;";
		this._register(addDisposableListener(button, "mouseenter", () => {
			button.style.background = "#3a3d3e";
		}));
		this._register(addDisposableListener(button, "mouseleave", () => {
			button.style.background = "transparent";
		}));
		this._register(addDisposableListener(button, "click", () => {
			this._onDidAction.fire(action);
			if (action === "accept") {
				this._actions.accept();
			} else if (action === "reject") {
				this._actions.reject();
			}
		}));
		return button;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
