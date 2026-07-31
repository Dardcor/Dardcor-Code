/**
 * Dardcor Code - Table of Contents Side Navigation Panel for Settings GUI
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { SETTINGS_CATEGORIES } from './settings-editor';

const TOC_STYLE_ID = 'dc-settings-toc-styles';

export interface ISettingsTocEntry {
	readonly id: string;
	readonly label: string;
	readonly icon: string;
}

export class SettingsToc extends Disposable {
	private readonly _onDidSelect = this._register(new Emitter<string>());
	readonly onDidSelect: Event<string> = this._onDidSelect.event;

	private readonly _container: HTMLElement;
	private readonly _entries: ISettingsTocEntry[] = [];
	private _activeId = 'All';

	constructor(parentDom?: HTMLElement) {
		super();

		CssInjector.inject(TOC_STYLE_ID, `
			.dc-settings-toc-item { display: flex; align-items: center; gap: 8px; padding: 5px 12px; cursor: pointer; font-size: 12px; color: #cccccc; user-select: none; }
			.dc-settings-toc-item:hover { background: #2a2d2e; }
			.dc-settings-toc-item.active { background: #37373d; color: #ffffff; }
			.dc-settings-toc-icon { width: 16px; text-align: center; font-size: 11px; }
		`);

		this._container = $<HTMLElement>('div', 'dc-settings-toc');
		this._container.style.cssText = 'display:flex;flex-direction:column;';

		this._entries = [
			{ id: 'All', label: 'Semua Pengaturan', icon: '\u2699' },
			...SETTINGS_CATEGORIES.map(category => ({
				id: category,
				label: category,
				icon: SettingsToc.getCategoryIcon(category)
			}))
		];

		if (parentDom) {
			parentDom.appendChild(this._container);
			this.render();
		}
	}

	get container(): HTMLElement {
		return this._container;
	}

	get entries(): ISettingsTocEntry[] {
		return [...this._entries];
	}

	get activeId(): string {
		return this._activeId;
	}

	public setActive(id: string): void {
		this._activeId = id;
		this.render();
	}

	public render(): void {
		clearNode(this._container);
		for (const entry of this._entries) {
			const item = $<HTMLElement>('div', 'dc-settings-toc-item' + (entry.id === this._activeId ? ' active' : ''));
			item.dataset['tocId'] = entry.id;

			const icon = $<HTMLElement>('span', 'dc-settings-toc-icon');
			icon.textContent = entry.icon;

			const label = $<HTMLElement>('span');
			label.textContent = entry.label;

			item.appendChild(icon);
			item.appendChild(label);
			this._register(addDisposableListener(item, 'click', () => {
				this.setActive(entry.id);
				this._onDidSelect.fire(entry.id);
			}));
			this._container.appendChild(item);
		}
	}

	public static getCategoryIcon(category: string): string {
		const map: Record<string, string> = {
			Editor: '\u270E',
			Workbench: '\u25A2',
			Terminal: '\u276F',
			Search: '\u2315',
			Files: '\u2630',
			Git: '\u27F4',
			Debug: '\u25B6'
		};
		return map[category] ?? '\u2022';
	}
}
