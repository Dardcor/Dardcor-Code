/**
 * Dardcor Code - Ghost Inline Inlay Hint Element Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode } from "../../../core/dom/element.js";
import { ITextModel } from "../../model/text-model.js";
import { IInlayHint, InlayHintKind, IInlayHintsHost } from "./inlay-hints-controller.js";

export interface IInlayHintsWidgetState {
	readonly hints: readonly IInlayHint[];
	readonly isVisible: boolean;
}

export class InlayHintsWidget extends Disposable {
	private readonly _host: IInlayHintsHost;
	private readonly _domNode: HTMLElement;
	private _hints: IInlayHint[] = [];
	private _model: ITextModel | null = null;

	private readonly _onDidChange = this._register(new Emitter<IInlayHintsWidgetState>());
	readonly onDidChange: Event<IInlayHintsWidgetState> = this._onDidChange.event;

	constructor(host: IInlayHintsHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-inlay-hints-widget");
		this._domNode.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;";
		host.getContainer().appendChild(this._domNode);
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.render();
	}

	public setHints(hints: IInlayHint[]): void {
		this._hints = [...hints].sort((a, b) => {
			if (a.position.lineNumber !== b.position.lineNumber) {
				return a.position.lineNumber - b.position.lineNumber;
			}
			return a.position.column - b.position.column;
		});
		this.render();
	}

	public clear(): void {
		this._hints = [];
		this.render();
	}

	public render(): void {
		clearNode(this._domNode);
		for (const hint of this._hints) {
			const anchor = this._host.getCoordinates(hint.position.lineNumber, hint.position.column);
			if (!anchor) {
				continue;
			}
			const el = $<HTMLElement>("span", "dc-inlay-hint-element");
			el.textContent = hint.text;
			el.style.cssText = `position:absolute;left:${anchor.x}px;top:${anchor.y}px;font-size:12px;opacity:0.85;white-space:pre;${hint.kind === InlayHintKind.Parameter ? "color:#9cdcfe;" : "color:#6a9955;"}`;
			if (hint.paddingLeft) {
				el.style.paddingLeft = "4px";
			}
			if (hint.paddingRight) {
				el.style.paddingRight = "4px";
			}
			el.setAttribute("data-line", String(hint.position.lineNumber));
			this._domNode.appendChild(el);
		}
		this._emitState();
	}

	public layout(): void {
		this.render();
	}

	public getHints(): readonly IInlayHint[] {
		return this._hints;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getState(): IInlayHintsWidgetState {
		return {
			hints: this._hints,
			isVisible: this._hints.length > 0
		};
	}

	private _emitState(): void {
		this._onDidChange.fire(this.getState());
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
