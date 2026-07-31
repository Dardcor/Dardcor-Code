/**
 * Dardcor Code - Global Text Search Viewlet Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { URI } from '../../core/types/uri';
import { IFileService } from '../../services/files/file-service';
import { FileService } from '../../services/files/file-service';
import { DiskFileSystemProvider } from '../../services/files/disk-provider';
import { RipgrepService, ISearchOptions, ISearchMatch } from './ripgrep-service';
import { SearchResultsTree } from './search-results-tree';
import { SearchReplaceEngine } from './search-replace';

export interface ISearchViewletOptions {
	searchOnTypeDelay?: number;
	maxResults?: number;
}

const SEARCH_STYLE_ID = 'dc-search-viewlet-styles';

export class SearchViewlet extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _searchInput: HTMLInputElement;
	private readonly _replaceInput: HTMLInputElement;
	private readonly _matchCaseToggle: HTMLInputElement;
	private readonly _wholeWordToggle: HTMLInputElement;
	private readonly _regexToggle: HTMLInputElement;
	private readonly _excludeInput: HTMLInputElement;
	private readonly _statusLabel: HTMLElement;
	private readonly _resultsTree: SearchResultsTree;
	private readonly _engine: RipgrepService;
	private readonly _replaceEngine: SearchReplaceEngine;
	private readonly _fileService: IFileService;

	private _rootUri: URI | undefined;
	private _timer: any = undefined;
	private _lastMatches: ISearchMatch[] = [];

	private readonly _onDidSelectMatch = this._register(new Emitter<ISearchMatch>());
	readonly onDidSelectMatch: Event<ISearchMatch> = this._onDidSelectMatch.event;

	private readonly _onDidOpenEditor = this._register(new Emitter<URI>());
	readonly onDidOpenEditor: Event<URI> = this._onDidOpenEditor.event;

	constructor(parentDom: HTMLElement, fileService?: IFileService) {
		super();
		this._fileService = fileService ?? new FileService();
		if (!this._fileService.getProvider('file')) {
			this._fileService.registerProvider('file', new DiskFileSystemProvider());
		}

		CssInjector.inject(SEARCH_STYLE_ID, `
			.dc-search-input { background:#3c3c3c; border:none; border-radius:2px; color:#cccccc; font-size:13px; padding:4px 8px; outline:none; width:100%; box-sizing:border-box; }
			.dc-search-input:focus { border:1px solid #007fd4; }
			.dc-search-toggle { accent-color:#007fd4; margin-right:4px; }
			.dc-search-toggle-label { color:#cccccc; font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; user-select:none; }
			.dc-search-toggle-label:hover { color:#ffffff; }
		`);

		this._container = $<HTMLElement>('div', 'dc-search-viewlet');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		this._searchInput = $<HTMLInputElement>('input', 'dc-search-input');
		this._searchInput.placeholder = 'Cari (Ctrl+Shift+F)';
		this._searchInput.spellcheck = false;

		this._replaceInput = $<HTMLInputElement>('input', 'dc-search-input');
		this._replaceInput.placeholder = 'Ganti';
		this._replaceInput.spellcheck = false;

		const searchRow = $('div');
		searchRow.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:4px;';
		searchRow.appendChild(this._searchInput);

		const replaceRow = $('div');
		replaceRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
		const replaceBtn = $<HTMLButtonElement>('button');
		replaceBtn.textContent = 'Ganti Semua';
		replaceBtn.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:3px 8px;font-size:12px;cursor:pointer;';
		replaceRow.appendChild(this._replaceInput);
		replaceRow.appendChild(replaceBtn);
		searchRow.appendChild(replaceRow);

		const optionsRow = $('div');
		optionsRow.style.cssText = 'display:flex;gap:12px;padding:2px 8px;flex-wrap:wrap;';
		const toggle = (label: string): HTMLInputElement => {
			const checkbox = $<HTMLInputElement>('input', 'dc-search-toggle');
			checkbox.type = 'checkbox';
			const lbl = $<HTMLLabelElement>('label', 'dc-search-toggle-label');
			lbl.appendChild(checkbox);
			lbl.appendChild(document.createTextNode(label));
			optionsRow.appendChild(lbl);
			return checkbox;
		};
		this._matchCaseToggle = toggle('Aa');
		this._wholeWordToggle = toggle('\u25A0');
		this._regexToggle = toggle('.*');
		this._matchCaseToggle.title = 'Match Case';
		this._wholeWordToggle.title = 'Whole Word';
		this._regexToggle.title = 'Regex';

		const excludeRow = $('div');
		excludeRow.style.cssText = 'padding:0 8px 6px;display:flex;align-items:center;gap:4px;';
		this._excludeInput = $<HTMLInputElement>('input', 'dc-search-input');
		this._excludeInput.placeholder = 'Kecualikan file (mis. *.log)';
		excludeRow.appendChild(this._excludeInput);

		this._statusLabel = $('div', 'dc-search-status');
		this._statusLabel.style.cssText = 'padding:6px 8px;color:#8a8a8a;font-size:11px;border-top:1px solid #2a2d2e;';

		const resultsContainer = $<HTMLElement>('div', 'dc-search-results-container');
		resultsContainer.style.cssText = 'flex:1;overflow-y:auto;';

		this._container.appendChild(searchRow);
		this._container.appendChild(optionsRow);
		this._container.appendChild(excludeRow);
		this._container.appendChild(resultsContainer);
		this._container.appendChild(this._statusLabel);
		parentDom.appendChild(this._container);

		this._engine = new RipgrepService();
		this._resultsTree = new SearchResultsTree(resultsContainer);
		this._replaceEngine = new SearchReplaceEngine(this._fileService);

		this._register(this._engine.onDidSearchMatch(match => {
			this._lastMatches.push(match);
		}));
		this._register(this._engine.onDidSearchEnd(summary => {
			this._renderStatus(summary.resultCount, summary.fileCount, summary.durationMs, summary.engine);
		}));
		this._register(this._engine.onDidSearchError(message => {
			this._statusLabel.textContent = message;
			this._statusLabel.style.color = '#f14c4c';
		}));
		this._register(this._resultsTree.onDidSelectMatch(match => {
			this._onDidSelectMatch.fire(match);
		}));
		this._register(this._replaceEngine.onDidReplaceFile(result => {
			this._statusLabel.textContent = `Mengganti ${result.replacements} kemunculan di ${result.resource.path}`;
		}));

		this._register(addDisposableListener(this._searchInput, 'input', () => this._scheduleSearch()));
		this._register(addDisposableListener(this._searchInput, 'keydown', (e) => {
			const kd = e as KeyboardEvent;
			if (kd.key === 'Enter') {
				this.searchNow();
			}
		}));
		for (const toggleEl of [this._matchCaseToggle, this._wholeWordToggle, this._regexToggle, this._excludeInput]) {
			this._register(addDisposableListener(toggleEl, 'change', () => this._scheduleSearch()));
		}
		this._register(addDisposableListener(replaceBtn, 'click', () => this._replaceAll()));
	}

	public setRoot(uri: URI): void {
		this._rootUri = uri;
	}

	public focus(): void {
		this._searchInput.focus();
	}

	public getQuery(): string {
		return this._searchInput.value;
	}

	private _getOptions(): ISearchOptions {
		const excludes: string[] = [];
		const excludeText = this._excludeInput.value.trim();
		if (excludeText) {
			for (const part of excludeText.split(',')) {
				const trimmed = part.trim();
				if (trimmed) {
					excludes.push(trimmed);
				}
			}
		}
		return {
			matchCase: this._matchCaseToggle.checked,
			wholeWord: this._wholeWordToggle.checked,
			isRegex: this._regexToggle.checked,
			excludes,
			maxResults: 2000
		};
	}

	private _scheduleSearch(): void {
		if (this._timer) {
			clearTimeout(this._timer);
		}
		this._timer = setTimeout(() => this.searchNow(), 400);
	}

	public async searchNow(): Promise<void> {
		const query = this._searchInput.value.trim();
		if (!query || !this._rootUri) {
			return;
		}
		this._lastMatches = [];
		this._resultsTree.clear();
		this._statusLabel.textContent = 'Mencari\u2026';
		this._statusLabel.style.color = '#8a8a8a';
		try {
			await this._engine.search(query, this._rootUri, this._getOptions());
			const matches = this._lastMatches;
			this._resultsTree.setResults(matches);
		} catch (err) {
			this._statusLabel.textContent = `Gagal: ${String(err)}`;
			this._statusLabel.style.color = '#f14c4c';
		}
	}

	private _renderStatus(resultCount: number, fileCount: number, durationMs: number, engine: string): void {
		const query = this._searchInput.value.trim();
		const engineLabel = engine === 'rg' ? 'ripgrep' : 'fallback';
		this._statusLabel.textContent = `${resultCount} hasil di ${fileCount} file (${query}, ${engineLabel}, ${durationMs}ms)`;
		this._statusLabel.style.color = '#8a8a8a';
	}

	private async _replaceAll(): Promise<void> {
		const replaceText = this._replaceInput.value;
		const matches = this._lastMatches;
		if (matches.length === 0) {
			this._statusLabel.textContent = 'Tidak ada hasil untuk diganti';
			return;
		}
		this._statusLabel.textContent = 'Mengganti\u2026';
		const results = await this._replaceEngine.replaceAll(this._searchInput.value.trim(), replaceText, this._getOptions(), matches);
		const total = results.reduce((acc, r) => acc + r.replacements, 0);
		this._statusLabel.textContent = `Selesai: ${total} penggantian di ${results.length} file`;
		await this.searchNow();
	}

	public setReplacePreview(previews: { resource: URI; occurrences: number }[]): void {
		const text = previews.map(p => `${PathBasename(p.resource.path)} (${p.occurrences})`).join(', ');
		this._statusLabel.textContent = `Akan diganti: ${text}`;
	}

	public dispose(): void {
		this._engine.cancel();
		super.dispose();
	}
}

function PathBasename(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx === -1 ? path : path.substring(idx + 1);
}
