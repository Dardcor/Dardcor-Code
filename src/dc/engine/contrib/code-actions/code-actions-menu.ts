/**
 * Dardcor Code - Quick Fix & Refactor Context Menu
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { CodeActionKind } from "./code-action-kind.js";

export interface ICodeAction {
	readonly title: string;
	readonly kind?: CodeActionKind;
	readonly commandId?: string;
	readonly commandArguments?: unknown[];
	readonly isPreferred?: boolean;
	readonly isDisabled?: boolean;
	readonly disabledReason?: string;
	readonly data?: unknown;
}

export interface ICodeActionMenuAnchor {
	readonly x: number;
	readonly y: number;
}

export class CodeActionsMenu extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _listNode: HTMLElement;
	private _actions: ICodeAction[] = [];
	private _isVisible: boolean = false;

	private readonly _onDidSelect = this._register(new Emitter<ICodeAction>());
	readonly onDidSelect: Event<ICodeAction> = this._onDidSelect.event;

	private readonly _onDidHide = this._register(new Emitter<void>());
	readonly onDidHide: Event<void> = this._onDidHide.event;

	constructor(parent: HTMLElement) {
		super();
		this._domNode = $<HTMLElement>("div", "dc-code-actions-menu");
		this._listNode = $<HTMLElement>("div", "dc-code-actions-menu-list");

		this._domNode.appendChild(this._listNode);
		this._domNode.style.cssText = "position:absolute;z-index:70;display:none;min-width:200px;max-width:360px;max-height:320px;overflow-y:auto;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:4px 0;font-family:Segoe UI, sans-serif;font-size:13px;color:#d4d4d4;";
		parent.appendChild(this._domNode);

		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
		this._register(addDisposableListener(this._domNode, "click", e => {
			const target = (e.target as HTMLElement).closest(".dc-code-action-item") as HTMLElement | null;
			if (!target || target.classList.contains("disabled")) {
				return;
			}
			const action = this._actions[Number(target.getAttribute("data-index"))];
			if (action) {
				this.hide();
				this._onDidSelect.fire(action);
			}
		}));
	}

	public show(anchor: ICodeActionMenuAnchor, actions: ICodeAction[]): void {
		this._actions = actions;
		this._render();
		this._position(anchor);
		this._domNode.style.display = "block";
		this._isVisible = true;
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._domNode.style.display = "none";
		this._onDidHide.fire();
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public get actions(): readonly ICodeAction[] {
		return this._actions;
	}

	private _render(): void {
		clearNode(this._listNode);
		if (this._actions.length === 0) {
			const empty = $<HTMLElement>("div", "dc-code-action-empty");
			empty.textContent = "No code actions available";
			empty.style.cssText = "padding:6px 14px;color:#969696;";
			this._listNode.appendChild(empty);
			return;
		}
		const groups = new Map<string, { kind: CodeActionKind; actions: ICodeAction[] }>();
		for (const action of this._actions) {
			const kind = action.kind ?? CodeActionKind.Empty;
			const rootKind = kind.removeSubKind();
			const key = rootKind.value || "(quick)";
			if (!groups.has(key)) {
				groups.set(key, { kind: rootKind, actions: [] });
			}
			groups.get(key)!.actions.push(action);
		}
		let index = 0;
		for (const group of groups.values()) {
			if (group.kind.value) {
				const header = $<HTMLElement>("div", "dc-code-action-group");
				header.textContent = group.kind.value.split(".").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
				header.style.cssText = "padding:4px 14px 2px;font-size:11px;color:#969696;text-transform:uppercase;letter-spacing:0.5px;";
				this._listNode.appendChild(header);
			}
			for (const action of group.actions) {
				this._listNode.appendChild(this._renderItem(action, index++));
			}
		}
	}

	private _renderItem(action: ICodeAction, index: number): HTMLElement {
		const row = $<HTMLElement>("div", "dc-code-action-item");
		row.setAttribute("data-index", String(index));
		if (action.isDisabled) {
			row.classList.add("disabled");
			row.style.cssText = "padding:5px 14px;color:#6f6f6f;cursor:default;opacity:0.7;";
			row.title = action.disabledReason ?? "";
		} else {
			row.style.cssText = "padding:5px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;";
		}
		if (action.isPreferred) {
			const star = $<HTMLElement>("span", "dc-code-action-preferred");
			star.textContent = "★";
			star.style.cssText = "color:#ffd700;font-size:11px;";
			row.appendChild(star);
		}
		const label = $<HTMLElement>("span", "dc-code-action-title");
		label.textContent = action.title;
		row.appendChild(label);
		return row;
	}

	private _position(anchor: ICodeActionMenuAnchor): void {
		const parent = this._domNode.parentElement;
		if (!parent) {
			return;
		}
		const rect = parent.getBoundingClientRect();
		let left = anchor.x;
		let top = anchor.y;
		if (top + this._domNode.offsetHeight > rect.height) {
			top = Math.max(0, rect.height - this._domNode.offsetHeight);
		}
		if (left + this._domNode.offsetWidth > rect.width) {
			left = Math.max(0, rect.width - this._domNode.offsetWidth);
		}
		this._domNode.style.left = `${Math.round(left)}px`;
		this._domNode.style.top = `${Math.round(top)}px`;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
