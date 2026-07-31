/**
 * Dardcor Code - Outline Symbol Type Filter Search Input
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { OutlineSymbolKind, IOutlineSymbol, getSymbolKindLabel } from './outline-view.js';

export interface IOutlineFilterState {
	readonly query: string;
	readonly kinds: ReadonlySet<OutlineSymbolKind>;
}

export class OutlineFilter extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<IOutlineFilterState>());
	readonly onDidChange: Event<IOutlineFilterState> = this._onDidChange.event;

	private readonly _input: HTMLInputElement;
	private readonly _kindContainer: HTMLElement;
	private _query = '';
	private _kinds = new Set<OutlineSymbolKind>();

	get state(): IOutlineFilterState {
		return { query: this._query, kinds: this._kinds };
	}

	constructor(parentDom?: HTMLElement) {
		super();
		this._input = $<HTMLInputElement>('input');
		this._input.placeholder = 'Filter simbol (mis. "get")';
		this._input.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:13px;padding:4px 8px;outline:none;';

		this._kindContainer = $<HTMLElement>('div');
		this._kindContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;';

		this._register(addDisposableListener(this._input, 'input', () => {
			this._query = this._input.value.trim().toLowerCase();
			this._onDidChange.fire(this.state);
		}));

		if (parentDom) {
			const wrapper = $<HTMLElement>('div');
			wrapper.style.cssText = 'padding:8px;border-bottom:1px solid #2a2d2e;';
			wrapper.appendChild(this._input);
			wrapper.appendChild(this._kindContainer);
			parentDom.appendChild(wrapper);
			this.renderKindToggles();
		}
	}

	get input(): HTMLInputElement {
		return this._input;
	}

	public setQuery(query: string): void {
		this._input.value = query;
		this._query = query.trim().toLowerCase();
		this._onDidChange.fire(this.state);
	}

	public toggleKind(kind: OutlineSymbolKind, enabled: boolean): void {
		if (enabled) {
			this._kinds.add(kind);
		} else {
			this._kinds.delete(kind);
		}
		this._onDidChange.fire(this.state);
	}

	public resetKinds(): void {
		this._kinds.clear();
		this._onDidChange.fire(this.state);
	}

	public filter(symbols: IOutlineSymbol[]): IOutlineSymbol[] {
		let result = symbols;
		if (this._kinds.size > 0) {
			result = result.filter(s => this._kinds.has(s.kind));
		}
		if (this._query) {
			result = result.filter(s => {
				return s.name.toLowerCase().includes(this._query)
					|| getSymbolKindLabel(s.kind).toLowerCase().includes(this._query);
			});
		}
		return result;
	}

	public renderKindToggles(): void {
		clearNode(this._kindContainer);
		const allKinds: OutlineSymbolKind[] = [
			OutlineSymbolKind.Class, OutlineSymbolKind.Function, OutlineSymbolKind.Method,
			OutlineSymbolKind.Interface, OutlineSymbolKind.Type, OutlineSymbolKind.Enum,
			OutlineSymbolKind.Variable, OutlineSymbolKind.Constant
		];
		for (const kind of allKinds) {
			const chip = $<HTMLElement>('span');
			chip.textContent = getSymbolKindLabel(kind);
			const active = this._kinds.has(kind);
			chip.style.cssText = `font-size:11px;border-radius:8px;padding:1px 8px;cursor:pointer;user-select:none;${active ? 'background:#0e639c;color:#ffffff;' : 'background:#3c3c3c;color:#cccccc;'}`;
			this._register(addDisposableListener(chip, 'click', () => {
				this.toggleKind(kind, !this._kinds.has(kind));
				this.renderKindToggles();
			}));
			this._kindContainer.appendChild(chip);
		}
	}

	public focus(): void {
		this._input.focus();
	}
}
