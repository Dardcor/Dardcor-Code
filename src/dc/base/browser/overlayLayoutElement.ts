/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getComputedStyle, setParentFlowTo } from './dom.js';
import { IDisposable } from '../common/lifecycle.js';
import { generateUuid } from '../common/uuid.js';

function getOrCreateAnchorName(element: HTMLElement): string {
	const existing = element.style.getPropertyValue('anchor-name');
	if (existing) {
		return existing;
	}
	const name = `--overlay-anchor-${generateUuid()}`;
	element.style.setProperty('anchor-name', name);
	return name;
}

export class OverlayLayoutElement implements IDisposable {

	private _currentAnchor?: { readonly element: HTMLElement; readonly name: string };
	private _clippingAnchor?: { readonly element: HTMLElement; readonly name: string };

	private readonly _root: HTMLElement;

	constructor() {
		this.content = document.createElement('div');
		this.content.style.position = 'absolute';
		this.content.style.overflow = 'hidden';

		this._root = document.createElement('div');
		this._root.appendChild(this.content);

		this.reapplyLayoutStyles();
	}

	public reapplyLayoutStyles(): void {
		this.content.style.position = 'fixed';
		this.content.style.top = 'anchor(top)';
		this.content.style.left = 'anchor(left)';
		this.content.style.width = 'anchor-size(width)';
		this.content.style.height = 'anchor-size(height)';
		this.content.style.pointerEvents = 'auto';

		this._root.style.position = 'absolute';
		this._root.style.pointerEvents = 'none';
	}

	public dispose(): void {
		this.root.remove();
	}

	public get root(): HTMLElement {
		return this._root;
	}

	public readonly content: HTMLElement;

	public setAnchorElement(
		anchorElement: HTMLElement,
		options?: {
			readonly clippingContainer?: HTMLElement;
		},
	): void {
		if (this._currentAnchor?.element !== anchorElement) {
			const name = getOrCreateAnchorName(anchorElement);
			this.content.style.setProperty('position-anchor', name);
			setParentFlowTo(this.content, anchorElement);
			this._currentAnchor = { element: anchorElement, name };
		}

		this._updateClipping(options?.clippingContainer);
		this._updateZIndex(anchorElement);
	}

	private _updateZIndex(anchorElement: HTMLElement): void {
		let zIndex = '';
		for (let el: HTMLElement | null = anchorElement; el; el = el.parentElement) {
			const computed = getComputedStyle(el).zIndex;
			if (computed && computed !== 'auto') {
				zIndex = String(Number(computed) + 1);
				break;
			}
		}
		this.content.style.zIndex = zIndex;
	}

	private _updateClipping(clippingContainer: HTMLElement | undefined): void {
		if (this._clippingAnchor?.element === clippingContainer) {
			return;
		}

		this._root.style.removeProperty('position-anchor');

		const ws = this._root.style;
		if (clippingContainer) {
			const name = getOrCreateAnchorName(clippingContainer);
			ws.clipPath = 'content-box';
			ws.setProperty('position-anchor', name);
			ws.setProperty('top', 'anchor(top)');
			ws.setProperty('left', 'anchor(left)');
			ws.setProperty('width', `anchor-size(width)`);
			ws.setProperty('height', `anchor-size(height)`);
			this._clippingAnchor = { element: clippingContainer, name };
		} else {
			ws.clipPath = '';
			ws.setProperty('top', '0');
			ws.setProperty('left', '0');
			ws.setProperty('right', '0');
			ws.setProperty('bottom', '0');
			this._clippingAnchor = undefined;
		}
	}
}
