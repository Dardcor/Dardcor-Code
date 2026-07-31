/**
 * Dardcor Code - Git Submodules Repository Locator and Launcher
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';
import { GitService } from './git-service.js';
import { Path } from '../../core/types/path.js';

declare const require: any;

const SUBMODULE_STYLE_ID = 'dc-git-submodule-styles';

export interface ISubmoduleEntry {
	readonly path: string;
	readonly url: string;
	readonly branch?: string;
}

export interface ISubmoduleStatus extends ISubmoduleEntry {
	readonly status: 'clean' | 'dirty' | 'uninitialized' | 'conflicted';
	readonly commit: string | undefined;
}

export class GitSubmodule extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidOpen = this._register(new Emitter<string>());
	readonly onDidOpen: Event<string> = this._onDidOpen.event;

	private readonly _git: GitService;
	private readonly _rootPath: string;
	private _submodules: ISubmoduleStatus[] = [];

	constructor(git: GitService, rootPath: string) {
		super();
		this._git = git;
		this._rootPath = rootPath;
	}

	get submodules(): ISubmoduleStatus[] {
		return [...this._submodules];
	}

	get count(): number {
		return this._submodules.length;
	}

	public async refresh(): Promise<void> {
		this._submodules = [];
		try {
			const entries = await GitSubmodule.parseGitmodules(this._rootPath);
			const statuses = await this._readStatuses(entries);
			this._submodules = statuses;
		} catch {
			this._submodules = [];
		}
		this._onDidChange.fire();
	}

	public openSubmodule(path: string): void {
		const submodule = this._submodules.find(s => s.path === path);
		if (submodule) {
			this._onDidOpen.fire(Path.join(this._rootPath, submodule.path));
		}
	}

	public async updateAll(init = true): Promise<void> {
		const args = ['submodule', 'update', '--init', '--recursive'];
		if (!init) {
			args.splice(2, 1);
		}
		const result = await this._git.run(args, this._rootPath);
		if (result.exitCode === 0) {
			await this.refresh();
		}
	}

	public render(container: HTMLElement): void {
		CssInjector.inject(SUBMODULE_STYLE_ID, `
			.dc-submodule-row { display: flex; align-items: center; gap: 8px; padding: 5px 10px; cursor: pointer; user-select: none; font-size: 13px; }
			.dc-submodule-row:hover { background: #2a2d2e; }
		`);
		clearNode(container);

		if (this._submodules.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada submodule di repository ini.';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			container.appendChild(empty);
			return;
		}

		for (const submodule of this._submodules) {
			const row = $<HTMLElement>('div', 'dc-submodule-row');
			row.addEventListener('click', () => this.openSubmodule(submodule.path));
			row.title = `${submodule.path}\n${submodule.url}`;

			const icon = $<HTMLElement>('span');
			icon.textContent = '\u2B24';
			icon.style.cssText = `font-size:8px;color:${GitSubmodule.statusColor(submodule.status)};`;

			const body = $<HTMLElement>('div');
			body.style.cssText = 'flex:1;min-width:0;';

			const name = $<HTMLElement>('div');
			name.textContent = submodule.path;
			name.style.cssText = 'font-size:13px;color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			const detail = $<HTMLElement>('div');
			detail.textContent = `${submodule.status} \u00B7 ${submodule.url}`;
			detail.style.cssText = 'font-size:11px;color:#8a8a8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			body.appendChild(name);
			body.appendChild(detail);
			row.appendChild(icon);
			row.appendChild(body);
			container.appendChild(row);
		}
	}

	public static async parseGitmodules(rootPath: string): Promise<ISubmoduleEntry[]> {
		const fs = require('node:fs/promises');
		const pathModule = require('node:path');
		const gitmodulesPath = pathModule.join(rootPath, '.gitmodules');
		let content: string;
		try {
			content = await fs.readFile(gitmodulesPath, 'utf8');
		} catch {
			return [];
		}
		const entries: ISubmoduleEntry[] = [];
		let current: { path?: string; url?: string; branch?: string } | undefined;
		for (const rawLine of content.split(/\r?\n/)) {

			const line = rawLine.trim();
			if (/^\[submodule\s+"/.test(line)) {
				if (current?.path && current.url) {
					entries.push(current as ISubmoduleEntry);
				}
				current = {};
				const match = /^\[submodule\s+"([^"]+)"\]/.exec(line);
				if (match) {
					current.path = match[1];
				}
				continue;
			}
			if (!current) {
				continue;
			}
			const pathMatch = /^path\s*=\s*(.+)$/.exec(line);
			if (pathMatch) {
				current.path = pathMatch[1].trim();
			}
			const urlMatch = /^url\s*=\s*(.+)$/.exec(line);
			if (urlMatch) {
				current.url = urlMatch[1].trim();
			}
			const branchMatch = /^branch\s*=\s*(.+)$/.exec(line);
			if (branchMatch) {
				current.branch = branchMatch[1].trim();
			}
		}
		if (current?.path && current.url) {
			entries.push(current as ISubmoduleEntry);
		}
		return entries;
	}

	private async _readStatuses(entries: ISubmoduleEntry[]): Promise<ISubmoduleStatus[]> {
		if (entries.length === 0) {
			return [];
		}
		const result = await this._git.run(['submodule', 'status', '--recursive'], this._rootPath);
		const statusMap = new Map<string, { status: ISubmoduleStatus['status']; commit: string | undefined }>();
		if (result.exitCode === 0) {
			for (const line of result.stdout.split(/\r?\n/)) {
				const match = /^([+-U ])([0-9a-f]{7,40})\s+([^\s(]+)/.exec(line);
				if (!match) {
					continue;
				}
				const status: ISubmoduleStatus['status'] = match[1] === '-' ? 'uninitialized' : match[1] === 'U' ? 'conflicted' : 'dirty';
				const clean = status === 'dirty';
				statusMap.set(match[3], { status: clean ? 'clean' : status, commit: match[2] });
			}
		}
		return entries.map(entry => {
			const info = statusMap.get(entry.path);
			return {
				...entry,
				status: info?.status ?? 'uninitialized',
				commit: info?.commit
			};
		});
	}

	public static statusColor(status: ISubmoduleStatus['status']): string {
		switch (status) {
			case 'clean': return '#23d18b';
			case 'dirty': return '#e5e510';
			case 'conflicted': return '#f14c4c';
			default: return '#8a8a8a';
		}
	}
}
