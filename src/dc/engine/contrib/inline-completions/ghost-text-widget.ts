/**
 * Dardcor Code - Inline Gray Ghost Text Renderer Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode } from "../../../core/dom/element.js";
import { IPosition } from "../../model/text-model.js";
import { IInlineCompletion } from "./inline-completions-controller.js";

export interface IGhostTextWidgetHost {
	getContainer(): HTMLElement;
	getCoordinates(lineNumber: number, column: number): { x: number; y: number; height: number } | null;
}

export class GhostTextWidget extends Disposable {
	private readonly _host: IGhostTextWidgetHost;
	private readonly _domNode: HTMLElement;
	private _completion: IInlineCompletion | null = null;
	private _position: IPosition | null = null;
	private _isVisible: boolean = false;

	private readonly _onDidChange = this._register(new Emitter<IInlineCompletion | null>());
	readonly onDidChange: Event<IInlineCompletion | null> = this._onDidChange.event;

	constructor(host: IGhostTextWidgetHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("span", "dc-ghost-text-widget");
		this._domNode.style.cssText = "position:absolute;z-index:35;display:none;pointer-events:none;color:#6a6a6a;opacity:0.9;font-family:Consolas, monospace;font-size:14px;white-space:pre;";
		host.getContainer().appendChild(this._domNode);
	}

	public show(completion: IInlineCompletion, position: IPosition): void {
		this._completion = completion;
		this._position = position;
		const anchor = this._host.getCoordinates(position.lineNumber, position.column);
		if (!anchor) {
			this.hide();
			return;
		}
		clearNode(this._domNode);
		const insertText = completion.insertText;
		const typedLength = this._typedLength(insertText, position);
		if (typedLength > 0) {
			const typed = $<HTMLElement>("span", "dc-ghost-text-typed");
			typed.textContent = insertText.substring(0, typedLength);
			typed.style.cssText = "color:#9e9e9e;opacity:0.7;";
			this._domNode.appendChild(typed);
		}
		const ghost = $<HTMLElement>("span", "dc-ghost-text-rest");
		ghost.textContent = insertText.substring(typedLength);
		this._domNode.appendChild(ghost);

		this._domNode.style.display = "inline";
		this._domNode.style.left = `${Math.round(anchor.x)}px`;
		this._domNode.style.top = `${Math.round(anchor.y)}px`;
		this._isVisible = true;
		this._onDidChange.fire(completion);
	}

	public hide(): void {
		if (!this._isVisible && !this._completion) {
			return;
		}
		this._isVisible = false;
		this._completion = null;
		this._position = null;
		this._domNode.style.display = "none";
		this._onDidChange.fire(null);
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getCompletion(): IInlineCompletion | null {
		return this._completion;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	private _typedLength(insertText: string, position: IPosition): number {
		const line = this._hostLine(position.lineNumber);
		if (line === null) {
			return 0;
		}
		let length = 0;
		let i = line.length - 1;
		let j = insertText.length - 1;
		while (i >= 0 && j >= 0 && line[i] === insertText[j]) {
			length++;
			i--;
			j--;
		}
		return length;
	}

	private _hostLine(lineNumber: number): string | null {
		const container = this._host.getContainer();
		const lineEl = container.querySelector(`[data-line="${lineNumber}"]`) as HTMLElement | null;
		return lineEl?.textContent ?? null;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
