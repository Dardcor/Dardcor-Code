/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { autorun } from '../../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { getCompactCodicon } from '../../chatIcons.js';
import { ChatCollapsibleContentPart } from './chatCollapsibleContentPart.js';

export abstract class ChatThinkingStyleContentPart extends ChatCollapsibleContentPart {

	private _thinkingActive = false;
	private _shimmerSpan: HTMLElement | undefined;

	protected get thinkingActive(): boolean {
		return this._thinkingActive;
	}

	protected override init(): HTMLElement {
		const node = super.init();
		node.classList.add('chat-thinking-box');
		node.classList.toggle('chat-thinking-active', this._thinkingActive);
		this._register(autorun(reader => {
			const expanded = this.expanded.read(reader);
			if (this._collapseButton) {
				this._collapseButton.icon = this.getThinkingIcon(this._thinkingActive, expanded);
			}
		}));
		return node;
	}

	protected setThinkingActive(active: boolean): void {
		this._thinkingActive = active;
		this.domNode.classList.toggle('chat-thinking-active', active);
		if (this._collapseButton) {
			this._collapseButton.icon = this.getThinkingIcon(active, this.isExpanded());
		}
	}

	protected getThinkingIcon(active: boolean, _expanded: boolean): ThemeIcon {
		return active ? Codicon.circleFilledCompact : Codicon.checkCompact;
	}

	protected setShimmerTitle(text: string): void {
		const labelElement = this._collapseButton?.labelElement;
		if (!labelElement) {
			return;
		}
		if (!this._shimmerSpan?.parentElement) {
			labelElement.textContent = '';
			this._shimmerSpan = $('span.chat-thinking-title-shimmer');
			labelElement.appendChild(this._shimmerSpan);
		}
		this._shimmerSpan.textContent = text;
	}

	protected forgetShimmerTitle(): void {
		this._shimmerSpan = undefined;
	}

	protected createThinkingBody(): HTMLElement {
		return $('.chat-used-context-list.chat-thinking-collapsible');
	}

	protected createThinkingRow(icon: ThemeIcon = Codicon.circleFilled): HTMLElement {
		const row = $('.chat-thinking-item.markdown-content');
		row.appendChild(createThinkingIcon(icon));
		return row;
	}

	protected createThinkingSpinnerRow(message: string): { readonly row: HTMLElement; readonly label: HTMLElement } {
		const row = $('.chat-thinking-item.chat-thinking-spinner-item');
		row.appendChild(createThinkingIcon(Codicon.circleFilled));
		const label = $('span.chat-thinking-spinner-label');
		label.textContent = message;
		row.appendChild(label);
		return { row, label };
	}
}

export function createThinkingIcon(icon: ThemeIcon): HTMLElement {
	const iconElement = $('span.chat-thinking-icon');
	iconElement.classList.add(...ThemeIcon.asClassNameArray(getCompactCodicon(icon)));
	return iconElement;
}
