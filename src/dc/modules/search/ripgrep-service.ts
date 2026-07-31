/**
 * Dardcor Code - Fast Native Ripgrep Binary Subprocess Search Service
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { createRegExp, escapeRegExpCharacters } from '../../core/types/strings.js';

declare const require: any;

export interface ISearchMatch {
	readonly resource: URI;
	readonly lineNumber: number;
	readonly lineText: string;
	readonly start: number;
	readonly end: number;
	readonly matchText: string;
}

export interface ISearchOptions {
	matchCase: boolean;
	wholeWord: boolean;
	isRegex: boolean;
	includes?: string[];
	excludes?: string[];
	maxResults?: number;
}

export interface ISearchSummary {
	resultCount: number;
	fileCount: number;
	durationMs: number;
	engine: 'rg' | 'fallback';
}

const DEFAULT_EXCLUDES = ['.git', 'node_modules', 'dist', 'out', '.dc'];

export class RipgrepService extends Disposable {
	private readonly _onDidSearchMatch = this._register(new Emitter<ISearchMatch>());
	readonly onDidSearchMatch: Event<ISearchMatch> = this._onDidSearchMatch.event;

	private readonly _onDidSearchEnd = this._register(new Emitter<ISearchSummary>());
	readonly onDidSearchEnd: Event<ISearchSummary> = this._onDidSearchEnd.event;

	private readonly _onDidSearchError = this._register(new Emitter<string>());
	readonly onDidSearchError: Event<string> = this._onDidSearchError.event;

	private readonly _onDidSearchStart = this._register(new Emitter<string>());
	readonly onDidSearchStart: Event<string> = this._onDidSearchStart.event;

	private _activeProcess: any = undefined;
	private _cancelled = false;

	public cancel(): void {
		this._cancelled = true;
		if (this._activeProcess) {
			try {
				this._activeProcess.kill();
			} catch {
				// ignore
			}
			this._activeProcess = undefined;
		}
	}

	public async search(query: string, rootUri: URI, options: ISearchOptions): Promise<void> {
		if (!query) {
			return;
		}
		this.cancel();
		this._cancelled = false;
		const started = Date.now();
		this._onDidSearchStart.fire(query);

		let engine: 'rg' | 'fallback' = 'rg';
		let resultCount = 0;
		const files = new Set<string>();

		try {
			const usedRg = await this._runRipgrep(query, rootUri, options, files);
			if (!usedRg) {
				engine = 'fallback';
				await this._manualSearch(query, rootUri, options, files);
			}
		} catch (err) {
			engine = 'fallback';
			this._onDidSearchError.fire(`Ripgrep gagal, fallback ke pencarian manual: ${String(err)}`);
			try {
				await this._manualSearch(query, rootUri, options, files);
			} catch (err2) {
				this._onDidSearchError.fire(`Pencarian gagal: ${String(err2)}`);
			}
		}

		resultCount = this._matchCount;
		this._onDidSearchEnd.fire({
			resultCount,
			fileCount: files.size,
			durationMs: Date.now() - started,
			engine
		});
	}

	private _matchCount = 0;

	private async _runRipgrep(query: string, rootUri: URI, options: ISearchOptions, files: Set<string>): Promise<boolean> {
		const cp = require('node:child_process');
		const args = ['--json', '--line-number', '--column', '--no-heading'];

		if (!options.isRegex) {
			args.push('--fixed-strings');
		}
		if (!options.matchCase) {
			args.push('-i');
		}
		if (options.wholeWord) {
			args.push('-w');
		}
		const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes ?? [])];
		for (const ex of excludes) {
			args.push('--glob', `!${ex}`);
		}
		for (const inc of options.includes ?? []) {
			args.push('--glob', inc);
		}
		if (options.maxResults) {
			args.push('--max-count', String(Math.min(2000, options.maxResults)));
		}

		args.push('--', query, rootUri.path.replace(/^\//, ''));

		return new Promise<boolean>((resolve) => {
			let child: any;
			try {
				child = cp.spawn('rg', args, { windowsHide: true });
			} catch {
				resolve(false);
				return;
			}
			this._activeProcess = child;
			child.on('error', (err: any) => {
				if (err?.code === 'ENOENT') {
					resolve(false);
				} else {
					this._onDidSearchError.fire(String(err));
					resolve(false);
				}
			});

			let buffer = '';
			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => {
				if (this._cancelled) {
					return;
				}
				buffer += chunk;
				let newlineIndex = buffer.indexOf('\n');
				while (newlineIndex !== -1) {
					const line = buffer.substring(0, newlineIndex).trim();
					buffer = buffer.substring(newlineIndex + 1);
					if (line) {
						this._handleRipgrepLine(line, files);
					}
					newlineIndex = buffer.indexOf('\n');
				}
			});

			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (_chunk: string) => {
				// ignore stderr noise (warnings etc.)
			});

			child.on('close', () => {
				this._activeProcess = undefined;
				resolve(true);
			});
		});
	}

	private _handleRipgrepLine(line: string, files: Set<string>): void {
		let message: any;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (message.type !== 'match' || !message.data) {
			return;
		}
		const data = message.data;
		const pathText = data.path?.text;
		if (!pathText) {
			return;
		}
		const uri = URI.file(pathText);
		files.add(uri.toString());
		const lineNumber = typeof data.line_number === 'number' ? data.line_number : 1;
		const lineText = data.lines?.text ?? '';
		const submatches: any[] = data.submatches ?? [];
		if (submatches.length === 0) {
			this._emitMatch(uri, lineNumber, lineText, 0, Math.max(0, lineText.length - 1), lineText);
			return;
		}
		for (const submatch of submatches) {
			const start = typeof submatch.start === 'number' ? submatch.start : 0;
			const end = typeof submatch.end === 'number' ? submatch.end : start;
			this._emitMatch(uri, lineNumber, lineText, start, end, submatch.match?.text ?? '');
		}
	}

	private _emitMatch(resource: URI, lineNumber: number, lineText: string, start: number, end: number, matchText: string): void {
		if (this._cancelled) {
			return;
		}
		this._matchCount++;
		this._onDidSearchMatch.fire({ resource, lineNumber, lineText, start, end, matchText });
	}

	private async _manualSearch(query: string, rootUri: URI, options: ISearchOptions, files: Set<string>): Promise<void> {
		const fs = require('node:fs/promises');
		const pathModule = require('node:path');
		let regex: RegExp;
		try {
			regex = createRegExp(query, options.isRegex, {
				matchCase: options.matchCase,
				wholeWord: options.wholeWord
			});
		} catch {
			this._onDidSearchError.fire(`Pattern tidak valid: ${query}`);
			return;
		}

		const rootPath = rootUri.path.replace(/^\//, '');
		const excludes = new Set([...DEFAULT_EXCLUDES, ...(options.excludes ?? [])]);

		const walk = async (dir: string, depth: number): Promise<void> => {
			if (this._cancelled || depth > 24) {
				return;
			}
			let entries: any[];
			try {
				entries = await fs.readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			entries.sort((a: any, b: any) => a.name.localeCompare(b.name));
			for (const entry of entries) {
				if (this._cancelled) {
					return;
				}
				const full = pathModule.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (!excludes.has(entry.name)) {
						await walk(full, depth + 1);
					}
					continue;
				}
				if (!entry.isFile() || entry.name.startsWith('.')) {
					continue;
				}
				if (options.includes && options.includes.length > 0) {
					const matched = options.includes.some(inc => {
						const pattern = inc.replace(/^[*.]|[*]$/g, '');
						return entry.name.includes(pattern) || full.includes(pattern);
					});
					if (!matched) {
						continue;
					}
				}
				if (excludes.has(entry.name)) {
					continue;
				}
				await this._searchFile(fs, full, regex, files);
			}
		};

		await walk(rootPath, 0);
	}

	private async _searchFile(fs: any, filePath: string, regex: RegExp, files: Set<string>): Promise<void> {
		let stat: any;
		try {
			stat = await fs.stat(filePath);
		} catch {
			return;
		}
		if (stat.size > 4 * 1024 * 1024) {
			return;
		}
		let content: string;
		try {
			const buf: Buffer = await fs.readFile(filePath);
			if (buf.includes(0)) {
				return;
			}
			content = buf.toString('utf8');
		} catch {
			return;
		}
		const uri = URI.file(filePath);
		const lines = content.split(/\r\n|\r|\n/);
		let matchCount = 0;
		for (let i = 0; i < lines.length; i++) {
			if (this._cancelled) {
				return;
			}
			const lineText = lines[i];
			const matches = lineText.matchAll(regex);
			let emitted = 0;
			for (const m of matches) {
				if (m.index === undefined) {
					continue;
				}
				files.add(uri.toString());
				this._emitMatch(uri, i + 1, lineText, m.index, m.index + m[0].length, m[0]);
				matchCount++;
				emitted++;
				if (emitted > 500) {
					break;
				}
			}
			if (matchCount > 5000) {
				break;
			}
		}
	}

	public static escapePattern(query: string): string {
		return escapeRegExpCharacters(query);
	}

	public static getDefaultExcludes(): string[] {
		return [...DEFAULT_EXCLUDES];
	}

	public static normalizeGlob(pattern: string): string {
		return Path.normalize(pattern);
	}
}
