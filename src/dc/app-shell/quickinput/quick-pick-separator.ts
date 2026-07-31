/**
 * Dardcor Code - Visual Separator Lines In Quick Pick Menu List
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { $ } from '../../core/dom/element.js';
import { QuickPickItem, IQuickPickItemOptions } from './quick-pick-item.js';

export interface IQuickPickSeparatorOptions {
	readonly label?: string;
	readonly icon?: string;
}

export class QuickPickSeparator extends QuickPickItem {
	constructor(
		label: string,
		options: IQuickPickSeparatorOptions = {}
	) {
		super({
			label,
			icon: options.icon,
			detail: undefined,
			disabled: true,
		} satisfies IQuickPickItemOptions);
	}

	get label(): string {
		return super.label;
	}

	override getSearchText(): string {
		return '';
	}
}

export function createSeparatorRow(label: string, icon?: string): HTMLElement {
	const row = $<HTMLElement>('div', 'dc-quick-pick-separator');
	row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 12px 2px;user-select:none;';
	row.dataset['separator'] = 'true';

	const left = $<HTMLElement>('span', 'dc-quick-pick-separator-line-left');
	left.style.cssText = 'flex:1;height:1px;background:#3c3c3c;';

	const center = $<HTMLElement>('span', 'dc-quick-pick-separator-label');
	center.style.cssText = 'font-size:11px;font-weight:600;color:#858585;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;';
	center.textContent = icon ? `${icon} ${label}`.trim() : label;

	const right = $<HTMLElement>('span', 'dc-quick-pick-separator-line-right');
	right.style.cssText = 'flex:1;height:1px;background:#3c3c3c;';

	row.appendChild(left);
	row.appendChild(center);
	row.appendChild(right);
	return row;
}

export function appendSeparator(list: HTMLElement, label: string, icon?: string): HTMLElement {
	const row = createSeparatorRow(label, icon);
	list.appendChild(row);
	return row;
}

export function isSeparatorElement(element: HTMLElement): boolean {
	return element.dataset['separator'] === 'true';
}

export function createSeparatorItem(label: string, icon?: string): QuickPickSeparator {
	return new QuickPickSeparator(label, { icon });
}

export class QuickPickSeparatorRenderer extends Disposable {
	private readonly _rows = new Map<string, HTMLElement>();

	constructor(private readonly _list: HTMLElement) {
		super();
	}

	renderSeparator(label: string, id?: string, icon?: string): HTMLElement {
		const key = id ?? label;
		const existing = this._rows.get(key);
		if (existing) {
			return existing;
		}
		const row = appendSeparator(this._list, label, icon);
		this._rows.set(key, row);
		return row;
	}

	removeSeparator(id: string): void {
		const row = this._rows.get(id);
		if (row) {
			row.remove();
			this._rows.delete(id);
		}
	}

	clear(): void {
		for (const row of this._rows.values()) {
			row.remove();
		}
		this._rows.clear();
	}

	dispose(): void {
		this.clear();
		super.dispose();
	}
}
