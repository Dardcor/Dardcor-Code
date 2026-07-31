/**
 * Dardcor Code - Git Interactive Rebase View Controller
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { GitService } from './git-service';

declare const require: any;

const REBASE_STYLE_ID = 'dc-git-rebase-styles';

export type RebaseTodoAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface IRebaseTodoItem {
	readonly hash: string;
	readonly message: string;
	readonly action: RebaseTodoAction;
}

export const REBASE_ACTION_LABELS: Record<RebaseTodoAction, string> = {
	pick: 'Pick',
	reword: 'Reword',
	edit: 'Edit',
	squash: 'Squash',
	fixup: 'Fixup',
	drop: 'Drop'
};

export class GitRebase extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidFinish = this._register(new Emitter<string>());
	readonly onDidFinish: Event<string> = this._onDidFinish.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	private readonly _git: GitService;
	private readonly _rootPath: string;
	private _baseRef = '';
	private _todo: IRebaseTodoItem[] = [];
	private _inProgress = false;

	constructor(git: GitService, rootPath: string) {
		super();
		this._git = git;
		this._rootPath = rootPath;
	}

	get inProgress(): boolean {
		return this._inProgress;
	}

	get baseRef(): string {
		return this._baseRef;
	}

	get todo(): IRebaseTodoItem[] {
		return [...this._todo];
	}

	public get resolvedCount(): number {
		return this._todo.filter(item => item.action === 'drop').length;
	}

	public async load(baseRef: string): Promise<IRebaseTodoItem[]> {
		this._baseRef = baseRef;
		const result = await this._git.run(['log', '--reverse', '--pretty=format:%h|%s', `${baseRef}..HEAD`], this._rootPath);
		this._todo = [];
		if (result.exitCode === 0) {
			for (const line of result.stdout.split(/\r?\n/)) {
				const parts = line.split('|');
				if (parts.length >= 2) {
					this._todo.push({ hash: parts[0], message: parts[1], action: 'pick' });
				}
			}
		}
		this._onDidChange.fire();
		return this.todo;
	}

	public setAction(index: number, action: RebaseTodoAction): void {
		if (index < 0 || index >= this._todo.length) {
			return;
		}
		const item = this._todo[index];
		this._todo[index] = { ...item, action };
		this._onDidChange.fire();
	}

	public async start(): Promise<boolean> {
		if (this._todo.length === 0 || !this._baseRef) {
			return false;
		}
		this._inProgress = true;
		this._onDidChange.fire();

		const todoText = this._todo
			.map(item => `${REBASE_ACTION_LABELS[item.action].toLowerCase()} ${item.hash} ${item.message}`)
			.join('\n');

		try {
			const fs = require('node:fs');
			const os = require('node:os');
			const pathModule = require('node:path');
			const cp = require('node:child_process');

			const tmpDir = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'dc-rebase-'));
			const todoFile = pathModule.join(tmpDir, 'git-rebase-todo');
			const editorFile = pathModule.join(tmpDir, 'sequence-editor.cmd');
			fs.writeFileSync(todoFile, todoText);
			fs.writeFileSync(editorFile, `@copy /Y "${todoFile}" "%1" >nul`);

			const env = { ...process.env, GIT_SEQUENCE_EDITOR: editorFile };
			const exitCode = await new Promise<number>((resolve) => {
				const child = cp.spawn('git', ['rebase', '-i', this._baseRef], { cwd: this._rootPath, env, windowsHide: true });
				child.on('error', () => resolve(-1));
				child.on('close', (code: number) => resolve(code));
			});

			if (exitCode === 0) {
				this._onDidFinish.fire('Rebase selesai.');
				this._inProgress = false;
			} else {
				this._onDidError.fire('Rebase dibutuhkan penyelesaian interaktif. Lanjutkan dengan continue() atau batalkan dengan abort().');
				this._inProgress = false;
			}
			this._onDidChange.fire();
			return exitCode === 0;
		} catch (err) {
			this._inProgress = false;
			this._onDidError.fire(`Gagal memulai rebase: ${String(err)}`);
			this._onDidChange.fire();
			return false;
		}
	}

	public async continue(): Promise<void> {
		const result = await this._git.run(['rebase', '--continue'], this._rootPath);
		if (result.exitCode !== 0) {
			this._onDidError.fire(result.stderr.trim() || 'Rebase --continue gagal.');
		} else {
			this._onDidFinish.fire('Rebase dilanjutkan.');
		}
	}

	public async abort(): Promise<void> {
		const result = await this._git.run(['rebase', '--abort'], this._rootPath);
		if (result.exitCode !== 0) {
			this._onDidError.fire(result.stderr.trim() || 'Rebase --abort gagal.');
		} else {
			this._onDidFinish.fire('Rebase dibatalkan.');
		}
	}

	public async skip(): Promise<void> {
		const result = await this._git.run(['rebase', '--skip'], this._rootPath);
		if (result.exitCode !== 0) {
			this._onDidError.fire(result.stderr.trim() || 'Rebase --skip gagal.');
		} else {
			this._onDidFinish.fire('Commit dilewati.');
		}
	}

	public render(container: HTMLElement): void {
		CssInjector.inject(REBASE_STYLE_ID, `
			.dc-rebase-row { display: flex; align-items: center; gap: 8px; padding: 3px 10px; font-size: 12px; color: #cccccc; user-select: none; }
			.dc-rebase-row:hover { background: #2a2d2e; }
			.dc-rebase-toolbar { display: flex; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #2a2d2e; }
		`);
		clearNode(container);

		const toolbar = $<HTMLElement>('div', 'dc-rebase-toolbar');
		const startBtn = $<HTMLButtonElement>('button');
		startBtn.textContent = 'Mulai Rebase';
		startBtn.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;font-size:11px;padding:3px 12px;cursor:pointer;';
		startBtn.addEventListener('click', () => void this.start());

		const continueBtn = $<HTMLButtonElement>('button');
		continueBtn.textContent = 'Lanjutkan';
		continueBtn.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;font-size:11px;padding:3px 12px;cursor:pointer;';
		continueBtn.addEventListener('click', () => void this.continue());

		const abortBtn = $<HTMLButtonElement>('button');
		abortBtn.textContent = 'Batalkan';
		abortBtn.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;font-size:11px;padding:3px 12px;cursor:pointer;';
		abortBtn.addEventListener('click', () => void this.abort());

		toolbar.appendChild(startBtn);
		toolbar.appendChild(continueBtn);
		toolbar.appendChild(abortBtn);
		container.appendChild(toolbar);

		if (this._todo.length === 0) {
			const empty = $('div');
			empty.textContent = 'Pilih base branch untuk memuat todo rebase.';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:12px;';
			container.appendChild(empty);
			return;
		}

		for (let i = 0; i < this._todo.length; i++) {
			const item = this._todo[i];
			const row = $<HTMLElement>('div', 'dc-rebase-row');

			const select = $<HTMLSelectElement>('select');
			select.style.cssText = 'background:#3c3c3c;border:1px solid #3c3c3c;border-radius:2px;color:#cccccc;font-size:11px;padding:1px 4px;outline:none;';
			const actions: RebaseTodoAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
			for (const action of actions) {
				const option = document.createElement('option');
				option.value = action;
				option.textContent = REBASE_ACTION_LABELS[action];
				option.selected = item.action === action;
				select.appendChild(option);
			}
			this._register(addDisposableListener(select, 'change', () => {
				this.setAction(i, select.value as RebaseTodoAction);
			}));

			const hash = $<HTMLElement>('span');
			hash.textContent = item.hash;
			hash.style.cssText = 'color:#3794ff;font-family:Consolas,monospace;font-size:11px;width:52px;';

			const message = $<HTMLElement>('span');
			message.textContent = item.message;
			message.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			if (item.action === 'drop') {
				row.style.opacity = '0.45';
			}

			row.appendChild(select);
			row.appendChild(hash);
			row.appendChild(message);
			container.appendChild(row);
		}
	}
}
