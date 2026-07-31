/**
 * Dardcor Code - File Local History & Git Commit Timeline View Component
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode } from '../../core/dom/element.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { DateFormatter } from '../../core/formatting/date-formatter.js';
import { LocalHistoryProvider, ILocalHistoryEntry } from './local-history-provider.js';
import { GitService, IGitLogEntry } from '../scm/git-service.js';

export interface ITimelineItem {
	readonly id: string;
	readonly label: string;
	readonly detail?: string;
	readonly timestamp: number;
	readonly icon: string;
	readonly resource?: URI;
	readonly kind: 'local' | 'git';
}

export class TimelineView extends Disposable {
	private readonly _onDidSelectItem = this._register(new Emitter<ITimelineItem>());
	readonly onDidSelectItem: Event<ITimelineItem> = this._onDidSelectItem.event;

	private readonly _onDidSelectResource = this._register(new Emitter<URI>());
	readonly onDidSelectResource: Event<URI> = this._onDidSelectResource.event;

	private readonly _container: HTMLElement;
	private readonly _listContainer: HTMLElement;
	private readonly _historyProvider: LocalHistoryProvider;
	private readonly _git: GitService | undefined;
	private readonly _rootPath: string;
	private _items: ITimelineItem[] = [];
	private _activeResource: URI | undefined;

	constructor(parentDom: HTMLElement, historyProvider?: LocalHistoryProvider, git?: GitService, rootPath = '') {
		super();
		this._historyProvider = historyProvider ?? new LocalHistoryProvider(rootPath);
		this._git = git;
		this._rootPath = rootPath;

		this._container = $<HTMLElement>('div', 'dc-timeline-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		const header = $<HTMLElement>('div');
		header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #2a2d2e;';
		const title = $<HTMLElement>('span');
		title.textContent = 'TIMELINE';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;text-transform:uppercase;flex:1;';
		const refresh = $<HTMLButtonElement>('button');
		refresh.textContent = '\u21BB';
		refresh.title = 'Refresh Timeline';
		refresh.style.cssText = 'background:transparent;border:none;color:#cccccc;cursor:pointer;font-size:13px;';
		refresh.addEventListener('click', () => {
			void this.refresh();
		});
		header.appendChild(title);
		header.appendChild(refresh);
		this._container.appendChild(header);

		this._listContainer = $<HTMLElement>('div', 'dc-timeline-list');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);
		parentDom.appendChild(this._container);

		this._register(this._historyProvider.onDidChange(() => this.render()));
	}

	get items(): ITimelineItem[] {
		return this._items;
	}

	public async refresh(): Promise<void> {
		await this._collectItems();
		this.render();
	}

	public setActiveResource(resource: URI | undefined): void {
		this._activeResource = resource;
		void this.refresh();
	}

	private async _collectItems(): Promise<void> {
		const items: ITimelineItem[] = [];

		if (this._activeResource) {
			const entries = this._historyProvider.entriesFor(this._activeResource);
			for (const entry of entries) {
				items.push({
					id: entry.id,
					label: entry.label,
					detail: `${entry.size} chars \u00B7 ${this._formatTime(entry.timestamp)}`,
					timestamp: entry.timestamp,
					icon: '\u231B',
					resource: entry.resource,
					kind: 'local'
				});
			}
		}

		if (this._git && this._rootPath) {
			try {
				const commits = await this._git.log(this._rootPath, 50);
				for (const commit of commits) {
					items.push(this._commitToItem(commit));
				}
			} catch {
				// repo git tidak tersedia
			}
		}

		items.sort((a, b) => b.timestamp - a.timestamp);
		this._items = items;
	}

	private _commitToItem(commit: IGitLogEntry): ITimelineItem {
		const timestamp = new Date(commit.date).getTime();
		return {
			id: `git-${commit.hash}`,
			label: commit.message,
			detail: `${commit.hash} \u00B7 ${commit.author} \u00B7 ${this._formatTime(timestamp)}`,
			timestamp,
			icon: '\u25C6',
			kind: 'git'
		};
	}

	private _formatTime(timestamp: number): string {
		return DateFormatter.formatRelative(timestamp);
	}

	public render(): void {
		clearNode(this._listContainer);

		if (this._items.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada entri timeline untuk file ini.';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			this._listContainer.appendChild(empty);
			return;
		}

		for (const item of this._items) {
			const row = $<HTMLElement>('div', 'dc-timeline-item');
			row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:6px 12px;cursor:pointer;user-select:none;border-bottom:1px solid #252526;';
			row.addEventListener('mouseenter', () => {
				row.style.background = '#2a2d2e';
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = 'transparent';
			});
			row.addEventListener('click', () => {
				this._onDidSelectItem.fire(item);
				if (item.resource) {
					this._onDidSelectResource.fire(item.resource);
				}
			});

			const icon = $<HTMLElement>('span');
			icon.textContent = item.icon;
			icon.style.cssText = `font-size:12px;color:${item.kind === 'git' ? '#3794ff' : '#e5e510'};margin-top:1px;`;

			const body = $<HTMLElement>('div');
			body.style.cssText = 'flex:1;min-width:0;';

			const label = $<HTMLElement>('div');
			label.textContent = item.label;
			label.style.cssText = 'font-size:13px;color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			const detail = $<HTMLElement>('div');
			detail.textContent = item.detail ?? '';
			detail.style.cssText = 'font-size:11px;color:#8a8a8a;margin-top:1px;';

			body.appendChild(label);
			body.appendChild(detail);
			row.appendChild(icon);
			row.appendChild(body);
			this._listContainer.appendChild(row);
		}
	}
}

export function isLocalHistoryItem(item: ITimelineItem): item is ITimelineItem & { resource: URI } {
	return item.kind === 'local' && !!item.resource;
}

export function isGitTimelineItem(item: ITimelineItem): boolean {
	return item.kind === 'git';
}

export function timelineItemResource(item: ITimelineItem): URI | undefined {
	return item.resource;
}

export function getTimelineItemBasename(item: ITimelineItem): string {
	return item.resource ? Path.basename(item.resource.path) : '';
}

export function timelineEntryToItem(entry: ILocalHistoryEntry): ITimelineItem {
	return {
		id: entry.id,
		label: entry.label,
		detail: `${entry.size} chars`,
		timestamp: entry.timestamp,
		icon: '\u231B',
		resource: entry.resource,
		kind: 'local'
	};
}
