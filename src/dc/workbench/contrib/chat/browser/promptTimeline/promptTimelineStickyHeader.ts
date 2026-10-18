/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import './media/promptTimeline.css';

export class PromptTimelineStickyHeader extends Disposable {

	private readonly _domNode: HTMLElement;
	private readonly _labelButton: HTMLButtonElement;
	private readonly _label: HTMLElement;
	private readonly _count: HTMLElement;

	private _labelLine: HTMLElement;
	private _currentLabel = '';
	private _lastIndex: number | undefined;
	private _visible = false;
	private _rollInAnim: Animation | undefined;
	private _rollOutAnim: Animation | undefined;
	private _rollOutgoing: HTMLElement | undefined;

	private readonly _onDidActivate = this._register(new Emitter<void>());
	readonly onDidActivate: Event<void> = this._onDidActivate.event;

	get domNode(): HTMLElement { return this._domNode; }

	constructor(
		container: HTMLElement,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
	) {
		super();
		this._domNode = append(container, $('.prompt-timeline-sticky'));
		const content = append(this._domNode, $('.prompt-timeline-sticky-content'));
		const band = append(content, $('.prompt-timeline-sticky-band'));

		this._labelButton = append(band, $<HTMLButtonElement>('button.prompt-timeline-sticky-label-button'));
		this._label = append(this._labelButton, $('span.prompt-timeline-sticky-label'));
		this._labelLine = this._createLine('');
		this._label.appendChild(this._labelLine);
		this._count = append(this._labelButton, $('span.prompt-timeline-sticky-count'));
		this._register(addDisposableListener(this._labelButton, EventType.CLICK, () => this._onDidActivate.fire()));

		this._setVisible(false);
	}

	update(text: string, index: number, total: number): void {
		const label = text || localize('promptTimeline.emptyPrompt', "(empty prompt)");
		this._count.textContent = localize('promptTimeline.stickyCount', "{0}/{1}", index, total);
		this._labelButton.title = label;
		this._labelButton.setAttribute('aria-label', localize('promptTimeline.stickyLabel', "Go to prompt {0} of {1}: {2}", index, total, label));

		if (label !== this._currentLabel || index !== this._lastIndex) {
			const direction = this._lastIndex !== undefined && index !== this._lastIndex ? Math.sign(index - this._lastIndex) : 0;
			const newLine = this._createLine(label);
			this._label.appendChild(newLine);
			const oldLine = this._labelLine;
			this._labelLine = newLine;
			if (this._visible && direction !== 0 && !this.accessibilityService.isMotionReduced()) {
				this._roll(oldLine, newLine, direction);
			} else {
				this._finalizeRoll();
				oldLine.remove();
			}
			this._currentLabel = label;
		}
		this._lastIndex = index;
	}

	private _createLine(text: string): HTMLElement {
		const line = $('.prompt-timeline-sticky-label-line');
		append(line, $('span.prompt-timeline-sticky-label-text')).textContent = text;
		return line;
	}

	private _roll(oldLine: HTMLElement, newLine: HTMLElement, direction: number): void {
		this._finalizeRoll();
		const timing: KeyframeAnimationOptions = { duration: 140, easing: 'ease' };
		const outTo = direction > 0 ? -100 : 100;
		const inFrom = direction > 0 ? 100 : -100;
		const outAnim = oldLine.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${outTo}%)`, opacity: 0 }], timing);
		const inAnim = newLine.animate([{ transform: `translateY(${inFrom}%)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], timing);
		this._rollOutgoing = oldLine;
		this._rollOutAnim = outAnim;
		this._rollInAnim = inAnim;
		outAnim.finished.then(() => oldLine.remove(), () => { });
		inAnim.finished.then(() => {
			if (this._rollInAnim === inAnim) {
				this._rollInAnim = this._rollOutAnim = this._rollOutgoing = undefined;
			}
		}, () => { });
	}

	private _finalizeRoll(): void {
		this._rollInAnim?.finish();
		this._rollOutAnim?.finish();
		this._rollOutgoing?.remove();
		this._rollInAnim = this._rollOutAnim = this._rollOutgoing = undefined;
	}

	setVisible(visible: boolean): void {
		this._setVisible(visible);
	}

	private _setVisible(visible: boolean): void {
		this._visible = visible;
		this._domNode.classList.toggle('hidden', !visible);
		this._domNode.toggleAttribute('inert', !visible);
		if (!visible) {
			this._finalizeRoll();
		}
	}

	override dispose(): void {
		this._rollInAnim?.cancel();
		this._rollOutAnim?.cancel();
		this._domNode.remove();
		super.dispose();
	}
}
