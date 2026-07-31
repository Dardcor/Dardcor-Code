/**
 * Dardcor Code - Animated Cursor Caret Layer (Task 214)
 * Mirrors: vs/editor/browser/viewParts/cursors/cursors.ts
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { $, clearNode } from '../../../core/dom/element.js';
import { IRenderContext } from '../../options/editor-options.js';
import { Position } from '../../model/text-model.js';

const BLINK_INTERVAL_MS = 500;

export class CursorRenderer extends Disposable {
	private readonly _domNode: HTMLElement;
	private _positions: Position[] = [];
	private _focused = false;
	private _blinkOn = true;
	private _blinkTimer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-cursors');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	setCursors(positions: Position[]): void {
		this._positions = positions;
	}

	setFocused(focused: boolean): void {
		this._focused = focused;
		this._updateBlinkTimer();
	}

	render(ctx: IRenderContext): void {
		clearNode(this._domNode);
		const { layout, viewport, options } = ctx;
		const lineHeight = options.lineHeight > 0 ? options.lineHeight : Math.round(options.fontSize * 1.5);
		const charWidth = ctx.charWidth;

		for (const position of this._positions) {
			if (position.lineNumber < viewport.startLineNumber || position.lineNumber > viewport.endLineNumber) {
				continue;
			}
			const el = $<HTMLElement>('div', 'dc-cursor');
			const left = (position.column - 1) * charWidth - (options.cursorStyle === 'block' ? 0 : options.cursorWidth / 2);
			el.style.cssText = `position:absolute;top:${layout.getVerticalOffsetForLineNumber(position.lineNumber)}px;left:${Math.max(0, left)}px;width:${options.cursorStyle === 'block' ? charWidth : options.cursorWidth}px;height:${lineHeight}px;`;
			if (!this._focused) {
				el.classList.add('dc-cursor-unfocused');
			}
			if (!this._blinkOn) {
				el.classList.add('dc-cursor-hidden');
			}
			this._domNode.appendChild(el);
		}
	}

	private _updateBlinkTimer(): void {
		if (this._blinkTimer) {
			clearInterval(this._blinkTimer);
			this._blinkTimer = null;
		}
		if (!this._focused) {
			this._blinkOn = true;
			return;
		}
		this._blinkOn = true;
		this._blinkTimer = setInterval(() => {
			this._blinkOn = !this._blinkOn;
		}, BLINK_INTERVAL_MS);
	}

	override dispose(): void {
		if (this._blinkTimer) {
			clearInterval(this._blinkTimer);
			this._blinkTimer = null;
		}
		super.dispose();
	}
}
