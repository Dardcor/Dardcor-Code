/**
 * Dardcor Code - Unsaved Document Modified Circle Dot Tab Status
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';

export interface IEditorDirtyIndicatorOptions {
	readonly color?: string;
	readonly size?: number;
	readonly tooltip?: string;
}

export class EditorDirtyIndicator extends Disposable {
	private readonly _el: HTMLElement;
	private _dirty = false;
	private readonly _color: string;
	private readonly _size: number;
	private readonly _tooltip: string;

	private readonly _onDidChange = this._register(new Emitter<boolean>());
	readonly onDidChange: Event<boolean> = this._onDidChange.event;

	constructor(
		parent: HTMLElement,
		options: IEditorDirtyIndicatorOptions = {}
	) {
		super();
		this._color = options.color ?? '#cccccc';
		this._size = options.size ?? 8;
		this._tooltip = options.tooltip ?? 'Unsaved changes';

		this._el = $<HTMLElement>('span', 'dc-editor-dirty-indicator');
		this._el.style.cssText = `width:${this._size}px;height:${this._size}px;border-radius:50%;background:${this._color};flex-shrink:0;display:none;`;
		parent.appendChild(this._el);
	}

	get element(): HTMLElement {
		return this._el;
	}

	get isDirty(): boolean {
		return this._dirty;
	}

	setDirty(dirty: boolean): void {
		if (this._dirty === dirty) {
			return;
		}
		this._dirty = dirty;
		if (dirty) {
			this._el.style.display = 'block';
			this._el.title = this._tooltip;
		} else {
			this._el.style.display = 'none';
			this._el.title = '';
		}
		this._onDidChange.fire(dirty);
	}

	toggle(): void {
		this.setDirty(!this._dirty);
	}

	setColor(color: string): void {
		this._el.style.background = color;
	}

	dispose(): void {
		this._el.remove();
		super.dispose();
	}
}

/**
 * Applies the dirty dot state onto an existing tab element.
 * Creates or removes the indicator element inside `tab`.
 */
export function applyDirtyToTab(tab: HTMLElement, dirty: boolean, closeButton?: HTMLElement | null): void {
	let indicator = tab.querySelector('.dc-editor-dirty-indicator') as HTMLElement | null;
	if (!dirty) {
		indicator?.remove();
		if (closeButton) {
			closeButton.textContent = '\u2715';
			closeButton.style.color = '#858585';
		}
		return;
	}
	if (!indicator) {
		indicator = $<HTMLElement>('span', 'dc-editor-dirty-indicator');
		indicator.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#cccccc;flex-shrink:0;';
		const label = tab.querySelector('.dc-tab-label') ?? tab.querySelector('span');
		if (label) {
			tab.insertBefore(indicator, label.nextSibling);
		} else {
			tab.appendChild(indicator);
		}
	}
	indicator.title = 'Unsaved changes';
	if (closeButton) {
		closeButton.textContent = '';
		closeButton.style.color = 'transparent';
	}
}

export function isTabDirty(tab: HTMLElement): boolean {
	return tab.querySelector('.dc-editor-dirty-indicator') !== null;
}
