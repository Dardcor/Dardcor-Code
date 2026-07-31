/**
 * Dardcor Code - Editor Group Upper Bar Element
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';
import { URI } from '../../../core/types/uri';
import { EditorBreadcrumb, IBreadcrumbNavigationEvent } from './editor-breadcrumb';
import { EditorGroupActions } from './editor-group-actions';
import { EditorOverflowTabs, IOverflowTab } from './editor-overflow-tabs';
import { EditorInput } from './editor-input';
import { EditorDirtyIndicator } from './editor-dirty-indicator';
import { Direction } from '../../layout/grid-layout';

export interface IEditorTitleControlOptions {
	readonly breadcrumb?: boolean;
	readonly overflow?: boolean;
	readonly actions?: boolean;
	readonly tabs?: boolean;
}

export class EditorTitleControl extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _bar: HTMLElement;
	private readonly _leftSection: HTMLElement;
	private readonly _tabsSection: HTMLElement;
	private readonly _tabs = new Map<string, HTMLElement>();
	private readonly _dirtyIndicators = new Map<string, EditorDirtyIndicator>();
	private readonly _pinnedKeys = new Set<string>();
	private _activeKey: string | null = null;

	private readonly _breadcrumb: EditorBreadcrumb | null;
	private readonly _overflow: EditorOverflowTabs | null;
	private readonly _actions: EditorGroupActions | null;

	private readonly _onDidNavigate = this._register(new Emitter<IBreadcrumbNavigationEvent>());
	readonly onDidNavigate: Event<IBreadcrumbNavigationEvent> = this._onDidNavigate.event;

	private readonly _onDidSplit = this._register(new Emitter<Direction>());
	readonly onDidSplit: Event<Direction> = this._onDidSplit.event;

	private readonly _onDidSelectTab = this._register(new Emitter<EditorInput>());
	readonly onDidSelectTab: Event<EditorInput> = this._onDidSelectTab.event;

	private readonly _onDidCloseTab = this._register(new Emitter<EditorInput>());
	readonly onDidCloseTab: Event<EditorInput> = this._onDidCloseTab.event;

	constructor(
		parent: HTMLElement,
		private readonly _options: IEditorTitleControlOptions = {}
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-title-control');
		this._container.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;background:#252526;';
		this._bar = $<HTMLElement>('div', 'dc-editor-title-control-bar');
		this._bar.style.cssText = 'height:35px;display:flex;align-items:stretch;';
		this._container.appendChild(this._bar);

		this._leftSection = $<HTMLElement>('div', 'dc-editor-title-control-left');
		this._leftSection.style.cssText = 'display:flex;align-items:center;flex-shrink:0;min-width:0;';
		this._bar.appendChild(this._leftSection);

		this._tabsSection = $<HTMLElement>('div', 'dc-editor-title-control-tabs');
		this._tabsSection.style.cssText = 'display:flex;align-items:stretch;flex:1;overflow:hidden;';
		this._bar.appendChild(this._tabsSection);

		if (this._options.breadcrumb !== false) {
			this._breadcrumb = new EditorBreadcrumb(this._container, { visible: false });
			this._register(this._breadcrumb);
			this._breadcrumb.onDidNavigate(e => this._onDidNavigate.fire(e));
		} else {
			this._breadcrumb = null;
		}

		if (this._options.overflow !== false) {
			this._overflow = new EditorOverflowTabs(this._bar);
			this._register(this._overflow);
			this._overflow.onDidSelectTab(key => {
				const input = this._inputs.get(key);
				if (input) {
					this._onDidSelectTab.fire(input);
				}
			});
		} else {
			this._overflow = null;
		}

		if (this._options.actions !== false) {
			this._actions = new EditorGroupActions(this._bar, { closeGroup: true });
			this._register(this._actions);
			this._actions.onDidSplit(d => this._onDidSplit.fire(d));
		} else {
			this._actions = null;
		}

		parent.appendChild(this._container);
	}

	private readonly _inputs = new Map<string, EditorInput>();

	get element(): HTMLElement {
		return this._container;
	}

	get breadcrumb(): EditorBreadcrumb | null {
		return this._breadcrumb;
	}

	get tabsContainer(): HTMLElement {
		return this._tabsSection;
	}

	get actions(): EditorGroupActions | null {
		return this._actions;
	}

	setUri(uri: URI): void {
		this._breadcrumb?.setUri(uri);
	}

	setTabTitle(input: EditorInput, title: string): void {
		const tab = this._tabs.get(input.toKey());
		if (tab) {
			tab.title = title;
		}
	}

	openTab(input: EditorInput): void {
		const key = input.toKey();
		if (this._tabs.has(key)) {
			this.setActive(input);
			return;
		}
		this._inputs.set(key, input);
		const tab = $<HTMLElement>('div', 'dc-title-control-tab');
		tab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 8px;font-size:12px;color:#969696;cursor:pointer;border-right:1px solid #1e1e1e;white-space:nowrap;user-select:none;';
		tab.title = input.getLabel();
		const label = $<HTMLElement>('span', 'dc-title-control-tab-label');
		label.textContent = input.getName();
		label.style.cssText = 'max-width:160px;overflow:hidden;text-overflow:ellipsis;';
		tab.appendChild(label);
		const dirty = new EditorDirtyIndicator(tab);
		this._dirtyIndicators.set(key, dirty);
		tab.addEventListener('click', () => this._onDidSelectTab.fire(input));
		tab.addEventListener('auxclick', (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				this._onDidCloseTab.fire(input);
			}
		});
		this._tabs.set(key, tab);
		this._tabsSection.appendChild(tab);
		this.setActive(input);
		this._updateOverflow();
	}

	closeTab(input: EditorInput): void {
		const key = input.toKey();
		const tab = this._tabs.get(key);
		if (!tab) {
			return;
		}
		tab.remove();
		this._tabs.delete(key);
		this._inputs.delete(key);
		this._dirtyIndicators.get(key)?.dispose();
		this._dirtyIndicators.delete(key);
		if (this._activeKey === key) {
			this._activeKey = null;
		}
		this._updateOverflow();
	}

	setActive(input: EditorInput): void {
		this._activeKey = input.toKey();
		for (const [key, tab] of this._tabs) {
			const active = key === this._activeKey;
			tab.style.background = active ? '#1e1e1e' : 'transparent';
			tab.style.color = active ? '#ffffff' : '#969696';
		}
		this._updateOverflow();
	}

	setPinned(input: EditorInput, pinned: boolean): void {
		if (pinned) {
			this._pinnedKeys.add(input.toKey());
		} else {
			this._pinnedKeys.delete(input.toKey());
		}
		this._updateOverflow();
	}

	setDirty(input: EditorInput, dirty: boolean): void {
		this._dirtyIndicators.get(input.toKey())?.setDirty(dirty);
	}

	clearTabs(): void {
		clearNode(this._tabsSection);
		this._tabs.clear();
		this._inputs.clear();
		for (const indicator of this._dirtyIndicators.values()) {
			indicator.dispose();
		}
		this._dirtyIndicators.clear();
		this._activeKey = null;
		this._overflow?.setTabs([]);
	}

	private _updateOverflow(): void {
		if (!this._overflow) {
			return;
		}
		const visibleCount = this._tabs.size;
		const allTabs: IOverflowTab[] = [];
		for (const [key, input] of this._inputs) {
			allTabs.push({
				key,
				label: input.getName(),
				active: key === this._activeKey,
				pinned: this._pinnedKeys.has(key),
			});
		}
		this._overflow.setTabs(allTabs);
		this._overflow.setVisibleCount(visibleCount);
	}

	dispose(): void {
		this.clearTabs();
		this._container.remove();
		super.dispose();
	}
}
