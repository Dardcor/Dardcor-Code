/**
 * Dardcor Code - Git Repository Status Track Model
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { GitService, IGitStatusEntry, GIT_STATUS_LABELS } from './git-service.js';

export interface IScmResource {
	readonly uri: URI;
	readonly path: string;
	readonly status: string;
	readonly statusLabel: string;
	readonly staged: boolean;
	readonly untracked: boolean;
}

export class ScmRepository extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _staged: IScmResource[] = [];
	private _unstaged: IScmResource[] = [];
	private _untracked: IScmResource[] = [];
	private _branchName = '';
	private _refreshing = false;

	constructor(private readonly _git: GitService, private readonly _rootPath: string) {
		super();
	}

	get rootPath(): string {
		return this._rootPath;
	}

	get repositoryName(): string {
		return Path.basename(this._rootPath);
	}

	get staged(): IScmResource[] {
		return this._staged;
	}

	get unstaged(): IScmResource[] {
		return this._unstaged;
	}

	get untracked(): IScmResource[] {
		return this._untracked;
	}

	get branchName(): string {
		return this._branchName;
	}

	get isRefreshing(): boolean {
		return this._refreshing;
	}

	private _toResource(entry: IGitStatusEntry): IScmResource {
		const uri = URI.file(Path.join(this._rootPath, entry.path));
		return {
			uri,
			path: entry.path,
			status: entry.status,
			statusLabel: GIT_STATUS_LABELS[entry.status] ?? entry.status,
			staged: entry.staged,
			untracked: entry.untracked
		};
	}

	public async refresh(): Promise<void> {
		if (this._refreshing) {
			return;
		}
		this._refreshing = true;
		try {
			const entries = await this._git.status(this._rootPath);
			this._staged = [];
			this._unstaged = [];
			this._untracked = [];
			for (const entry of entries) {
				const resource = this._toResource(entry);
				if (entry.untracked) {
					this._untracked.push(resource);
				} else if (entry.staged) {
					this._staged.push(resource);
				} else {
					this._unstaged.push(resource);
				}
			}
			this._branchName = await this._git.getCurrentBranch(this._rootPath);
		} catch (err) {
			// repository mungkin belum di-initialize
		} finally {
			this._refreshing = false;
			this._onDidChange.fire();
		}
	}

	public async stage(paths: string[]): Promise<void> {
		await this._git.add(this._rootPath, paths);
		await this.refresh();
	}

	public async stageAll(): Promise<void> {
		await this._git.addAll(this._rootPath);
		await this.refresh();
	}

	public async unstage(paths: string[]): Promise<void> {
		await this._git.unstage(this._rootPath, paths);
		await this.refresh();
	}

	public async commit(message: string, stageAll: boolean): Promise<boolean> {
		if (stageAll) {
			await this._git.addAll(this._rootPath);
		}
		const result = await this._git.commit(this._rootPath, message);
		await this.refresh();
		return result.exitCode === 0;
	}

	public get hasChanges(): boolean {
		return this._staged.length > 0 || this._unstaged.length > 0 || this._untracked.length > 0;
	}
}
