/**
 * Dardcor Code - Outline Symbol View Pane Container
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { OutlineView, OutlineParser, IOutlineSymbol, getOutlineDocumentId } from './outline-view.js';
import { OutlineFilter } from './outline-filter.js';

const OUTLINE_PANE_STYLE_ID = 'dc-outline-pane-styles';

export class OutlinePane extends Disposable {
	private readonly _onDidSelectSymbol = this._register(new Emitter<IOutlineSymbol>());
	readonly onDidSelectSymbol: Event<IOutlineSymbol> = this._onDidSelectSymbol.event;

	private readonly _container: HTMLElement;
	private readonly _header: HTMLElement;
	private readonly _documentLabel: HTMLElement;
	private readonly _filter: OutlineFilter;
	private readonly _outline: OutlineView;
	private _documentUri: URI | undefined;
	private _documentSource = '';

	constructor(parentDom: HTMLElement, filter?: OutlineFilter) {
		super();
		this._filter = filter ?? new OutlineFilter();

		CssInjector.inject(OUTLINE_PANE_STYLE_ID, `
			.dc-outline-pane-header { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid #2a2d2e; }
			.dc-outline-pane-refresh { background: transparent; border: none; color: #cccccc; cursor: pointer; font-size: 13px; }
			.dc-outline-pane-doc { font-size: 12px; color: #8a8a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
		`);

		this._container = $<HTMLElement>('div', 'dc-outline-pane');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		this._header = $<HTMLElement>('div', 'dc-outline-pane-header');

		const title = $<HTMLElement>('span');
		title.textContent = 'OUTLINE';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;text-transform:uppercase;';

		const refresh = $<HTMLButtonElement>('button', 'dc-outline-pane-refresh');
		refresh.textContent = '\u21BB';
		refresh.title = 'Refresh Outline';
		refresh.addEventListener('click', () => this.refresh());

		this._documentLabel = $<HTMLElement>('span', 'dc-outline-pane-doc');
		this._documentLabel.textContent = 'Belum ada dokumen';

		this._header.appendChild(title);
		this._header.appendChild(refresh);
		this._header.appendChild(this._documentLabel);
		this._container.appendChild(this._header);

		const filterContainer = $<HTMLElement>('div');
		filterContainer.style.cssText = 'padding:8px;border-bottom:1px solid #2a2d2e;';
		filterContainer.appendChild(this._filter.input);
		this._container.appendChild(filterContainer);

		this._outline = new OutlineView(this._container, this._filter);

		parentDom.appendChild(this._container);

		this._register(this._outline.onDidSelectSymbol(symbol => this._onDidSelectSymbol.fire(symbol)));
		this._register(this._filter.onDidChange(() => this._outline.render()));
	}

	get filter(): OutlineFilter {
		return this._filter;
	}

	get outline(): OutlineView {
		return this._outline;
	}

	get documentUri(): URI | undefined {
		return this._documentUri;
	}

	public setDocument(uri: URI, source: string, languageId?: string): void {
		this._documentUri = uri;
		this._documentSource = source;
		this._documentLabel.textContent = Path.basename(uri.path);
		this._documentLabel.title = getOutlineDocumentId(uri);
		this._outline.setDocument(uri, source, languageId);
	}

	public setSource(source: string, languageId?: string): void {
		this._documentSource = source;
		if (this._documentUri) {
			this._outline.setDocument(this._documentUri, source, languageId);
		}
	}

	public clear(): void {
		this._documentUri = undefined;
		this._documentSource = '';
		this._documentLabel.textContent = 'Belum ada dokumen';
		this._outline.clear();
	}

	public refresh(): void {
		if (this._documentUri) {
			this._outline.setDocument(this._documentUri, this._documentSource);
		}
	}

	public setActiveLine(line: number): void {
		this._outline.setActiveLine(line);
	}

	public static parseSource(source: string, languageId?: string): IOutlineSymbol[] {
		return OutlineParser.parse(source, languageId);
	}

	public focusFilter(): void {
		this._filter.focus();
	}
}
