/**
 * Dardcor Code - Absolute Positioned Overlay Container Layer (Task 256)
 * Mirrors: vs/editor/browser/viewParts/overlayWidgets/overlayWidgets.ts
 */

import { $ } from '../../../core/dom/element.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { Disposable } from '../../../core/lifecycle/disposable.js';

export interface IOverlayWidgetPosition {
	readonly top: number;
	readonly left: number;
}

export interface IOverlayWidget {
	getId(): string;
	getDomNode(): HTMLElement;
	getPosition(): IOverlayWidgetPosition;
}

export class OverlayWidgetContainer extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _widgets = new Map<string, IOverlayWidget>();

	private readonly _onDidLayoutWidgets = this._register(new Emitter<void>());
	readonly onDidLayoutWidgets: Event<void> = this._onDidLayoutWidgets.event;

	constructor(container: HTMLElement) {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-overlay-widgets');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;pointer-events:none;z-index:100;';
		container.appendChild(this._domNode);
	}

	public addWidget(widget: IOverlayWidget): void {
		if (this._widgets.has(widget.getId())) {
			this.removeWidget(widget.getId());
		}
		this._widgets.set(widget.getId(), widget);
		this._domNode.appendChild(widget.getDomNode());
		widget.getDomNode().style.position = 'absolute';
		widget.getDomNode().style.pointerEvents = 'auto';
		this._applyPosition(widget);
	}

	public removeWidget(widgetId: string): boolean {
		const widget = this._widgets.get(widgetId);
		if (!widget) {
			return false;
		}
		this._widgets.delete(widgetId);
		widget.getDomNode().remove();
		return true;
	}

	public getWidget(widgetId: string): IOverlayWidget | undefined {
		return this._widgets.get(widgetId);
	}

	public hasWidget(widgetId: string): boolean {
		return this._widgets.has(widgetId);
	}

	public layout(): void {
		for (const widget of this._widgets.values()) {
			this._applyPosition(widget);
		}
		this._onDidLayoutWidgets.fire();
	}

	private _applyPosition(widget: IOverlayWidget): void {
		const position = widget.getPosition();
		const domNode = widget.getDomNode();
		domNode.style.top = `${position.top}px`;
		domNode.style.left = `${position.left}px`;
	}

	public setPosition(widgetId: string, position: IOverlayWidgetPosition): void {
		const widget = this._widgets.get(widgetId);
		if (!widget) {
			return;
		}
		widget.getDomNode().style.top = `${position.top}px`;
		widget.getDomNode().style.left = `${position.left}px`;
	}

	public getWidgetCount(): number {
		return this._widgets.size;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		this._widgets.clear();
		this._domNode.remove();
		super.dispose();
	}
}
