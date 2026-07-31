import { spawn, execFile, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';

export interface SearchOptions {
	rootPath: string;
	query: string;
	include?: string[];
	exclude?: string[];
	maxResults?: number;
	caseSensitive?: boolean;
	useRegex?: boolean;
}

export interface SearchResult {
	path: string;
	line: number;
	column: number;
	text: string;
}

export interface SearchJob {
	id: number;
	options: SearchOptions;
	status: 'running' | 'done' | 'canceled';
	results: SearchResult[];
	startedAt: number;
}

const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'out', '.cache', '.next', 'coverage'];

export class SharedProcessSearch extends Disposable {
	private _nextJobId = 1;
	private readonly _jobs = new Map<number, SearchJob>();
	private readonly _cancelTokens = new Map<number, { canceled: boolean }>();
	private _ripgrepAvailable: boolean | null = null;

	constructor() {
		super();
		this._register(toDisposable(() => {
			for (const job of this._jobs.keys()) {
				this.cancelSearch(job);
			}
		}));
	}

	public async isRipgrepAvailable(): Promise<boolean> {
		if (this._ripgrepAvailable !== null) {
			return this._ripgrepAvailable;
		}
		this._ripgrepAvailable = await new Promise<boolean>((resolve) => {
			execFile('rg', ['--version'], (err) => resolve(!err));
		});
		return this._ripgrepAvailable;
	}

	public async search(options: SearchOptions): Promise<number> {
		const job: SearchJob = {
			id: this._nextJobId++,
			options,
			status: 'running',
			results: [],
			startedAt: Date.now()
		};
		this._jobs.set(job.id, job);
		const token = { canceled: false };
		this._cancelTokens.set(job.id, token);
		this._run(job, token).catch((err) => {
			console.error('[shared-process-search] search failed:', err);
		});
		return job.id;
	}

	public cancelSearch(id: number): boolean {
		const token = this._cancelTokens.get(id);
		if (!token) {
			return false;
		}
		token.canceled = true;
		const job = this._jobs.get(id);
		if (job) {
			job.status = 'canceled';
		}
		this._cancelTokens.delete(id);
		return true;
	}

	public getJob(id: number): SearchJob | null {
		return this._jobs.get(id) ?? null;
	}

	public getResults(id: number): SearchResult[] {
		const job = this._jobs.get(id);
		return job ? [...job.results] : [];
	}

	public getRunningJobs(): SearchJob[] {
		return [...this._jobs.values()].filter((job) => job.status === 'running');
	}

	public cancelAll(): void {
		for (const id of [...this._cancelTokens.keys()]) {
			this.cancelSearch(id);
		}
	}

	public clearJobs(): void {
		this.cancelAll();
		this._jobs.clear();
	}

	public override dispose(): void {
		this.clearJobs();
		super.dispose();
	}

	private async _run(job: SearchJob, token: { canceled: boolean }): Promise<void> {
		const options = job.options;
		const maxResults = options.maxResults ?? 500;
		if (await this.isRipgrepAvailable()) {
			await this._runWithRipgrep(job, token, maxResults);
		} else {
			await this._runWithWalk(job, token, maxResults);
		}
		if (token.canceled || job.status === 'canceled') {
			return;
		}
		job.status = 'done';
		this._cancelTokens.delete(job.id);
	}

	private _runWithRipgrep(job: SearchJob, token: { canceled: boolean }, maxResults: number): Promise<void> {
		return new Promise((resolve) => {
			const options = job.options;
			const args: string[] = ['--line-number', '--column', '--no-heading', '--color', 'never'];
			if (options.caseSensitive) {
				args.push('--case-sensitive');
			} else {
				args.push('--ignore-case');
			}
			if (!options.useRegex) {
				args.push('--fixed-strings');
			}
			for (const include of options.include ?? []) {
				args.push('--glob', include);
			}
			const excludes = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
			for (const exclude of excludes) {
				args.push('--glob', `!${exclude}`);
			}
			args.push('--max-count', String(maxResults), options.query, options.rootPath);

			const child: ChildProcess = spawn('rg', args, { windowsHide: true });
			let buffer = '';
			child.stdout?.on('data', (data: Buffer) => {
				if (token.canceled) {
					return;
				}
				buffer += data.toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.trim()) {
						continue;
					}
					const parsed = parseRipgrepLine(line, options.rootPath);
					if (parsed) {
						job.results.push(parsed);
						if (job.results.length >= maxResults) {
							child.kill();
							break;
						}
					}
				}
			});
			child.on('error', () => {
				this._ripgrepAvailable = false;
				resolve();
			});
			child.on('close', () => resolve());
		});
	}

	private async _runWithWalk(job: SearchJob, token: { canceled: boolean }, maxResults: number): Promise<void> {
		const options = job.options;
		let match: RegExp;
		try {
			match = options.useRegex
				? new RegExp(options.query, options.caseSensitive ? '' : 'i')
				: new RegExp(escapeRegExp(options.query), options.caseSensitive ? '' : 'i');
		} catch {
			match = new RegExp(escapeRegExp(options.query), 'i');
		}
		const files = collectFiles(options.rootPath, options.include ?? [], [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])], token);
		for (const file of files) {
			if (token.canceled || job.results.length >= maxResults) {
				return;
			}
			try {
				const content = await fs.promises.readFile(file, 'utf-8');
				const lines = content.split('\n');
				for (let i = 0; i < lines.length; i++) {
					if (token.canceled || job.results.length >= maxResults) {
						return;
					}
					const line = lines[i];
					const index = line.search(match);
					if (index !== -1) {
						job.results.push({
							path: file,
							line: i + 1,
							column: index + 1,
							text: line.length > 200 ? line.slice(0, 200) + '...' : line
						});
					}
				}
			} catch {
				// Skip unreadable files.
			}
		}
	}
}

function parseRipgrepLine(line: string, rootPath: string): SearchResult | null {
	const match = /^(.+?):(\d+):(\d+):(.*)$/.exec(line);
	if (!match) {
		return null;
	}
	const filePath = path.resolve(rootPath, match[1]);
	return {
		path: filePath,
		line: Number(match[2]),
		column: Number(match[3]),
		text: match[4].length > 200 ? match[4].slice(0, 200) + '...' : match[4]
	};
}

function collectFiles(rootPath: string, include: string[], exclude: string[], token: { canceled: boolean }): string[] {
	const files: string[] = [];
	const walk = (dir: string, depth: number): void => {
		if (token.canceled || depth > 32) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (token.canceled) {
				return;
			}
			if (exclude.includes(entry.name)) {
				continue;
			}
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath, depth + 1);
			} else if (entry.isFile()) {
				if (include.length === 0 || include.some((pattern) => path.basename(fullPath).match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*'))))) {
					files.push(fullPath);
				}
			}
		}
	};
	walk(rootPath, 0);
	return files;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createSharedProcessSearch(): SharedProcessSearch {
	return new SharedProcessSearch();
}
