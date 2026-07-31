/**
 * Dardcor Code - Open Editors Section Inside Explorer Sidebar
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { FileIcons } from './file-icons.js';

export interface IOpenEditorEntry {
	readonly resource: URI;
	readonly dirty: boolean;
	readonly active: boolean;
}

export class OpenEditorsView extends Disposable {
	private readonly _onDidSelect = this._register(new Emitter<URI>());
	readonly onDidSelect: Event<URI> = this._onDidSelect.event;

	private readonly _onDidClose = this._register(new Emitter<URI>());
	readonly onDidClose: Event<URI> = this._onDidClose.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _container: HTMLElement;
	private readonly _listContainer: HTMLElement;
	private readonly _titleLabel: HTMLElement;
	private readonly _entries: IOpenEditorEntry[] = [];
	private _collapsed = false;

	constructor(parentDom: HTMLElement, entries: IOpenEditorEntry[] = []) {
		super();
		this._entries.push(...entries);

		this._container = $<HTMLElement>('div', 'dc-open-editors-view');

		const header = $<HTMLElement>('div');
		header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px 4px;cursor:pointer;user-select:none;';
		this._register(addDisposableListener(header, 'click', () => {
			this._collapsed = !this._collapsed;
			this.render();
		}));

		this._titleLabel = $<HTMLElement>('span');
		this._titleLabel.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#bbbbbb;flex:1;';

		const closeAll = $<HTMLButtonElement>('button');
		closeAll.textContent = '\u2716';
		closeAll.title = 'Tutup Semua Editor';
		closeAll.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:11px;';
		this._register(addDisposableListener(closeAll, 'click', (e: MouseEvent) => {
			e.stopPropagation();
			this.closeAll();
		}));

		header.appendChild(this._titleLabel);
		header.appendChild(closeAll);
		this._container.appendChild(header);

		this._listContainer = $<HTMLElement>('div', 'dc-open-editors-list');
		this._container.appendChild(this._listContainer);
		parentDom.appendChild(this._container);
		this.render();
	}

	get entries(): IOpenEditorEntry[] {
		return [...this._entries];
	}

	public has(resource: URI): boolean {
		return this._entries.some(e => e.resource.toString() === resource.toString());
	}

	public add(resource: URI, dirty = false, active = false): void {
		if (this.has(resource)) {
			this.setActive(resource);
			this.markDirty(resource, dirty);
			return;
		}
		this._entries.push({ resource, dirty, active });
		this._onDidChange.fire();
		this.render();
	}

	public remove(resource: URI): void {
		const idx = this._entries.findIndex(e => e.resource.toString() === resource.toString());
		if (idx !== -1) {
			this._entries.splice(idx, 1);
			this._onDidChange.fire();
			this._onDidClose.fire(resource);
			this.render();
		}
	}

	public setActive(resource: URI): void {
		let changed = false;
		for (const entry of this._entries) {
			const next = entry.resource.toString() === resource.toString();
			if (entry.active !== next) {
				(entry as { active: boolean }).active = next;
				changed = true;
			}
		}
		if (changed) {
			this.render();
		}
	}

	public markDirty(resource: URI, dirty: boolean): void {
		const entry = this._entries.find(e => e.resource.toString() === resource.toString());
		if (entry && entry.dirty !== dirty) {
			(entry as { dirty: boolean }).dirty = dirty;
			this.render();
		}
	}

	public clear(): void {
		this._entries.splice(0, this._entries.length);
		this._onDidChange.fire();
		this.render();
	}

	public closeAll(): void {
		for (const entry of [...this._entries]) {
			this.remove(entry.resource);
		}
	}

	public render(): void {
		this._titleLabel.textContent = `${this._collapsed ? '\u25B8' : '\u25BE'} OPEN EDITORS (${this._entries.length})`;
		clearNode(this._listContainer);
		if (this._collapsed) {
			return;
		}
		if (this._entries.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada editor terbuka';
			empty.style.cssText = 'padding:2px 12px 6px;color:#8a8a8a;font-size:12px;';
			this._listContainer.appendChild(empty);
			return;
		}
		for (const entry of this._entries) {
			this._renderEntry(entry);
		}
	}

	private _renderEntry(entry: IOpenEditorEntry): void {
		const row = $<HTMLElement>('div', 'dc-open-editor-row');
		row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 8px 2px 10px;cursor:pointer;user-select:none;';
		row.style.background = entry.active ? '#37373d' : 'transparent';
		row.addEventListener('mouseenter', () => {
			if (!entry.active) {
				row.style.background = '#2a2d2e';
			}
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = entry.active ? '#37373d' : 'transparent';
		});
		this._register(addDisposableListener(row, 'click', () => {
			this._onDidSelect.fire(entry.resource);
			this.setActive(entry.resource);
		}));

		const icon = $<HTMLElement>('span');
		icon.innerHTML = FileIcons.getIconHtml(Path.basename(entry.resource.path), false);

		const name = $<HTMLElement>('span');
		name.textContent = `${entry.dirty ? '\u25CF ' : ''}${Path.basename(entry.resource.path)}`;
		name.style.cssText = 'font-size:13px;color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
		name.title = entry.resource.path;

		const close = $<HTMLButtonElement>('button');
		close.textContent = '\u2716';
		close.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:10px;visibility:hidden;';
		row.addEventListener('mouseenter', () => {
			close.style.visibility = 'visible';
		});
		row.addEventListener('mouseleave', () => {
			close.style.visibility = 'hidden';
		});
		this._register(addDisposableListener(close, 'click', (e: MouseEvent) => {
			e.stopPropagation();
			this.remove(entry.resource);
		}));

		row.appendChild(icon);
		row.appendChild(name);
		row.appendChild(close);
		this._listContainer.appendChild(row);
	}
}
