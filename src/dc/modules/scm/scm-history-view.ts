/**
 * Dardcor Code - Repository Commit Timeline History View
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';
import { DateFormatter } from '../../core/formatting/date-formatter.js';
import { GitService, IGitLogEntry } from '../scm/git-service.js';

const SCM_HISTORY_STYLE_ID = 'dc-scm-history-styles';

export interface IScmHistoryEntry {
	readonly hash: string;
	readonly message: string;
	readonly author: string;
	readonly date: number;
	readonly refs: string[];
	readonly parents: string[];
}

export class ScmHistoryView extends Disposable {
	private readonly _onDidSelectEntry = this._register(new Emitter<IScmHistoryEntry>());
	readonly onDidSelectEntry: Event<IScmHistoryEntry> = this._onDidSelectEntry.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _container: HTMLElement;
	private readonly _listContainer: HTMLElement;
	private readonly _statusLabel: HTMLElement;
	private readonly _git: GitService;
	private _rootPath: string;
	private _entries: IScmHistoryEntry[] = [];
	private _filter = '';
	private _limit = 50;
	private _loading = false;

	constructor(parentDom: HTMLElement, git: GitService, rootPath: string) {
		super();
		this._git = git;
		this._rootPath = rootPath;

		CssInjector.inject(SCM_HISTORY_STYLE_ID, `
			.dc-scm-history-row { display:flex; flex-direction:column; gap:2px; padding:5px 10px; border-left:2px solid transparent; cursor:pointer; user-select:none; }
			.dc-scm-history-row:hover { background:#2a2d2e; }
			.dc-scm-history-row.selected { background:#094771; border-left-color:#007fd4; }
		`);

		this._container = $<HTMLElement>('div', 'dc-scm-history-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';

		const header = $<HTMLElement>('div');
		header.style.cssText = 'padding:8px 10px;border-bottom:1px solid #2a2d2e;';

		const title = $<HTMLElement>('div');
		title.textContent = 'RIWAYAT KOMIT';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;margin-bottom:6px;';

		const filterInput = $<HTMLInputElement>('input');
		filterInput.placeholder = 'Filter pesan komit\u2026';
		filterInput.style.cssText = 'background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:12px;padding:4px 8px;width:100%;box-sizing:border-box;outline:none;';
		this._register(addDisposableListener(filterInput, 'input', () => {
			this._filter = filterInput.value.toLowerCase();
			this.render();
		}));

		header.appendChild(title);
		header.appendChild(filterInput);
		this._container.appendChild(header);

		this._listContainer = $<HTMLElement>('div');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);

		this._statusLabel = $<HTMLElement>('div');
		this._statusLabel.style.cssText = 'padding:4px 10px;color:#8a8a8a;font-size:11px;border-top:1px solid #2a2d2e;';
		this._container.appendChild(this._statusLabel);
		parentDom.appendChild(this._container);

		this._register(this._git.onDidError(() => {
			void this.refresh();
		}));
	}

	public async refresh(): Promise<void> {
		if (this._loading) {
			return;
		}
		this._loading = true;
		this._statusLabel.textContent = 'Memuat riwayat\u2026';
		try {
			const log = await this._git.log(this._rootPath, this._limit);
			this._entries = log.map(entry => this._toEntry(entry));
			this.render();
			this._statusLabel.textContent = `${this._entries.length} komit`;
		} catch (err) {
			this._statusLabel.textContent = `Gagal memuat riwayat: ${String(err)}`;
		} finally {
			this._loading = false;
		}
	}

	public get entries(): IScmHistoryEntry[] {
		return [...this._entries];
	}

	public getEntry(hash: string): IScmHistoryEntry | undefined {
		return this._entries.find(e => e.hash === hash);
	}

	public setLimit(limit: number): void {
		this._limit = limit;
		void this.refresh();
	}

	public render(): void {
		clearNode(this._listContainer);
		const filtered = this._filter
			? this._entries.filter(e => e.message.toLowerCase().includes(this._filter) || e.author.toLowerCase().includes(this._filter))
			: this._entries;
		for (const entry of filtered) {
			this._renderEntry(entry);
		}
	}

	private _renderEntry(entry: IScmHistoryEntry): void {
		const row = $<HTMLElement>('div', 'dc-scm-history-row');

		const line1 = $<HTMLElement>('div');
		line1.style.cssText = 'display:flex;align-items:center;gap:6px;';

		const dot = $<HTMLElement>('span');
		dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#4ec9b0;flex-shrink:0;';

		const message = $<HTMLElement>('span');
		message.textContent = entry.message;
		message.style.cssText = 'font-size:13px;color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
		message.title = `${entry.message}\n${entry.hash}`;

		line1.appendChild(dot);
		line1.appendChild(message);
		row.appendChild(line1);

		const line2 = $<HTMLElement>('div');
		line2.style.cssText = 'display:flex;align-items:center;gap:6px;padding-left:14px;';

		const meta = $<HTMLElement>('span');
		meta.textContent = `${entry.author} \u00B7 ${DateFormatter.formatRelative(entry.date)} \u00B7 ${entry.hash.slice(0, 7)}`;
		meta.style.cssText = 'font-size:11px;color:#8a8a8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';

		line2.appendChild(meta);

		if (entry.refs.length > 0) {
			const refs = $<HTMLElement>('span');
			refs.textContent = entry.refs.join(' ');
			refs.style.cssText = 'font-size:10px;color:#dcdcaa;';
			line2.appendChild(refs);
		}
		row.appendChild(line2);

		this._register(addDisposableListener(row, 'click', () => {
			for (const sel of Array.from(this._listContainer.querySelectorAll('.dc-scm-history-row.selected'))) {
				sel.classList.remove('selected');
			}
			row.classList.add('selected');
			this._onDidSelectEntry.fire(entry);
		}));
		this._listContainer.appendChild(row);
	}

	private _toEntry(log: IGitLogEntry): IScmHistoryEntry {
		return {
			hash: log.hash,
			message: log.message,
			author: log.author,
			date: Date.parse(log.date),
			refs: [],
			parents: []
		};
	}
}
