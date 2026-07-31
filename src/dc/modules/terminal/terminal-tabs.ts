/**
 * Dardcor Code - Multi-Terminal Instance Side Tab Bar
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';

const TABS_STYLE_ID = 'dc-terminal-tabs-styles';

export interface ITerminalTab {
	readonly id: number;
	name: string;
	active: boolean;
}

export class TerminalTabs extends Disposable {
	private readonly _onDidAddTab = this._register(new Emitter<ITerminalTab>());
	readonly onDidAddTab: Event<ITerminalTab> = this._onDidAddTab.event;

	private readonly _onDidCloseTab = this._register(new Emitter<number>());
	readonly onDidCloseTab: Event<number> = this._onDidCloseTab.event;

	private readonly _onDidChangeActiveTab = this._register(new Emitter<number>());
	readonly onDidChangeActiveTab: Event<number> = this._onDidChangeActiveTab.event;

	private readonly _onDidRequestNewTab = this._register(new Emitter<void>());
	readonly onDidRequestNewTab: Event<void> = this._onDidRequestNewTab.event;

	private readonly _container: HTMLElement;
	private readonly _tabs: ITerminalTab[] = [];
	private _activeId = -1;
	private _idCounter = 1;

	constructor(parentDom: HTMLElement) {
		super();
		CssInjector.inject(TABS_STYLE_ID, `
			.dc-terminal-tab { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; height: 100%; color: #cccccc; cursor: pointer; user-select: none; border-right: 1px solid #2a2d2e; }
			.dc-terminal-tab:hover { background: #2a2d2e; }
			.dc-terminal-tab.active { background: #37373d; color: #ffffff; }
			.dc-terminal-tab .dc-terminal-tab-close { visibility: hidden; background: none; border: none; color: #cccccc; cursor: pointer; font-size: 10px; padding: 0 2px; }
			.dc-terminal-tab:hover .dc-terminal-tab-close { visibility: visible; }
			.dc-terminal-tab .dc-terminal-tab-close:hover { color: #ffffff; }
		`);
		this._container = $<HTMLElement>('div', 'dc-terminal-tabs');
		this._container.style.cssText = 'display:flex;align-items:stretch;height:30px;background:#252526;border-bottom:1px solid #2a2d2e;overflow-x:auto;';

		const addButton = $<HTMLButtonElement>('button', 'dc-terminal-add');
		addButton.textContent = '+';
		addButton.title = 'Terminal Baru';
		addButton.style.cssText = 'background:transparent;border:none;color:#cccccc;font-size:14px;cursor:pointer;padding:0 10px;';
		this._register(addDisposableListener(addButton, 'click', () => {
			this._onDidRequestNewTab.fire();
		}));

		this._container.appendChild(addButton);
		parentDom.appendChild(this._container);
	}

	get activeTabId(): number {
		return this._activeId;
	}

	get tabs(): ITerminalTab[] {
		return this._tabs;
	}

	public getTab(id: number): ITerminalTab | undefined {
		return this._tabs.find(tab => tab.id === id);
	}

	public addTab(name: string): ITerminalTab {
		const id = this._idCounter++;
		const tab: ITerminalTab = { id, name, active: false };
		this._tabs.push(tab);
		this.setActive(id);
		this._onDidAddTab.fire(tab);
		this._render();
		return tab;
	}

	public removeTab(id: number): void {
		const index = this._tabs.findIndex(tab => tab.id === id);
		if (index === -1) {
			return;
		}
		this._tabs.splice(index, 1);
		if (this._activeId === id) {
			const next = this._tabs[Math.min(index, this._tabs.length - 1)];
			this._activeId = next ? next.id : -1;
		}
		this._onDidCloseTab.fire(id);
		this._render();
	}

	public setActive(id: number): void {
		if (!this._tabs.some(tab => tab.id === id)) {
			return;
		}
		this._activeId = id;
		for (const tab of this._tabs) {
			tab.active = tab.id === id;
		}
		this._onDidChangeActiveTab.fire(id);
		this._render();
	}

	public renameTab(id: number, name: string): void {
		const tab = this.getTab(id);
		if (tab) {
			tab.name = name;
			this._render();
		}
	}

	private _render(): void {
		const existing = Array.from(this._container.querySelectorAll('.dc-terminal-tab'));
		for (const el of existing) {
			el.remove();
		}
		for (const tab of this._tabs) {
			const el = $<HTMLElement>('div', 'dc-terminal-tab' + (tab.active ? ' active' : ''));
			el.dataset['tabId'] = String(tab.id);

			const name = $<HTMLElement>('span');
			name.textContent = tab.name;
			name.style.fontSize = '12px';

			const close = $<HTMLButtonElement>('button', 'dc-terminal-tab-close');
			close.textContent = '\u2716';
			close.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.removeTab(tab.id);
			});

			el.appendChild(name);
			el.appendChild(close);
			this._register(addDisposableListener(el, 'click', () => {
				this.setActive(tab.id);
			}));

			this._container.insertBefore(el, this._container.lastChild);
		}
	}

	public clear(): void {
		this._tabs.splice(0, this._tabs.length);
		this._activeId = -1;
		clearNode(this._container);
	}
}
