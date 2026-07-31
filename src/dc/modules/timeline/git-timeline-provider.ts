/**
 * Dardcor Code - Git Commit History Item Timeline Provider
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { URI } from '../../core/types/uri';
import { Path } from '../../core/types/path';
import { GitService, IGitLogEntry } from '../scm/git-service';
import { ITimelineItem } from './timeline-view';

export interface IGitTimelineOptions {
	readonly limit?: number;
	readonly includeAllBranches?: boolean;
	readonly showAuthor?: boolean;
}

export class GitTimelineProvider extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _git: GitService;
	private readonly _rootPath: string;
	private _options: IGitTimelineOptions = { limit: 50, includeAllBranches: false, showAuthor: true };

	constructor(git: GitService, rootPath: string) {
		super();
		this._git = git;
		this._rootPath = rootPath;
	}

	get rootPath(): string {
		return this._rootPath;
	}

	public setOptions(options: IGitTimelineOptions): void {
		this._options = { ...this._options, ...options };
		this._onDidChange.fire();
	}

	public async provideTimelineItems(resource?: URI): Promise<ITimelineItem[]> {
		try {
			const entries = await this._fetchCommits(resource);
			return entries.map(entry => this._entryToItem(entry, resource));
		} catch {
			return [];
		}
	}

	public async provideCommitCount(resource?: URI): Promise<number> {
		try {
			const entries = await this._fetchCommits(resource);
			return entries.length;
		} catch {
			return 0;
		}
	}

	public async getCommitForEntry(entry: ITimelineItem): Promise<IGitLogEntry | undefined> {
		if (!entry.id.startsWith('git-')) {
			return undefined;
		}
		const hash = entry.id.substring(4);
		const result = await this._git.run(['show', '-s', '--pretty=format:%h|%s|%an|%aI', hash], this._rootPath);
		const parts = result.stdout.split('|');
		if (parts.length < 4) {
			return undefined;
		}
		return { hash: parts[0], message: parts[1], author: parts[2], date: parts[3] };
	}

	private async _fetchCommits(resource?: URI): Promise<IGitLogEntry[]> {
		const limit = this._options.limit ?? 50;
		const args: string[] = ['log', `-n${limit}`, '--pretty=format:%h|%s|%an|%aI'];
		if (this._options.includeAllBranches) {
			args.push('--all');
		}
		if (resource && resource.scheme === 'file') {
			const relative = GitTimelineProvider.toRelativePath(resource.path, this._rootPath);
			if (relative) {
				args.push('--', relative);
			}
		}
		const result = await this._git.run(args, this._rootPath);
		if (result.exitCode !== 0) {
			return [];
		}
		const entries: IGitLogEntry[] = [];
		for (const line of result.stdout.split(/\r?\n/)) {
			const parts = line.split('|');
			if (parts.length >= 4) {
				entries.push({ hash: parts[0], message: parts[1], author: parts[2], date: parts[3] });
			}
		}
		return entries;
	}

	private _entryToItem(entry: IGitLogEntry, resource?: URI): ITimelineItem {
		const timestamp = new Date(entry.date).getTime();
		const detailParts: string[] = [];
		if (this._options.showAuthor) {
			detailParts.push(entry.author);
		}
		detailParts.push(entry.hash);
		if (resource) {
			detailParts.push(Path.basename(resource.path));
		}
		return {
			id: `git-${entry.hash}`,
			label: entry.message,
			detail: detailParts.join(' \u00B7 '),
			timestamp,
			icon: '\u25C6',
			resource,
			kind: 'git'
		};
	}

	public static toRelativePath(absolutePath: string, rootPath: string): string {
		const normalized = Path.normalize(absolutePath);
		const root = Path.normalize(rootPath);
		if (!normalized.startsWith(root)) {
			return '';
		}
		const relative = normalized.substring(root.length).replace(/^\//, '');
		return relative.replace(/\\/g, '/');
	}
}
