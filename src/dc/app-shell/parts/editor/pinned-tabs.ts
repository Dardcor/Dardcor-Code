/**
 * Dardcor Code - Compact Pinned Tab Rendering Controller
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $, clearNode } from '../../../core/dom/element.js';
import { EditorInput } from './editor-input.js';
import { DROP_DATA_FORMAT } from './editor-drop-target.js';

export interface IPinnedTabItem {
	readonly input: EditorInput;
	readonly active?: boolean;
	readonly icon?: string;
}

export class PinnedTabs extends Disposable {
	private readonly _pinnedKeys = new Set<string>();
	private readonly _pinnedInputs = new Map<string, EditorInput>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	isPinned(input: EditorInput): boolean {
		return this._pinnedKeys.has(input.toKey());
	}

	pin(input: EditorInput): void {
		if (this._pinnedKeys.has(input.toKey())) {
			return;
		}
		this._pinnedKeys.add(input.toKey());
		this._pinnedInputs.set(input.toKey(), input);
		this._onDidChange.fire();
	}

	unpin(input: EditorInput): void {
		if (!this._pinnedKeys.delete(input.toKey())) {
			return;
		}
		this._pinnedInputs.delete(input.toKey());
		this._onDidChange.fire();
	}

	togglePin(input: EditorInput): void {
		if (this.isPinned(input)) {
			this.unpin(input);
		} else {
			this.pin(input);
		}
	}

	getPinnedInputs(): EditorInput[] {
		return Array.from(this._pinnedInputs.values());
	}

	getPinnedKeys(): string[] {
		return Array.from(this._pinnedKeys);
	}

	get pinnedCount(): number {
		return this._pinnedKeys.size;
	}

	clear(): void {
		if (this._pinnedKeys.size === 0) {
			return;
		}
		this._pinnedKeys.clear();
		this._pinnedInputs.clear();
		this._onDidChange.fire();
	}

	dispose(): void {
		this.clear();
		super.dispose();
	}
}

export class PinnedTabsRenderer extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _tabs = new Map<string, HTMLElement>();
	private _activeKey: string | null = null;

	private readonly _onDidSelectTab = this._register(new Emitter<EditorInput>());
	private readonly _onDidUnpinTab = this._register(new Emitter<EditorInput>());
	private readonly _onDidBeginTabDrag = this._register(new Emitter<EditorInput>());
	private readonly _onDidEndTabDrag = this._register(new Emitter<EditorInput>());

	readonly onDidSelectTab: Event<EditorInput> = this._onDidSelectTab.event;
	readonly onDidUnpinTab: Event<EditorInput> = this._onDidUnpinTab.event;
	readonly onDidBeginTabDrag: Event<EditorInput> = this._onDidBeginTabDrag.event;
	readonly onDidEndTabDrag: Event<EditorInput> = this._onDidEndTabDrag.event;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-pinned-tabs');
		this._container.style.cssText = 'display:flex;align-items:stretch;flex-shrink:0;border-right:1px solid #1e1e1e;';
		this._container.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();
			this._container.scrollLeft += e.deltaY;
		}, { passive: false });
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get count(): number {
		return this._tabs.size;
	}

	render(inputs: EditorInput[], activeKey: string | null, getIcon?: (input: EditorInput) => string): void {
		const nextKeys = new Set(inputs.map(i => i.toKey()));
		for (const [key, tab] of this._tabs) {
			if (!nextKeys.has(key)) {
				tab.remove();
				this._tabs.delete(key);
			}
		}
		this._activeKey = activeKey;
		for (const input of inputs) {
			const key = input.toKey();
			let tab = this._tabs.get(key);
			if (!tab) {
				tab = this._createTab(input, getIcon);
				this._tabs.set(key, tab);
				this._container.appendChild(tab);
			}
			this._applyState(tab, input, getIcon);
		}
	}

	setActive(activeKey: string | null): void {
		this._activeKey = activeKey;
		for (const [key, tab] of this._tabs) {
			tab.style.opacity = key === activeKey ? '1' : '0.75';
			tab.style.background = key === activeKey ? '#1e1e1e' : 'transparent';
		}
	}

	clear(): void {
		clearNode(this._container);
		this._tabs.clear();
		this._activeKey = null;
	}

	private _createTab(input: EditorInput, getIcon?: (input: EditorInput) => string): HTMLElement {
		const tab = $<HTMLElement>('div', 'dc-pinned-tab');
		tab.draggable = true;
		tab.title = `${input.getLabel()} (pinned)`;
		tab.style.cssText = 'display:flex;align-items:center;gap:5px;padding:0 6px;font-size:12px;color:#969696;cursor:pointer;border-right:1px solid #1e1e1e;user-select:none;white-space:nowrap;';
		tab.addEventListener('click', () => this._onDidSelectTab.fire(input));
		tab.addEventListener('auxclick', (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				this._onDidUnpinTab.fire(input);
			}
		});
		tab.addEventListener('dblclick', () => this._onDidUnpinTab.fire(input));
		tab.addEventListener('dragstart', (e: DragEvent) => {
			e.dataTransfer?.setData(DROP_DATA_FORMAT, input.toKey());
			e.dataTransfer!.effectAllowed = 'move';
			tab.style.opacity = '0.5';
			this._onDidBeginTabDrag.fire(input);
		});
		tab.addEventListener('dragend', () => {
			tab.style.opacity = '1';
			this._onDidEndTabDrag.fire(input);
		});
		return tab;
	}

	private _applyState(tab: HTMLElement, input: EditorInput, getIcon?: (input: EditorInput) => string): void {
		tab.textContent = '';
		const icon = $<HTMLElement>('span', 'dc-pinned-tab-icon');
		icon.textContent = getIcon?.(input) ?? input.getName().charAt(0).toUpperCase();
		icon.style.cssText = 'font-size:12px;flex-shrink:0;';
		const label = $<HTMLElement>('span', 'dc-pinned-tab-label');
		label.textContent = input.getName();
		label.style.cssText = 'max-width:70px;overflow:hidden;text-overflow:ellipsis;';
		tab.appendChild(icon);
		tab.appendChild(label);
		this.setActive(this._activeKey);
	}

	dispose(): void {
		this.clear();
		this._container.remove();
		super.dispose();
	}
}
