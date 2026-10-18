/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class ChatCardListbox {

	private readonly options: HTMLElement[] = [];
	private _activeIndex = -1;

	constructor(
		readonly domNode: HTMLElement,
		ariaLabel: string,
		private readonly activeClass: string,
	) {
		this.domNode.setAttribute('role', 'listbox');
		this.domNode.setAttribute('aria-label', ariaLabel);
		this.domNode.tabIndex = 0;
	}

	get activeIndex(): number {
		return this._activeIndex;
	}

	get length(): number {
		return this.options.length;
	}

	addOption(element: HTMLElement, idPrefix: string): void {
		element.id = `${idPrefix}-option-${this.options.length}`;
		element.setAttribute('role', 'option');
		element.setAttribute('aria-selected', 'false');
		this.options.push(element);
	}

	setActive(index: number): void {
		this._activeIndex = index;
		this.options.forEach((option, i) => {
			const isActive = i === index;
			option.classList.toggle(this.activeClass, isActive);
			option.setAttribute('aria-selected', String(isActive));
		});

		const active = this.options[index];
		if (active) {
			this.domNode.setAttribute('aria-activedescendant', active.id);
		} else {
			this.domNode.removeAttribute('aria-activedescendant');
		}
	}

	focus(): void {
		this.domNode.focus();
	}

	clampedIndex(index: number): number {
		return Math.max(0, Math.min(index, this.options.length - 1));
	}

	wrappedIndex(index: number): number {
		if (this.options.length === 0) {
			return -1;
		}
		return (index + this.options.length) % this.options.length;
	}
}
