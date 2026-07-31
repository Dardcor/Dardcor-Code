/**
 * Dardcor Code - Dedicated Full-Tab Search Results Document Editor
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { URI } from '../../core/types/uri';
import { RipgrepService, ISearchOptions, ISearchMatch, ISearchSummary } from './ripgrep-service';
import { SearchResultsTree } from './search-results-tree';
import { SearchHistory } from './search-history';
import { SearchFileIncludes } from './search-file-includes';

const SEARCH_EDITOR_STYLE_ID = 'dc-search-editor-styles';

export class SearchEditor extends Disposable {
	private readonly _onDidSelectMatch = this._register(new Emitter<ISearchMatch>());
	readonly onDidSelectMatch: Event<ISearchMatch> = this._onDidSelectMatch.event;

	private readonly _onDidChangeResults = this._register(new Emitter<ISearchSummary>());
	readonly onDidChangeResults: Event<ISearchSummary> = this._onDidChangeResults.event;

	private readonly _container: HTMLElement;
	private readonly _queryInput: HTMLInputElement;
	private readonly _includeInput: HTMLInputElement;
	private readonly _excludeInput: HTMLInputElement;
	private readonly _matchCaseToggle: HTMLInputElement;
	private readonly _regexToggle: HTMLInputElement;
	private readonly _statusLabel: HTMLElement;
	private readonly _resultsContainer: HTMLElement;
	private readonly _engine: RipgrepService;
	private readonly _resultsTree: SearchResultsTree;
	private readonly _history: SearchHistory;
	private readonly _fileFilters: SearchFileIncludes;
	private _rootUri: URI | undefined;
	private _timer: any = undefined;
	private _lastMatches: ISearchMatch[] = [];

	constructor(parentDom: HTMLElement, engine?: RipgrepService, history?: SearchHistory) {
		super();
		this._engine = engine ?? new RipgrepService();
		this._history = history ?? new SearchHistory({ storageKey: 'dc.searchEditor.history' });
		this._fileFilters = new SearchFileIncludes();

		CssInjector.inject(SEARCH_EDITOR_STYLE_ID, `
			.dc-search-editor-input { background: #3c3c3c; border: none; border-radius: 2px; color: #cccccc; font-size: 13px; padding: 5px 10px; outline: none; box-sizing: border-box; }
			.dc-search-editor-input:focus { border: 1px solid #007fd4; }
		`);

		this._container = $<HTMLElement>('div', 'dc-search-editor');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'display:flex;gap:6px;align-items:center;padding:10px 12px;border-bottom:1px solid #2a2d2e;flex-wrap:wrap;';

		this._queryInput = $<HTMLInputElement>('input', 'dc-search-editor-input');
		this._queryInput.placeholder = 'Cari di workspace';
		this._queryInput.style.flex = '1';
		this._queryInput.spellcheck = false;

		const searchButton = $<HTMLButtonElement>('button');
		searchButton.textContent = 'Cari';
		searchButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:5px 14px;font-size:12px;cursor:pointer;';

		this._includeInput = $<HTMLInputElement>('input', 'dc-search-editor-input');
		this._includeInput.placeholder = 'Sertakan file (*.ts)';
		this._includeInput.style.width = '150px';

		this._excludeInput = $<HTMLInputElement>('input', 'dc-search-editor-input');
		this._excludeInput.placeholder = 'Kecualikan file';
		this._excludeInput.style.width = '150px';

		const caseLabel = $<HTMLLabelElement>('label');
		caseLabel.style.cssText = 'display:flex;align-items:center;gap:4px;color:#cccccc;font-size:12px;user-select:none;';
		this._matchCaseToggle = $<HTMLInputElement>('input');
		this._matchCaseToggle.type = 'checkbox';
		caseLabel.appendChild(this._matchCaseToggle);
		caseLabel.appendChild(document.createTextNode('Aa'));

		const regexLabel = $<HTMLLabelElement>('label');
		regexLabel.style.cssText = 'display:flex;align-items:center;gap:4px;color:#cccccc;font-size:12px;user-select:none;';
		this._regexToggle = $<HTMLInputElement>('input');
		this._regexToggle.type = 'checkbox';
		regexLabel.appendChild(this._regexToggle);
		regexLabel.appendChild(document.createTextNode('.*'));

		toolbar.appendChild(this._queryInput);
		toolbar.appendChild(searchButton);
		toolbar.appendChild(this._includeInput);
		toolbar.appendChild(this._excludeInput);
		toolbar.appendChild(caseLabel);
		toolbar.appendChild(regexLabel);
		this._container.appendChild(toolbar);

		this._resultsContainer = $<HTMLElement>('div');
		this._resultsContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._resultsContainer);

		this._statusLabel = $<HTMLElement>('div');
		this._statusLabel.style.cssText = 'padding:4px 12px;color:#8a8a8a;font-size:11px;border-top:1px solid #2a2d2e;';
		this._container.appendChild(this._statusLabel);
		parentDom.appendChild(this._container);

		this._resultsTree = new SearchResultsTree(this._resultsContainer);

		this._register(this._engine.onDidSearchMatch(match => {
			this._lastMatches.push(match);
		}));
		this._register(this._engine.onDidSearchEnd(summary => {
			this._statusLabel.textContent = `${summary.resultCount} hasil di ${summary.fileCount} file (${summary.durationMs}ms, ${summary.engine})`;
			this._onDidChangeResults.fire(summary);
		}));
		this._register(this._engine.onDidSearchError(message => {
			this._statusLabel.textContent = message;
			this._statusLabel.style.color = '#f14c4c';
		}));
		this._register(this._resultsTree.onDidSelectMatch(match => {
			this._onDidSelectMatch.fire(match);
		}));
		this._register(addDisposableListener(searchButton, 'click', () => {
			void this.searchNow();
		}));
		this._register(addDisposableListener(this._queryInput, 'keydown', (e) => {
			if ((e as KeyboardEvent).key === 'Enter') {
				void this.searchNow();
			}
		}));
		this._register(addDisposableListener(this._queryInput, 'input', () => this._scheduleSearch()));
		this._register(addDisposableListener(this._includeInput, 'input', () => this._applyFilters()));
		this._register(addDisposableListener(this._excludeInput, 'input', () => this._applyFilters()));
		this._register(addDisposableListener(this._matchCaseToggle, 'change', () => this._scheduleSearch()));
		this._register(addDisposableListener(this._regexToggle, 'change', () => this._scheduleSearch()));
	}

	public setRoot(uri: URI): void {
		this._rootUri = uri;
	}

	public focus(): void {
		this._queryInput.focus();
	}

	public getQuery(): string {
		return this._queryInput.value;
	}

	public setQuery(query: string): void {
		this._queryInput.value = query;
	}

	public get matches(): ISearchMatch[] {
		return [...this._lastMatches];
	}

	public clearResults(): void {
		this._lastMatches = [];
		this._resultsTree.clear();
		this._statusLabel.textContent = '';
	}

	public async searchNow(): Promise<void> {
		const query = this._queryInput.value.trim();
		if (!query || !this._rootUri) {
			this._statusLabel.textContent = 'Masukkan kata kunci untuk memulai pencarian.';
			return;
		}
		this._history.push(query);
		this._applyFilters();
		this._lastMatches = [];
		this._resultsTree.clear();
		this._statusLabel.textContent = 'Mencari\u2026';
		this._statusLabel.style.color = '#8a8a8a';
		try {
			await this._engine.search(query, this._rootUri, this._getOptions());
			this._resultsTree.setResults(this._lastMatches);
		} catch (err) {
			this._statusLabel.textContent = `Pencarian gagal: ${String(err)}`;
			this._statusLabel.style.color = '#f14c4c';
		}
	}

	private _applyFilters(): void {
		this._fileFilters.setFromText(this._includeInput.value, this._excludeInput.value);
		const includes = this._fileFilters.includes;
		const excludes = this._fileFilters.excludes;
		const filtered = this._lastMatches.filter(match => {
			const rel = SearchFileIncludes.toRelativePath(match.resource.path, this._rootUri?.path ?? '');
			const included = includes.length === 0 || includes.some(p => SearchFileIncludes.matches(p, rel));
			const excluded = excludes.some(p => SearchFileIncludes.matches(p, rel));
			return included && !excluded;
		});
		this._resultsTree.setResults(filtered);
	}

	private _getOptions(): ISearchOptions {
		return {
			matchCase: this._matchCaseToggle.checked,
			wholeWord: false,
			isRegex: this._regexToggle.checked,
			includes: this._fileFilters.includes,
			excludes: this._fileFilters.excludes,
			maxResults: 2000
		};
	}

	private _scheduleSearch(): void {
		if (this._timer) {
			clearTimeout(this._timer);
		}
		this._timer = setTimeout(() => {
			void this.searchNow();
		}, 400);
	}

	public dispose(): void {
		this._engine.cancel();
		super.dispose();
	}
}
