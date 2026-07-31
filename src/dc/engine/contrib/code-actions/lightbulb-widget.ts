/**
 * Dardcor Code - Gutter Lightbulb Icon Indicator Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, addDisposableListener } from "../../../core/dom/element.js";

const LIGHTBULB_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1C5.2 1 3 3.2 3 6c0 1.8.9 3.2 2.2 4.1.7.5 1.1 1.3 1.1 2.2v.2h3.4v-.2c0-.9.4-1.7 1.1-2.2C12.1 9.2 13 7.8 13 6c0-2.8-2.2-5-5-5zM7.2 13.5c.2.3.5.5.8.5s.6-.2.8-.5H7.2zM8 2.5c1.9 0 3.5 1.6 3.5 3.5 0 .7-.3 1.4-.8 1.9l-.5.4c-.5.4-.9.9-1.2 1.5H7c-.3-.6-.7-1.1-1.2-1.5l-.5-.4c-.5-.5-.8-1.2-.8-1.9 0-1.9 1.6-3.5 3.5-3.5z"/></svg>`;

export interface ILightbulbAnchor {
	readonly x: number;
	readonly y: number;
	readonly height: number;
}

export class LightbulbWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private _lineNumber: number = 0;
	private _isVisible: boolean = false;

	private readonly _onDidClick = this._register(new Emitter<{ lineNumber: number }>());
	readonly onDidClick: Event<{ lineNumber: number }> = this._onDidClick.event;

	constructor(parent: HTMLElement) {
		super();
		this._domNode = $<HTMLElement>("div", "dc-lightbulb-widget");
		this._domNode.innerHTML = LIGHTBULB_SVG;
		this._domNode.style.cssText = "position:absolute;z-index:40;display:none;width:20px;height:20px;cursor:pointer;color:#ffcc00;opacity:0;transition:opacity 0.1s ease-in;";
		this._domNode.title = "Show Code Actions";
		parent.appendChild(this._domNode);

		this._register(addDisposableListener(this._domNode, "click", () => {
			if (this._isVisible) {
				this._onDidClick.fire({ lineNumber: this._lineNumber });
			}
		}));
	}

	public show(anchor: ILightbulbAnchor, lineNumber: number): void {
		this._lineNumber = lineNumber;
		this._domNode.style.display = "block";
		this._domNode.style.left = `${Math.round(anchor.x)}px`;
		this._domNode.style.top = `${Math.round(anchor.y)}px`;
		this._domNode.style.opacity = "1";
		this._isVisible = true;
	}

	public hide(): void {
		this._isVisible = false;
		this._domNode.style.opacity = "0";
		this._domNode.style.display = "none";
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
