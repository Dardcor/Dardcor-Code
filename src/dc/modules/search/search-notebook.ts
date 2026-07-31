/**
 * Dardcor Code - Notebook Document Cell Text Search Provider
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { createRegExp } from '../../core/types/strings';
import { JSONParser } from '../../core/formatting/json-parser';

export type NotebookCellKind = 'markdown' | 'code';

export interface INotebookCell {
	readonly id: string;
	readonly kind: NotebookCellKind;
	readonly languageId: string;
	readonly source: string;
	readonly executionCount?: number;
}

export interface INotebookCellMatch {
	readonly cell: INotebookCell;
	readonly cellIndex: number;
	readonly line: number;
	readonly start: number;
	readonly end: number;
	readonly matchText: string;
	readonly lineText: string;
}

export interface INotebookSearchOptions {
	readonly matchCase?: boolean;
	readonly wholeWord?: boolean;
	readonly isRegex?: boolean;
	readonly searchMarkdown?: boolean;
	readonly searchCode?: boolean;
}

export class SearchNotebookProvider extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _cells: INotebookCell[] = [];

	public setCells(cells: INotebookCell[]): void {
		this._cells = [...cells];
		this._onDidChange.fire();
	}

	public get cells(): INotebookCell[] {
		return [...this._cells];
	}

	public get cellCount(): number {
		return this._cells.length;
	}

	public get totalSourceLength(): number {
		let total = 0;
		for (const cell of this._cells) {
			total += cell.source.length;
		}
		return total;
	}

	public search(query: string, options: INotebookSearchOptions = {}): INotebookCellMatch[] {
		if (!query || this._cells.length === 0) {
			return [];
		}
		let regex: RegExp;
		try {
			regex = createRegExp(query, options.isRegex ?? false, {
				matchCase: options.matchCase ?? false,
				wholeWord: options.wholeWord ?? false
			});
		} catch {
			return [];
		}

		const matches: INotebookCellMatch[] = [];
		for (let i = 0; i < this._cells.length; i++) {
			const cell = this._cells[i];
			if (cell.kind === 'markdown' && !(options.searchMarkdown ?? true)) {
				continue;
			}
			if (cell.kind === 'code' && !(options.searchCode ?? true)) {
				continue;
			}
			const lines = cell.source.split(/\r?\n/);
			for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
				const lineText = lines[lineIdx];
				const lineMatches = lineText.matchAll(regex);
				for (const m of lineMatches) {
					if (m.index === undefined) {
						continue;
					}
					matches.push({
						cell,
						cellIndex: i,
						line: lineIdx + 1,
						start: m.index,
						end: m.index + m[0].length,
						matchText: m[0],
						lineText
					});
				}
			}
		}
		return matches;
	}

	public searchCell(cellIndex: number, query: string, options: INotebookSearchOptions = {}): INotebookCellMatch[] {
		const cell = this._cells[cellIndex];
		if (!cell || !query) {
			return [];
		}
		const subset = { ...this, _cells: [cell] } as unknown as SearchNotebookProvider;
		return subset.search(query, options).map(match => ({ ...match, cellIndex }));
	}

	public static parseNotebook(jsonText: string): INotebookCell[] {
		try {
			const doc = JSONParser.parse<{ cells?: any[] }>(jsonText);
			if (!doc || !Array.isArray(doc.cells)) {
				return [];
			}
			const cells: INotebookCell[] = [];
			let counter = 1;
			for (const raw of doc.cells) {
				const kind: NotebookCellKind = raw.cell_type === 'markdown' ? 'markdown' : 'code';
				const sourceLines: string[] = Array.isArray(raw.source) ? raw.source : [String(raw.source ?? '')];
				cells.push({
					id: `cell-${counter++}`,
					kind,
					languageId: kind === 'code' ? (raw.metadata?.language ?? raw.language ?? 'python') : 'markdown',
					source: sourceLines.join(''),
					executionCount: typeof raw.execution_count === 'number' ? raw.execution_count : undefined
				});
			}
			return cells;
		} catch {
			return [];
		}
	}

	public static cellToText(cell: INotebookCell): string {
		return `[${cell.kind}${cell.executionCount !== undefined ? ` ${cell.executionCount}` : ''}] ${cell.source}`;
	}
}
