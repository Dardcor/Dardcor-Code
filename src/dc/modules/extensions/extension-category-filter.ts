/**
 * Dardcor Code - Extension Category Filter Chip Bar
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';

export const EXTENSION_CATEGORIES = [
	'All',
	'Programming Languages',
	'Themes',
	'Debuggers',
	'Formatters',
	'Linters',
	'Keymaps',
	'Snippets',
	'Language Packs',
	'Visualization',
	'Other'
] as const;

export type ExtensionCategory = typeof EXTENSION_CATEGORIES[number];

export class ExtensionCategoryFilter extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _container: HTMLElement;
	private _activeCategory: ExtensionCategory = 'All';
	private _categories: readonly string[] = EXTENSION_CATEGORIES;

	constructor(parentDom: HTMLElement, categories: readonly string[] = EXTENSION_CATEGORIES) {
		super();
		this._categories = categories.length > 0 ? categories : EXTENSION_CATEGORIES;
		this._container = $<HTMLElement>('div', 'dc-extension-category-filter');
		this._container.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;border-bottom:1px solid #2a2d2e;';
		parentDom.appendChild(this._container);
		this.render();
	}

	get activeCategory(): ExtensionCategory {
		return this._activeCategory;
	}

	public setActive(category: ExtensionCategory): void {
		if (this._activeCategory !== category) {
			this._activeCategory = category;
			this._onDidChange.fire();
			this.render();
		}
	}

	public setCategories(categories: readonly string[]): void {
		this._categories = categories.length > 0 ? categories : EXTENSION_CATEGORIES;
		this.render();
	}

	public matches(category?: string): boolean {
		if (this._activeCategory === 'All' || !category) {
			return true;
		}
		return category.toLowerCase() === this._activeCategory.toLowerCase();
	}

	public render(): void {
		clearNode(this._container);
		for (const category of this._categories) {
			const chip = $<HTMLButtonElement>('button');
			chip.textContent = category;
			chip.style.cssText = `background:${category === this._activeCategory ? '#007fd4' : '#2a2d2e'};border:none;border-radius:10px;color:${category === this._activeCategory ? '#ffffff' : '#cccccc'};font-size:11px;padding:3px 10px;cursor:pointer;`;
			chip.addEventListener('mouseenter', () => {
				if (category !== this._activeCategory) {
					chip.style.background = '#3c3c3c';
				}
			});
			chip.addEventListener('mouseleave', () => {
				chip.style.background = category === this._activeCategory ? '#007fd4' : '#2a2d2e';
			});
			this._register(addDisposableListener(chip, 'click', () => {
				this.setActive(category as ExtensionCategory);
			}));
			this._container.appendChild(chip);
		}
	}
}

export function categoryOfExtension(extensionId: string): string {
	const lower = extensionId.toLowerCase();
	if (lower.includes('theme')) {
		return 'Themes';
	}
	if (lower.includes('debug')) {
		return 'Debuggers';
	}
	if (lower.includes('format') || lower.includes('prettier') || lower.includes('beaut')) {
		return 'Formatters';
	}
	if (lower.includes('lint')) {
		return 'Linters';
	}
	if (lower.includes('keymap') || lower.includes('vim')) {
		return 'Keymaps';
	}
	if (lower.includes('snippet')) {
		return 'Snippets';
	}
	if (lower.includes('language') || lower.includes('typescript') || lower.includes('python') || lower.includes('cpp') || lower.includes('rust') || lower.includes('go')) {
		return 'Programming Languages';
	}
	return 'Other';
}
