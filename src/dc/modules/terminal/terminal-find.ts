/**
 * Dardcor Code - Terminal Buffer Text Find & Highlight
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';

export interface ITerminalFindMatch {
	readonly index: number;
	readonly start: number;
	readonly length: number;
}

export class TerminalFind extends Disposable {
	private readonly _onDidFind = this._register(new Emitter<ITerminalFindMatch | undefined>());
	readonly onDidFind: Event<ITerminalFindMatch | undefined> = this._onDidFind.event;

	private readonly _container: HTMLElement;
	private readonly _input: HTMLInputElement;
	private readonly _countLabel: HTMLElement;
	private readonly _matches: ITerminalFindMatch[] = [];
	private _query = '';
	private _activeMatch = -1;
	private _matchCase = false;
	private _visible = false;

	constructor(parentDom: HTMLElement) {
		super();

		this._container = $<HTMLElement>('div', 'dc-terminal-find');
		this._container.style.cssText = 'display:none;align-items:center;gap:6px;padding:4px 10px;background:#2a2d2e;border-bottom:1px solid #3c3c3c;';

		this._input = $<HTMLInputElement>('input');
		this._input.placeholder = 'Cari di terminal\u2026';
		this._input.style.cssText = 'background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:12px;padding:4px 8px;width:200px;outline:none;';
		this._input.spellcheck = false;

		this._countLabel = $<HTMLElement>('span');
		this._countLabel.style.cssText = 'color:#8a8a8a;font-size:11px;min-width:60px;';

		const prev = $<HTMLButtonElement>('button');
		prev.textContent = '\u2191';
		const next = $<HTMLButtonElement>('button');
		next.textContent = '\u2193';
		const close = $<HTMLButtonElement>('button');
		close.textContent = '\u2715';
		for (const btn of [prev, next, close]) {
			btn.style.cssText = 'background:transparent;border:none;color:#cccccc;cursor:pointer;font-size:12px;padding:2px 6px;';
			btn.addEventListener('mouseenter', () => {
				btn.style.background = '#3c3c3c';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'transparent';
			});
		}

		this._container.appendChild(this._input);
		this._container.appendChild(this._countLabel);
		this._container.appendChild(prev);
		this._container.appendChild(next);
		this._container.appendChild(close);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._input, 'input', () => {
			this._query = this._input.value;
			this.find(this._query);
		}));
		this._register(addDisposableListener(this._input, 'keydown', (e) => {
			const ev = e as KeyboardEvent;
			if (ev.key === 'Enter') {
				ev.preventDefault();
				if (ev.shiftKey) {
					this.findPrevious();
				} else {
					this.findNext();
				}
			} else if (ev.key === 'Escape') {
				this.hide();
			}
		}));
		this._register(addDisposableListener(prev, 'click', () => this.findPrevious()));
		this._register(addDisposableListener(next, 'click', () => this.findNext()));
		this._register(addDisposableListener(close, 'click', () => this.hide()));
	}

	get isVisible(): boolean {
		return this._visible;
	}

	public show(): void {
		this._visible = true;
		this._container.style.display = 'flex';
		this._input.focus();
		this._input.select();
		this.find(this._query);
	}

	public hide(): void {
		this._visible = false;
		this._container.style.display = 'none';
		this.clear();
	}

	get query(): string {
		return this._query;
	}

	get activeMatch(): number {
		return this._activeMatch;
	}

	get matchCount(): number {
		return this._matches.length;
	}

	public find(query: string): ITerminalFindMatch | undefined {
		this._query = query;
		this._matches.length = 0;
		if (!query) {
			this._countLabel.textContent = '';
			this._activeMatch = -1;
			this._onDidFind.fire(undefined);
			return undefined;
		}
		this._onDidFind.fire(undefined);
		return undefined;
	}

	public setMatches(matches: ITerminalFindMatch[]): void {
		this._matches.splice(0, this._matches.length, ...matches);
		this._activeMatch = matches.length > 0 ? 0 : -1;
		this._updateCount();
	}

	public findNext(): void {
		if (this._matches.length === 0) {
			return;
		}
		this._activeMatch = (this._activeMatch + 1) % this._matches.length;
		this._updateCount();
		this._onDidFind.fire(this._matches[this._activeMatch]);
	}

	public findPrevious(): void {
		if (this._matches.length === 0) {
			return;
		}
		this._activeMatch = (this._activeMatch - 1 + this._matches.length) % this._matches.length;
		this._updateCount();
		this._onDidFind.fire(this._matches[this._activeMatch]);
	}

	public setMatchCase(matchCase: boolean): void {
		this._matchCase = matchCase;
		this.find(this._query);
	}

	public clear(): void {
		this._matches.length = 0;
		this._activeMatch = -1;
		this._countLabel.textContent = '';
		this._onDidFind.fire(undefined);
	}

	public static findMatchesInText(text: string, query: string, matchCase = false): ITerminalFindMatch[] {
		if (!query) {
			return [];
		}
		const matches: ITerminalFindMatch[] = [];
		const haystack = matchCase ? text : text.toLowerCase();
		const needle = matchCase ? query : query.toLowerCase();
		let index = 0;
		while (index < haystack.length) {
			const found = haystack.indexOf(needle, index);
			if (found === -1) {
				break;
			}
			matches.push({ index: matches.length, start: found, length: query.length });
			index = found + query.length;
		}
		return matches;
	}

	private _updateCount(): void {
		if (this._matches.length === 0) {
			this._countLabel.textContent = 'Tidak ada hasil';
			return;
		}
		this._countLabel.textContent = `${this._activeMatch + 1}/${this._matches.length}`;
	}
}
