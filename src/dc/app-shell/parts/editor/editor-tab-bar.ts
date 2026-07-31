/**
 * Dardcor Code - Draggable File Tab Bar With Close Icons
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $, clearNode } from '../../../core/dom/element.js';
import { EditorInput } from './editor-input.js';
import { Path } from '../../../core/types/path.js';
import { DROP_DATA_FORMAT } from './editor-drop-target.js';

const FILE_ICONS: Record<string, string> = {
	'.ts': '\u{1F4D8}',
	'.tsx': '\u{1F4D8}',
	'.js': '\u{1F7E1}',
	'.jsx': '\u{1F7E1}',
	'.json': '\u{1F4E6}',
	'.html': '\u{1F5C4}',
	'.css': '\u{1F3A8}',
	'.md': '\u{1F4C4}',
	'.py': '\u{1F40D}',
	'.cpp': '\u{1F4DB}',
	'.c': '\u{1F4DB}',
	'.rs': '\u{1F49C}',
	'.go': '\u{1F433}',
	'.png': '\u{1F5BC}',
	'.jpg': '\u{1F5BC}',
	'.svg': '\u{1F5BC}',
};

function getFileIcon(input: EditorInput): string {
	const ext = Path.extname(input.uri.path).toLowerCase();
	return FILE_ICONS[ext] ?? '\u{1F4C4}';
}

export class EditorTabBar extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _tabs = new Map<string, HTMLElement>();
	private _activeKey: string | null = null;

	private readonly _onDidSelectTab = this._register(new Emitter<EditorInput>());
	private readonly _onDidCloseTab = this._register(new Emitter<EditorInput>());
	private readonly _onDidBeginTabDrag = this._register(new Emitter<EditorInput>());
	private readonly _onDidEndTabDrag = this._register(new Emitter<EditorInput>());

	readonly onDidSelectTab: Event<EditorInput> = this._onDidSelectTab.event;
	readonly onDidCloseTab: Event<EditorInput> = this._onDidCloseTab.event;
	readonly onDidBeginTabDrag: Event<EditorInput> = this._onDidBeginTabDrag.event;
	readonly onDidEndTabDrag: Event<EditorInput> = this._onDidEndTabDrag.event;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-tab-bar');
		this._container.style.cssText = 'height:35px;background:#252526;display:flex;align-items:stretch;overflow:hidden;flex-shrink:0;border-bottom:1px solid #1e1e1e;user-select:none;';
		parent.appendChild(this._container);
		this._container.addEventListener('wheel', (e: WheelEvent) => {
			if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
				e.preventDefault();
				this._container.scrollLeft += e.deltaY;
			}
		}, { passive: false });
	}

	get element(): HTMLElement {
		return this._container;
	}

	getTabCount(): number {
		return this._tabs.size;
	}

	openTab(input: EditorInput): void {
		if (this._tabs.has(input.toKey())) {
			this.setActive(input);
			return;
		}
		const tab = this._createTab(input);
		this._tabs.set(input.toKey(), tab);
		this._container.appendChild(tab);
	}

	closeTab(input: EditorInput): void {
		const tab = this._tabs.get(input.toKey());
		if (!tab) {
			return;
		}
		tab.remove();
		this._tabs.delete(input.toKey());
		if (this._activeKey === input.toKey()) {
			this._activeKey = null;
		}
	}

	setActive(input: EditorInput): void {
		this._activeKey = input.toKey();
		for (const [key, tab] of this._tabs) {
			tab.classList.toggle('dc-tab-active', key === this._activeKey);
			tab.style.background = key === this._activeKey ? '#1e1e1e' : 'transparent';
			tab.style.color = key === this._activeKey ? '#ffffff' : '#969696';
		}
	}

	setDirty(input: EditorInput, dirty: boolean): void {
		const tab = this._tabs.get(input.toKey());
		if (!tab) {
			return;
		}
		tab.classList.toggle('dc-tab-dirty', dirty);
		const closeBtn = tab.querySelector('.dc-tab-close') as HTMLElement | null;
		if (closeBtn) {
			closeBtn.textContent = dirty ? '\u25cf' : '\u2715';
			closeBtn.style.color = dirty ? '#ffffff' : '#858585';
		}
	}

	clear(): void {
		clearNode(this._container);
		this._tabs.clear();
		this._activeKey = null;
	}

	private _createTab(input: EditorInput): HTMLElement {
		const tab = $<HTMLElement>('div', 'dc-tab');
		tab.draggable = true;
		tab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 8px;font-size:12px;font-family:Segoe UI, sans-serif;cursor:pointer;border-right:1px solid #1e1e1e;white-space:nowrap;color:#969696;';
		tab.title = input.getLabel();

		const icon = $<HTMLElement>('span', 'dc-tab-icon');
		icon.textContent = getFileIcon(input);
		icon.style.cssText = 'font-size:13px;flex-shrink:0;';

		const label = $<HTMLElement>('span', 'dc-tab-label');
		label.textContent = input.getName();
		label.style.cssText = 'max-width:180px;overflow:hidden;text-overflow:ellipsis;';

		const closeBtn = $<HTMLElement>('span', 'dc-tab-close');
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'font-size:10px;color:#858585;padding:2px;border-radius:3px;flex-shrink:0;margin-left:2px;';
		closeBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			this._onDidCloseTab.fire(input);
		});

		tab.appendChild(icon);
		tab.appendChild(label);
		tab.appendChild(closeBtn);

		tab.addEventListener('click', () => this._onDidSelectTab.fire(input));
		tab.addEventListener('auxclick', (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				this._onDidCloseTab.fire(input);
			}
		});
		tab.addEventListener('dragstart', (e: DragEvent) => {
			e.dataTransfer?.setData(DROP_DATA_FORMAT, input.toKey());
			e.dataTransfer?.setData('text/plain', input.getName());
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

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
