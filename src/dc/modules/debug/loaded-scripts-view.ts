/**
 * Dardcor Code - Debug Process Loaded Scripts Tree View Pane
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { Path } from '../../core/types/path';

export interface ILoadedScript {
	readonly id: string;
	readonly name: string;
	readonly path?: string;
	readonly kind: 'user' | 'library' | 'builtin';
}

export interface ILoadedScriptsSource {
	load(): Promise<ILoadedScript[]>;
}

export class StaticLoadedScriptsSource implements ILoadedScriptsSource {
	constructor(private readonly _scripts: ILoadedScript[]) {}

	public async load(): Promise<ILoadedScript[]> {
		return [...this._scripts];
	}
}

export class LoadedScriptsView extends Disposable {
	private readonly _onDidSelectScript = this._register(new Emitter<ILoadedScript>());
	readonly onDidSelectScript: Event<ILoadedScript> = this._onDidSelectScript.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _container: HTMLElement;
	private readonly _listContainer: HTMLElement;
	private readonly _summaryLabel: HTMLElement;
	private readonly _source: ILoadedScriptsSource;
	private _scripts: ILoadedScript[] = [];
	private _expanded = new Set<string>();

	constructor(parentDom: HTMLElement, source?: ILoadedScriptsSource) {
		super();
		this._source = source ?? new StaticLoadedScriptsSource([]);

		this._container = $<HTMLElement>('div', 'dc-loaded-scripts-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		const header = $<HTMLElement>('div');
		header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #2a2d2e;';

		const title = $<HTMLElement>('span');
		title.textContent = 'LOADED SCRIPTS';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;text-transform:uppercase;flex:1;';

		const refresh = $<HTMLButtonElement>('button');
		refresh.textContent = '\u21BB';
		refresh.title = 'Refresh Loaded Scripts';
		refresh.style.cssText = 'background:transparent;border:none;color:#cccccc;cursor:pointer;font-size:13px;';
		refresh.addEventListener('click', () => {
			void this.refresh();
		});

		header.appendChild(title);
		header.appendChild(refresh);
		this._container.appendChild(header);

		this._summaryLabel = $<HTMLElement>('div');
		this._summaryLabel.style.cssText = 'padding:4px 12px;font-size:11px;color:#8a8a8a;border-bottom:1px solid #2a2d2e;';
		this._container.appendChild(this._summaryLabel);

		this._listContainer = $<HTMLElement>('div');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);
		parentDom.appendChild(this._container);

		void this.refresh();
	}

	public async refresh(): Promise<void> {
		try {
			this._scripts = await this._source.load();
		} catch {
			this._scripts = [];
		}
		this._onDidChange.fire();
		this.render();
	}

	public setScripts(scripts: ILoadedScript[]): void {
		this._scripts = [...scripts];
		this._onDidChange.fire();
		this.render();
	}

	get scripts(): ILoadedScript[] {
		return [...this._scripts];
	}

	public render(): void {
		clearNode(this._listContainer);
		const userCount = this._scripts.filter(s => s.kind === 'user').length;
		this._summaryLabel.textContent = `${this._scripts.length} script \u00B7 ${userCount} milik pengguna`;

		if (this._scripts.length === 0) {
			const empty = $('div');
			empty.textContent = 'Belum ada script yang dimuat.';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			this._listContainer.appendChild(empty);
			return;
		}

		const groups = new Map<string, ILoadedScript[]>();
		for (const script of this._scripts) {
			const group = script.kind === 'user' ? 'User Scripts' : script.kind === 'library' ? 'Libraries' : 'Built-in';
			let list = groups.get(group);
			if (!list) {
				list = [];
				groups.set(group, list);
			}
			list.push(script);
		}

		for (const [groupName, scripts] of groups) {
			const key = `group:${groupName}`;
			const expanded = this._expanded.has(key);

			const groupRow = $<HTMLElement>('div');
			groupRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;font-size:12px;font-weight:600;color:#bbbbbb;user-select:none;';
			groupRow.addEventListener('click', () => {
				if (this._expanded.has(key)) {
					this._expanded.delete(key);
				} else {
					this._expanded.add(key);
				}
				this.render();
			});

			const chevron = $<HTMLElement>('span');
			chevron.textContent = expanded ? '\u25BE' : '\u25B8';
			chevron.style.cssText = 'font-size:9px;width:12px;';

			const label = $<HTMLElement>('span');
			label.textContent = groupName;

			const count = $<HTMLElement>('span');
			count.textContent = String(scripts.length);
			count.style.cssText = 'margin-left:auto;font-size:11px;color:#8a8a8a;';

			groupRow.appendChild(chevron);
			groupRow.appendChild(label);
			groupRow.appendChild(count);
			this._listContainer.appendChild(groupRow);

			if (expanded) {
				for (const script of scripts.sort((a, b) => a.name.localeCompare(b.name))) {
					this._renderScriptRow(script);
				}
			}
		}
	}

	private _renderScriptRow(script: ILoadedScript): void {
		const row = $<HTMLElement>('div');
		row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 8px 2px 24px;cursor:pointer;font-size:12px;color:#cccccc;user-select:none;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});
		row.addEventListener('click', () => this._onDidSelectScript.fire(script));

		const icon = $<HTMLElement>('span');
		icon.textContent = script.kind === 'user' ? '\uD83D\uDCC4' : '\u2699';
		icon.style.cssText = 'font-size:11px;width:14px;text-align:center;';

		const name = $<HTMLElement>('span');
		name.textContent = Path.basename(script.path ?? script.name);
		name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		name.title = script.path ?? script.name;

		row.appendChild(icon);
		row.appendChild(name);
		this._listContainer.appendChild(row);
	}
}
