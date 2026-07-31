/**
 * Dardcor Code - Remote ripgrep Search Execution Runner Over RPC Socket (Task 834)
 */

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { IRemoteChannelClient, IRemoteChannelServer } from '../transport/connection-multiplexer.js';

export interface IRemoteSearchOptions {
	readonly pattern: string;
	readonly folder: string;
	readonly maxResults?: number;
	readonly include?: string[];
	readonly ignore?: string[];
	readonly contextLines?: number;
}

export interface IRemoteSearchMatch {
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly text: string;
}

export class RemoteFileSearchClient extends Disposable {
	private readonly _onMatch = this._register(new Emitter<IRemoteSearchMatch>());
	readonly onMatch: Event<IRemoteSearchMatch> = this._onMatch.event;

	constructor(private readonly _channel: IRemoteChannelClient) {
		super();
		this._register(this._channel.onEvent(payload => {
			if (payload && payload.kind === 'match') {
				this._onMatch.fire(payload.match as IRemoteSearchMatch);
			}
		}));
	}

	search(options: IRemoteSearchOptions): Promise<{ count: number; durationMs: number }> {
		return this._channel.call({ op: 'search', options });
	}
}

export class RemoteFileSearchServer implements IRemoteChannelServer {
	private readonly _root: string;
	private _eventSink: ((payload: any) => void) | null = null;
	private readonly _rgSearch = new RipgrepSearcher();

	constructor(root: string) {
		this._root = resolve(root);
	}

	setEventSink(sink: (payload: any) => void): void {
		this._eventSink = sink;
	}

	async call(payload: any): Promise<any> {
		if (!payload || payload.op !== 'search') {
			throw new Error('Invalid search request');
		}
		const options = payload.options as IRemoteSearchOptions;
		if (!options || typeof options.pattern !== 'string') {
			throw new Error('Search requires a pattern');
		}
		const started = Date.now();
		const emit = (match: IRemoteSearchMatch): void => {
			this._eventSink?.({ kind: 'match', match });
		};
		const folder = this._resolveFolder(options.folder);
		let count: number;
		try {
			count = await this._rgSearch.search(folder, options, emit);
		} catch (error) {
			if (error instanceof Error && error.name === 'ENOENT') {
				count = await fallbackSearch(folder, options, emit);
			} else {
				throw error;
			}
		}
		return { count, durationMs: Date.now() - started };
	}

	private _resolveFolder(folder: string): string {
		const normalized = folder.startsWith('/') ? folder : `/${folder}`;
		const target = resolve(this._root, `.${normalized}`);
		const rootWithSep = this._root.endsWith(sep) || this._root.endsWith('/') ? this._root : this._root + sep;
		if (target !== this._root && !target.startsWith(rootWithSep)) {
			throw new Error(`Folder escapes workspace root: ${folder}`);
		}
		return target;
	}
}

class RipgrepSearcher {
	async search(
		folder: string,
		options: IRemoteSearchOptions,
		emit: (match: IRemoteSearchMatch) => void
	): Promise<number> {
		return new Promise<number>((resolvePromise, reject) => {
			const args = [
				'--line-number',
				'--column',
				'--no-heading',
				'--color', 'never',
				'--stats',
				...options.ignore?.map(glob => ['--glob', `!${glob}`]).flat() ?? [],
				...options.include?.map(glob => ['--glob', glob]).flat() ?? [],
				options.pattern,
				folder
			];
			let child;
			try {
				child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
			} catch (error) {
				reject(error);
				return;
			}
			let stdout = '';
			let count = 0;
			child.stdout.on('data', (chunk: Buffer) => {
				stdout += chunk.toString('utf8');
				const lines = stdout.split('\n');
				stdout = lines.pop() ?? '';
				for (const line of lines) {
					const match = parseRgLine(folder, line);
					if (match) {
						count++;
						emit(match);
					}
				}
			});
			child.on('error', (error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT') {
					reject(error);
				} else {
					reject(error);
				}
			});
			child.on('close', code => {
				resolvePromise(count);
				void code;
			});
		});
	}
}

function parseRgLine(folder: string, line: string): IRemoteSearchMatch | null {
	const match = /^([^:]+):(\d+):(\d+):(.*)$/.exec(line);
	if (!match) {
		return null;
	}
	const [, file, lineNumber, column, text] = match;
	const relPath = resolve(file).startsWith(resolve(folder))
		? resolve(file).slice(resolve(folder).length).split(sep).join('/')
		: file;
	return {
		file: relPath,
		line: Number(lineNumber),
		column: Number(column),
		text
	};
}

function fallbackSearch(
	folder: string,
	options: IRemoteSearchOptions,
	emit: (match: IRemoteSearchMatch) => void
): number {
	let count = 0;
	const maxResults = options.maxResults ?? 1000;
	const ignoreDirs = new Set(['.git', 'node_modules', ...(options.ignore ?? [])]);
	const pattern = options.pattern.toLowerCase();

	const walk = (dir: string): void => {
		if (count >= maxResults) {
			return;
		}
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (count >= maxResults) {
				return;
			}
			const full = join(dir, entry);
			let isDir = false;
			try {
				isDir = statSync(full).isDirectory();
			} catch {
				continue;
			}
			if (isDir) {
				if (!ignoreDirs.has(entry)) {
					walk(full);
				}
				continue;
			}
			if (options.include && options.include.length > 0 && !options.include.some(g => matchesGlob(entry, g))) {
				continue;
			}
			if (options.ignore && options.ignore.some(g => matchesGlob(entry, g))) {
				continue;
			}
			let content: string;
			try {
				content = readFileSync(full, 'utf8');
			} catch {
				continue;
			}
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const column = lines[i].toLowerCase().indexOf(pattern);
				if (column >= 0) {
					const rel = full.slice(folder.length).split(sep).join('/');
					emit({ file: rel || '/', line: i + 1, column: column + 1, text: lines[i] });
					count++;
					if (count >= maxResults) {
						return;
					}
				}
			}
		}
	};

	walk(folder);
	return count;
}

function matchesGlob(filename: string, glob: string): boolean {
	const normalized = glob.replace(/^\*\./, '.').replace(/^!/, '');
	const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${escaped}$`).test(filename);
}
