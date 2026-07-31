/**
 * Dardcor Code - Search Result Match Tree Renderer
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { ISearchMatch } from './ripgrep-service.js';
import { escape } from '../../core/types/strings.js';
import { clearNode, $ } from '../../core/dom/element.js';

export interface ISearchResultsGroup {
	readonly resource: URI;
	readonly matches: ISearchMatch[];
}

function compareMatches(a: ISearchMatch, b: ISearchMatch): number {
	if (a.lineNumber !== b.lineNumber) {
		return a.lineNumber - b.lineNumber;
	}
	return a.start - b.start;
}

export class SearchResultsTree extends Disposable {
	private readonly _onDidSelectMatch = this._register(new Emitter<ISearchMatch>());
	readonly onDidSelectMatch: Event<ISearchMatch> = this._onDidSelectMatch.event;

	private readonly _container: HTMLElement;
	private _groups: ISearchResultsGroup[] = [];
	private _expanded = new Set<string>();

	constructor(container: HTMLElement) {
		super();
		this._container = container;
		this._container.className = 'dc-search-results';
	}

	get groups(): ISearchResultsGroup[] {
		return this._groups;
	}

	public setResults(matches: ISearchMatch[]): void {
		const groups = new Map<string, ISearchResultsGroup>();
		for (const match of matches) {
			const key = match.resource.toString();
			let group = groups.get(key);
			if (!group) {
				group = { resource: match.resource, matches: [] };
				groups.set(key, group);
			}
			group.matches.push(match);
		}
		this._groups = [...groups.values()].sort((a, b) => a.resource.path.localeCompare(b.resource.path));
		for (const group of this._groups) {
			group.matches.sort(compareMatches);
		}
		this.render();
	}

	public clear(): void {
		this._groups = [];
		this._expanded.clear();
		clearNode(this._container);
	}

	public getTotalMatchCount(): number {
		let count = 0;
		for (const group of this._groups) {
			count += group.matches.length;
		}
		return count;
	}

	public getFileCount(): number {
		return this._groups.length;
	}

	public render(): void {
		clearNode(this._container);
		if (this._groups.length === 0) {
			const empty = $('div', 'dc-search-empty');
			empty.textContent = 'Tidak ada hasil';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			this._container.appendChild(empty);
			return;
		}

		for (const group of this._groups) {
			this._renderGroup(group);
		}
	}

	private _renderGroup(group: ISearchResultsGroup): void {
		const expanded = this._expanded.has(group.resource.toString());

		const groupRow = $<HTMLElement>('div', 'dc-search-file');
		groupRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;user-select:none;';
		groupRow.title = group.resource.path;

		const chevron = $('span', 'dc-search-chevron');
		chevron.textContent = expanded ? '\u25BE' : '\u25B8';
		chevron.style.cssText = 'font-size:9px;width:12px;color:#cccccc;';

		const icon = $('span', 'dc-search-file-icon');
		icon.textContent = '\u{1F4C4}';
		icon.style.marginRight = '4px';

		const name = $<HTMLElement>('span', 'dc-search-file-name');
		name.textContent = Path.basename(group.resource.path);
		name.style.cssText = 'font-weight:600;color:#cccccc;font-size:13px;';

		const count = $<HTMLElement>('span', 'dc-search-file-count');
		count.textContent = `(${group.matches.length})`;
		count.style.cssText = 'color:#8a8a8a;font-size:11px;margin-left:auto;';

		const expandGroup = () => {
			const key = group.resource.toString();
			if (this._expanded.has(key)) {
				this._expanded.delete(key);
			} else {
				this._expanded.add(key);
			}
			this.render();
		};

		groupRow.addEventListener('click', (e: MouseEvent) => {
			if (e.target === count || (e.target as HTMLElement).closest('.dc-search-line')) {
				return;
			}
			expandGroup();
		});

		groupRow.appendChild(chevron);
		groupRow.appendChild(icon);
		groupRow.appendChild(name);
		groupRow.appendChild(count);
		this._container.appendChild(groupRow);

		if (expanded) {
			for (const match of group.matches) {
				this._renderMatchRow(match);
			}
		}
	}

	private _renderMatchRow(match: ISearchMatch): void {
		const row = $<HTMLElement>('div', 'dc-search-line');
		row.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:1px 8px 1px 30px;cursor:pointer;font-size:12px;user-select:none;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});
		row.addEventListener('click', () => {
			this._onDidSelectMatch.fire(match);
		});

		const lineNumber = $<HTMLElement>('span', 'dc-search-line-number');
		lineNumber.textContent = String(match.lineNumber);
		lineNumber.style.cssText = 'color:#0e639c;min-width:24px;text-align:right;font-family:Consolas,monospace;';

		const lineText = $<HTMLElement>('span', 'dc-search-line-text');
		lineText.style.cssText = 'color:#cccccc;white-space:pre;overflow:hidden;text-overflow:ellipsis;font-family:Consolas,monospace;';
		const escaped = escape(match.lineText);
		const safeStart = Math.max(0, match.start);
		const safeEnd = Math.min(match.lineText.length, Math.max(safeStart, match.end));
		const highlighted =
			escaped.substring(0, safeStart) +
			`<mark style="background:#f2f27d;color:#000000;">${escaped.substring(safeStart, safeEnd)}</mark>` +
			escaped.substring(safeEnd);
		lineText.innerHTML = highlighted;

		row.appendChild(lineNumber);
		row.appendChild(lineText);
		this._container.appendChild(row);
	}
}
