/**
 * Dardcor Code - Git Stash Create, List & Restore Management
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { GitService } from './git-service';

export interface IStashEntry {
	readonly id: string;
	readonly message: string;
	readonly branch: string;
	readonly date: number;
}

export class GitStash extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _git: GitService;
	private _rootPath: string;
	private _entries: IStashEntry[] = [];

	constructor(git: GitService, rootPath: string) {
		super();
		this._git = git;
		this._rootPath = rootPath;
	}

	get entries(): IStashEntry[] {
		return [...this._entries];
	}

	get count(): number {
		return this._entries.length;
	}

	public async refresh(): Promise<void> {
		try {
			const raw = await this._git.run(['stash', 'list', '--format=%gd|%s|%gs|%ct'], this._rootPath);
			this._entries = raw.stdout.split(/\r?\n/)
				.filter(line => !!line.trim())
				.map(line => {
					const parts = line.split('|');
					const [id, message, branch] = parts;
					const timestamp = Number(parts[3] ?? '0') * 1000;
					return {
						id: id ?? 'stash@{0}',
						message: message ?? '',
						branch: branch ?? '',
						date: Number.isFinite(timestamp) ? timestamp : Date.now()
					};
				});
		} catch {
			this._entries = [];
		}
		this._onDidChange.fire();
	}

	public async push(message?: string, includeUntracked = false): Promise<IStashEntry | undefined> {
		try {
			const args = ['stash', 'push', '--include-untracked'];
			if (includeUntracked) {
				args.push('-u');
			}
			if (message) {
				args.push('-m', message);
			}
			const raw = await this._git.run(args, this._rootPath);
			if (raw.stdout.trim()) {
				await this.refresh();
				return this._entries[0];
			}
		} catch (err) {
			console.error('Gagal membuat stash:', err);
		}
		return undefined;
	}

	public async pop(id?: string): Promise<boolean> {
		try {
			const args = id ? ['stash', 'pop', id] : ['stash', 'pop'];
			await this._git.run(args, this._rootPath);
			await this.refresh();
			return true;
		} catch (err) {
			console.error('Gagal pop stash:', err);
			return false;
		}
	}

	public async apply(id?: string): Promise<boolean> {
		try {
			const args = id ? ['stash', 'apply', id] : ['stash', 'apply'];
			await this._git.run(args, this._rootPath);
			return true;
		} catch (err) {
			console.error('Gagal apply stash:', err);
			return false;
		}
	}

	public async drop(id?: string): Promise<boolean> {
		try {
			const args = id ? ['stash', 'drop', id] : ['stash', 'drop'];
			await this._git.run(args, this._rootPath);
			await this.refresh();
			return true;
		} catch (err) {
			console.error('Gagal drop stash:', err);
			return false;
		}
	}

	public async clear(): Promise<boolean> {
		try {
			await this._git.run(['stash', 'clear'], this._rootPath);
			this._entries = [];
			this._onDidChange.fire();
			return true;
		} catch (err) {
			console.error('Gagal clear stash:', err);
			return false;
		}
	}

	public getStash(message: string): IStashEntry | undefined {
		return this._entries.find(e => e.message === message);
	}
}
