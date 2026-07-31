/**
 * Dardcor Code - Bottom Settings Gear & Account Icon Activity Actions
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $ } from '../../../core/dom/element.js';
import { layoutContextMenu, getAnchorFromElement } from '../../../core/dom/context-menu.js';

export type GlobalActionId = 'settings' | 'accounts' | 'commandPalette' | 'keyboardShortcuts' | 'themes' | 'snippets' | 'checkForUpdates' | 'about';

export interface IGlobalActionEvent {
	readonly id: GlobalActionId;
}

interface IGlobalMenuEntry {
	readonly id: GlobalActionId | string;
	readonly label: string;
	readonly keybinding?: string;
	readonly separator?: boolean;
}


const SETTINGS_MENU: IGlobalMenuEntry[] = [
	{ id: 'settings', label: 'Settings', keybinding: 'Ctrl+,' },
	{ id: 'keyboardShortcuts', label: 'Keyboard Shortcuts', keybinding: 'Ctrl+K Ctrl+S' },
	{ id: 'snippets', label: 'User Snippets' },
	{ id: 'themes', label: 'Color Theme' },
	{ id: 'sep1', label: '', separator: true },
	{ id: 'checkForUpdates', label: 'Check For Updates...' },
	{ id: 'about', label: 'About Dardcor Code' },
];

export class GlobalActions extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _settingsButton: HTMLButtonElement;
	private readonly _accountButton: HTMLButtonElement;
	private _menu: HTMLElement | null = null;
	private _accountBadge: string | null = null;

	private readonly _onDidSelect = this._register(new Emitter<IGlobalActionEvent>());
	readonly onDidSelect: Event<IGlobalActionEvent> = this._onDidSelect.event;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-global-actions');
		this._container.style.cssText = 'display:flex;flex-direction:column;align-items:center;margin-top:auto;padding-bottom:8px;';
		parent.appendChild(this._container);

		this._accountButton = this._createButton('\u263a', 'Accounts', (e: MouseEvent) => this._openAccountMenu(e));
		this._settingsButton = this._createButton('\u2699', 'Manage', (e: MouseEvent) => this._openSettingsMenu(e));

		this._container.appendChild(this._accountButton);
		this._container.appendChild(this._settingsButton);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get settingsButton(): HTMLButtonElement {
		return this._settingsButton;
	}

	get accountButton(): HTMLButtonElement {
		return this._accountButton;
	}

	setAccountBadge(initials: string | null): void {
		this._accountBadge = initials;
		this._accountButton.textContent = initials ?? '\u263a';
	}

	private _createButton(icon: string, title: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
		const btn = $<HTMLButtonElement>('button', 'dc-global-action');
		btn.type = 'button';
		btn.textContent = icon;
		btn.title = title;
		btn.style.cssText = 'position:relative;width:48px;height:40px;border:none;background:transparent;color:#858585;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;outline:none;';
		btn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			onClick(e);
		});
		return btn;
	}

	private _openSettingsMenu(e: MouseEvent): void {
		e.preventDefault();
		this._openMenu(getAnchorFromElement(this._settingsButton), SETTINGS_MENU);
	}

	private _openAccountMenu(e: MouseEvent): void {
		e.preventDefault();
		const menu: IGlobalMenuEntry[] = [
			{ id: 'accounts', label: 'Sign In To Sync Settings...' },
			{ id: 'sep1', label: '', separator: true },
			{ id: 'about', label: 'About Dardcor Code' },
		];
		this._openMenu(getAnchorFromElement(this._accountButton), menu);
	}

	private _openMenu(anchor: { x: number; y: number; width?: number; height?: number }, entries: IGlobalMenuEntry[]): void {
		this._closeMenu();
		const height = entries.filter(e => !e.separator).length * 28 + entries.filter(e => e.separator).length * 9 + 8;
		const layout = layoutContextMenu(anchor, 220, height, window.innerWidth, window.innerHeight);

		const menu = $<HTMLElement>('div', 'dc-global-actions-menu');
		menu.style.cssText = `position:fixed;left:${layout.left}px;top:${layout.top}px;min-width:220px;background:#252526;border:1px solid #454545;box-shadow:0 6px 16px rgba(0,0,0,0.4);z-index:2100;padding:4px 0;font-size:12px;color:#cccccc;font-family:Segoe UI, sans-serif;user-select:none;`;
		this._menu = menu;
		document.body.appendChild(menu);

		for (const entry of entries) {
			if (entry.separator) {
				const sep = $<HTMLElement>('div', 'dc-global-actions-separator');
				sep.style.cssText = 'height:1px;background:#3c3c3c;margin:4px 10px;';
				menu.appendChild(sep);
				continue;
			}
			const row = $<HTMLElement>('div', 'dc-global-actions-item');
			row.style.cssText = 'display:flex;align-items:center;padding:5px 12px;cursor:pointer;gap:8px;';
			const label = $<HTMLElement>('span', 'dc-global-actions-item-label');
			label.textContent = entry.label;
			label.style.cssText = 'flex:1;';
			row.appendChild(label);
			if (entry.keybinding) {
				const key = $<HTMLElement>('span', 'dc-global-actions-item-key');
				key.textContent = entry.keybinding;
				key.style.cssText = 'color:#858585;font-size:11px;';
				row.appendChild(key);
			}
			row.addEventListener('mouseenter', () => {
				row.style.background = '#04395e';
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = 'transparent';
			});
			row.addEventListener('click', () => {
				this._onDidSelect.fire({ id: entry.id as GlobalActionId });
				this._closeMenu();
			});
			menu.appendChild(row);
		}

		const onMouseDown = (ev: MouseEvent) => {
			if (!menu.contains(ev.target as Node)) {
				document.removeEventListener('mousedown', onMouseDown);
				this._closeMenu();
			}
		};
		document.addEventListener('mousedown', onMouseDown);
	}

	private _closeMenu(): void {
		this._menu?.remove();
		this._menu = null;
	}

	dispose(): void {
		this._closeMenu();
		this._container.remove();
		super.dispose();
	}
}
