/**
 * Dardcor Code - Files to Include & Files to Exclude Match Filters
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { match, splitGlobAware } from '../../core/formatting/glob.js';
import { Path } from '../../core/types/path.js';

export interface ISearchFileFilters {
	readonly includes: string[];
	readonly excludes: string[];
}

export class SearchFileIncludes extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<ISearchFileFilters>());
	readonly onDidChange: Event<ISearchFileFilters> = this._onDidChange.event;

	private _includes: string[] = [];
	private _excludes: string[] = [];

	constructor(includes: string[] = [], excludes: string[] = []) {
		super();
		this._includes = includes;
		this._excludes = excludes;
	}

	get includes(): string[] {
		return [...this._includes];
	}

	get excludes(): string[] {
		return [...this._excludes];
	}

	public setIncludes(patterns: string[]): void {
		this._includes = patterns.filter(p => !!p.trim());
		this._onDidChange.fire(this.state);
	}

	public setExcludes(patterns: string[]): void {
		this._excludes = patterns.filter(p => !!p.trim());
		this._onDidChange.fire(this.state);
	}

	public setFromText(includeText: string, excludeText: string): void {
		this.setIncludes(SearchFileIncludes.parsePatternList(includeText));
		this.setExcludes(SearchFileIncludes.parsePatternList(excludeText));
	}

	get state(): ISearchFileFilters {
		return { includes: this.includes, excludes: this.excludes };
	}

	public isPathExcluded(relativePath: string): boolean {
		const normalized = Path.normalize(relativePath);
		const base = Path.basename(normalized);
		return this._excludes.some(pattern => SearchFileIncludes.matches(pattern, normalized) || SearchFileIncludes.matches(pattern, base));
	}

	public isPathIncluded(relativePath: string): boolean {
		if (this.isPathExcluded(relativePath)) {
			return false;
		}
		if (this._includes.length === 0) {
			return true;
		}
		const normalized = Path.normalize(relativePath);
		const base = Path.basename(normalized);
		return this._includes.some(pattern => SearchFileIncludes.matches(pattern, normalized) || SearchFileIncludes.matches(pattern, base));
	}

	public static matches(pattern: string, path: string): boolean {
		if (!pattern) {
			return false;
		}
		try {
			return match(pattern, path);
		} catch {
			const normalizedPattern = pattern.replace(/^\.\//, '');
			return path.includes(normalizedPattern);
		}
	}

	public static parsePatternList(text: string): string[] {
		return splitGlobAware(text, ',')
			.map(p => p.trim())
			.filter(p => !!p);
	}

	public static splitPatternAware(text: string): string[] {
		return SearchFileIncludes.parsePatternList(text);
	}

	public static isNegatedPattern(pattern: string): boolean {
		return pattern.startsWith('!');
	}

	public static toRelativePath(path: string, rootPath: string): string {
		const normalized = Path.normalize(path);
		const root = Path.normalize(rootPath);
		if (normalized.startsWith(root)) {
			return normalized.substring(root.length).replace(/^\//, '');
		}
		return normalized;
	}
}
