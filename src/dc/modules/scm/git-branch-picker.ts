/**
 * Dardcor Code - Git Branch Switch & Create Picker
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { GitService } from './git-service';

const BRANCH_PICKER_STYLE_ID = 'dc-git-branch-picker-styles';

export interface IBranchInfo {
	readonly name: string;
	readonly isCurrent: boolean;
	readonly isRemote: boolean;
	readonly upstream: string | undefined;
	readonly commitHash: string | undefined;
	readonly isLocal: boolean;
	readonly isDetached: boolean;
}

export class GitBranchPicker extends Disposable {
	private readonly _onDidSelect = this._register(new Emitter<IBranchInfo>());
	readonly onDidSelect: Event<IBranchInfo> = this._onDidSelect.event;

	private readonly _onDidCreate = this._register(new Emitter<{ name: string; basedOn: string | undefined }>());
	readonly onDidCreate: Event<{ name: string; basedOn: string | undefined }> = this._onDidCreate.event;

	private readonly _overlay: HTMLElement;
	private readonly _panel: HTMLElement;
	private readonly _input: HTMLInputElement;
	private readonly _list: HTMLElement;
	private readonly _git: GitService;
	private _rootPath: string;
	private _branches: IBranchInfo[] = [];
	private _filter = '';

	constructor(git: GitService, rootPath: string) {
		super();
		this._git = git;
		this._rootPath = rootPath;

		CssInjector.inject(BRANCH_PICKER_STYLE_ID, `
			.dc-branch-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:1000; display:flex; align-items:flex-start; justify-content:center; }
			.dc-branch-panel { margin-top:80px; background:#252526; border:1px solid #3c3c3c; border-radius:4px; width:460px; max-height:420px; display:flex; flex-direction:column; box-shadow:0 4px 20px rgba(0,0,0,0.4); }
			.dc-branch-row { display:flex; align-items:center; gap:8px; padding:6px 12px; cursor:pointer; user-select:none; }
			.dc-branch-row:hover { background:#2a2d2e; }
			.dc-branch-row.current { background:#094771; }
		`);

		this._overlay = $<HTMLElement>('div', 'dc-branch-overlay');
		this._panel = $<HTMLElement>('div', 'dc-branch-panel');

		const title = $<HTMLElement>('div');
		title.textContent = 'Ganti Cabang';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;padding:10px 12px 6px;';

		this._input = $<HTMLInputElement>('input');
		this._input.placeholder = 'Cari atau buat cabang\u2026';
		this._input.style.cssText = 'background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:13px;padding:6px 10px;margin:0 12px;outline:none;';

		this._list = $<HTMLElement>('div');
		this._list.style.cssText = 'flex:1;overflow-y:auto;margin-top:8px;';

		this._panel.appendChild(title);
		this._panel.appendChild(this._input);
		this._panel.appendChild(this._list);
		this._overlay.appendChild(this._panel);
		document.body.appendChild(this._overlay);

		this._register(addDisposableListener(this._overlay, 'click', (e: MouseEvent) => {
			if (e.target === this._overlay) {
				this.hide();
			}
		}));
		this._register(addDisposableListener(document, 'keydown', (e) => {
			const ev = e as KeyboardEvent;
			if (ev.key === 'Escape') {
				this.hide();
			}
		}));
		this._register(addDisposableListener(this._input, 'input', () => {
			this._filter = this._input.value.trim();
			this._render();
		}));
		this._register(addDisposableListener(this._input, 'keydown', (e) => {
			const ev = e as KeyboardEvent;
			if (ev.key === 'Enter' && this._input.value.trim()) {
				void this._createBranch(this._input.value.trim());
			}
		}));

		this.hide();
	}

	public async show(): Promise<void> {
		this._overlay.style.display = 'flex';
		this._input.value = '';
		this._filter = '';
		await this.refresh();
		this._input.focus();
	}

	public hide(): void {
		this._overlay.style.display = 'none';
	}

	get isVisible(): boolean {
		return this._overlay.style.display !== 'none';
	}

	get branches(): IBranchInfo[] {
		return [...this._branches];
	}

	public async refresh(): Promise<void> {
		try {
			const currentRaw = await this._git.run(['branch', '--show-current'], this._rootPath);
			const current = currentRaw.stdout.trim();
			const localRaw = await this._git.run(['for-each-ref', '--format=%(refname:short) %(upstream:short)', 'refs/heads'], this._rootPath);
			const local: IBranchInfo[] = localRaw.stdout.split(/\r?\n/)
				.filter(line => !!line.trim())
				.map(line => {
					const [name, upstream] = line.split(' ');
					return {
						name,
						isCurrent: name === current,
						isRemote: false,
						upstream: upstream || undefined,
						commitHash: undefined,
						isLocal: true,
						isDetached: false
					};
				});
			const remoteRaw = await this._git.run(['branch', '-r'], this._rootPath).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
			const remote: IBranchInfo[] = remoteRaw.stdout.split(/\r?\n/)
				.filter(line => !!line.trim())
				.map(line => line.replace(/^\*\s*/, '').trim())
				.filter(name => !name.includes('HEAD'))
				.map(name => ({
					name,
					isCurrent: false,
					isRemote: true,
					upstream: undefined,
					commitHash: undefined,
					isLocal: false,
					isDetached: false
				}));
			this._branches = [...local, ...remote];
		} catch (err) {
			this._branches = [];
			console.warn('Gagal memuat cabang:', err);
		}
		this._render();
	}

	public async checkout(branch: IBranchInfo): Promise<void> {
		try {
			const checkoutName = branch.isRemote ? branch.name.split('/').slice(1).join('/') : branch.name;
			if (branch.isRemote) {
				await this._git.run(['checkout', '-b', checkoutName, branch.name], this._rootPath);
			} else {
				await this._git.run(['checkout', checkoutName], this._rootPath);
			}
			this._onDidSelect.fire(branch);
			this.hide();
		} catch (err) {
			console.error('Gagal checkout:', err);
		}
	}

	public async createBranch(name: string, basedOn?: string): Promise<void> {
		await this._createBranch(name, basedOn);
	}

	private async _createBranch(name: string, basedOn?: string): Promise<void> {
		if (!name) {
			return;
		}
		try {
			const args = ['checkout', '-b', name];
			if (basedOn) {
				args.push(basedOn);
			}
			await this._git.run(args, this._rootPath);
			this._onDidCreate.fire({ name, basedOn });
			this.hide();
			void this.refresh();
		} catch (err) {
			console.error('Gagal membuat cabang:', err);
		}
	}

	private _render(): void {
		clearNode(this._list);
		const filtered = this._filter
			? this._branches.filter(b => b.name.toLowerCase().includes(this._filter.toLowerCase()))
			: this._branches;
		for (const branch of filtered) {
			this._renderBranch(branch);
		}
		if (this._filter && !filtered.some(b => b.name === this._filter)) {
			const createRow = $<HTMLElement>('div', 'dc-branch-row');
			createRow.style.color = '#4ec9b0';
			const label = $<HTMLElement>('span');
			label.textContent = `+ Buat cabang "${this._filter}"`;
			label.style.cssText = 'font-size:13px;';
			createRow.appendChild(label);
			this._register(addDisposableListener(createRow, 'click', () => {
				void this._createBranch(this._filter);
			}));
			this._list.appendChild(createRow);
		}
	}

	private _renderBranch(branch: IBranchInfo): void {
		const row = $<HTMLElement>('div', 'dc-branch-row');
		if (branch.isCurrent) {
			row.classList.add('current');
		}
		const icon = $<HTMLElement>('span');
		icon.textContent = branch.isRemote ? '\u{1F5C2}' : '\u2387';
		icon.style.cssText = `width:16px;text-align:center;color:${branch.isRemote ? '#d7ba7d' : '#4ec9b0'};font-size:12px;`;

		const name = $<HTMLElement>('span');
		name.textContent = branch.name;
		name.style.cssText = 'font-size:13px;color:#cccccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		name.title = branch.upstream ?? branch.name;

		row.appendChild(icon);
		row.appendChild(name);
		if (branch.isCurrent) {
			const currentBadge = $<HTMLElement>('span');
			currentBadge.textContent = 'aktif';
			currentBadge.style.cssText = 'font-size:10px;color:#4ec9b0;';
			row.appendChild(currentBadge);
		}
		this._register(addDisposableListener(row, 'click', () => {
			void this.checkout(branch);
		}));
		this._list.appendChild(row);
	}
}
