/**
 * Dardcor Code - Text-Anchored Floating Widgets Layer (Task 263)
 * Mirrors: vs/editor/browser/viewParts/contentWidgets/contentWidgets.ts
 */

import { $, clearNode } from '../../../core/dom/element.js';
import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Position } from '../../model/text-model.js';
import { IRenderContext } from '../../options/editor-options.js';

export enum ContentWidgetPositionPreference {
	EXACT = 0,
	ABOVE = 1,
	BELOW = 2,
}

export interface IContentWidgetPosition {
	readonly position: Position | null;
	readonly preference: ContentWidgetPositionPreference[];
}

export interface IContentWidget {
	readonly id: string;
	getDomNode(): HTMLElement;
	getPosition(): IContentWidgetPosition | null;
}


interface IWidgetData {
	readonly widget: IContentWidget;
	readonly domNode: HTMLElement;
}

export class ContentWidgets extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _widgets = new Map<string, IWidgetData>();

	constructor(container: HTMLElement) {
		super();
		this._domNode = $('div', 'dc-content-widgets');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:10;pointer-events:none;';
		container.appendChild(this._domNode);
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public addWidget(widget: IContentWidget): void {
		if (this._widgets.has(widget.id)) {
			return;
		}
		const domNode = widget.getDomNode();
		domNode.style.position = 'absolute';
		domNode.style.pointerEvents = 'auto';
		this._domNode.appendChild(domNode);

		this._widgets.set(widget.id, {
			widget,
			domNode,
		});
	}

	public removeWidget(widget: IContentWidget): void {
		const data = this._widgets.get(widget.id);
		if (!data) {
			return;
		}
		if (data.domNode.parentNode === this._domNode) {
			this._domNode.removeChild(data.domNode);
		}
		this._widgets.delete(widget.id);
	}

	public layout(ctx: IRenderContext): void {
		for (const data of this._widgets.values()) {
			const posData = data.widget.getPosition();
			if (!posData || !posData.position) {
				data.domNode.style.display = 'none';
				continue;
			}

			const pos = posData.position;
			const top = ctx.layout.getVerticalOffsetForLineNumber(pos.lineNumber);
			const left = (pos.column - 1) * ctx.charWidth;

			let y = top;
			const preference = posData.preference[0] ?? ContentWidgetPositionPreference.BELOW;
			if (preference === ContentWidgetPositionPreference.ABOVE) {
				y = top - data.domNode.clientHeight;
			} else if (preference === ContentWidgetPositionPreference.BELOW) {
				y = top + ctx.lineHeight;
			}

			data.domNode.style.display = 'block';
			data.domNode.style.top = `${Math.round(y)}px`;
			data.domNode.style.left = `${Math.round(left)}px`;
		}
	}

	public override dispose(): void {
		clearNode(this._domNode);
		this._widgets.clear();
		super.dispose();
	}
}
