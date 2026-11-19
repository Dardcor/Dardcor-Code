/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../dom.js';
import type { IManagedHover } from '../hover/hover.js';
import { IHoverDelegate } from '../hover/hoverDelegate.js';
import { getBaseLayerHoverDelegate } from '../hover/hoverDelegate2.js';
import { getDefaultHoverDelegate } from '../hover/hoverDelegateFactory.js';
import { renderLabelWithIcons } from '../iconLabel/iconLabels.js';
import { Disposable } from '../../../common/lifecycle.js';
import * as objects from '../../../common/objects.js';

export interface IHighlight {
	start: number;
	end: number;
	readonly extraClasses?: readonly string[];
}

export interface IHighlightedLabelOptions {
	readonly hoverDelegate?: IHoverDelegate;
}

export class HighlightedLabel extends Disposable {

	private readonly domNode: HTMLElement;
	private text: string = '';
	private title: string = '';
	private highlights: readonly IHighlight[] = [];
	private didEverRender: boolean = false;
	private customHover: IManagedHover | undefined;

	constructor(container: HTMLElement, private readonly options?: IHighlightedLabelOptions) {
		super();

		this.domNode = dom.append(container, dom.$('span.monaco-highlighted-label'));
	}

	get element(): HTMLElement {
		return this.domNode;
	}

	set(text: string | undefined, highlights: readonly IHighlight[] = [], title: string = '', escapeNewLines?: boolean, supportIcons?: boolean) {
		if (!text) {
			text = '';
		}

		if (escapeNewLines) {
			text = HighlightedLabel.escapeNewLines(text, highlights);
		}

		if (this.didEverRender && this.text === text && this.title === title && objects.equals(this.highlights, highlights)) {
			return;
		}

		this.text = text;
		this.title = title;
		this.highlights = highlights;
		this.render(supportIcons);
	}

	private render(supportIcons?: boolean): void {

		const children: Array<HTMLSpanElement | string> = [];
		let pos = 0;

		for (const highlight of this.highlights) {
			if (highlight.end === highlight.start) {
				continue;
			}

			if (pos < highlight.start) {
				const substring = this.text.substring(pos, highlight.start);
				if (supportIcons) {
					children.push(...renderLabelWithIcons(substring, true));
				} else {
					children.push(substring);
				}
				pos = highlight.start;
			}

			const substring = this.text.substring(pos, highlight.end);
			const element = dom.$('span.highlight', undefined, ...supportIcons ? renderLabelWithIcons(substring, true) : [substring]);

			if (highlight.extraClasses) {
				element.classList.add(...highlight.extraClasses);
			}

			children.push(element);
			pos = highlight.end;
		}

		if (pos < this.text.length) {
			const substring = this.text.substring(pos,);
			if (supportIcons) {
				children.push(...renderLabelWithIcons(substring, true));
			} else {
				children.push(substring);
			}
		}

		dom.reset(this.domNode, ...children);

		if (!this.customHover && this.title !== '') {
			const hoverDelegate = this.options?.hoverDelegate ?? getDefaultHoverDelegate('mouse');
			this.customHover = this._register(getBaseLayerHoverDelegate().setupManagedHover(hoverDelegate, this.domNode, this.title));
		} else if (this.customHover) {
			this.customHover.update(this.title);
		}

		this.didEverRender = true;
	}

	static escapeNewLines(text: string, highlights: readonly IHighlight[]): string {
		let total = 0;
		let extra = 0;

		return text.replace(/\r\n|\r|\n/g, (match, offset) => {
			extra = match === '\r\n' ? -1 : 0;
			offset += total;

			for (const highlight of highlights) {
				if (highlight.end <= offset) {
					continue;
				}
				if (highlight.start >= offset) {
					highlight.start += extra;
				}
				if (highlight.end >= offset) {
					highlight.end += extra;
				}
			}

			total += extra;
			return '\u23CE';
		});
	}
}
