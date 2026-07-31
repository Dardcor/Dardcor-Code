/**
 * Dardcor Code - Watch Evaluation Expression List Component
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { DebugSession, DebugState } from './debug-session.js';

export interface IWatchEntry {
	expression: string;
	result: string;
	type?: string;
	evaluating: boolean;
	error?: string;
}

export class WatchView extends Disposable {
	private readonly _onDidAddExpression = this._register(new Emitter<string>());
	readonly onDidAddExpression: Event<string> = this._onDidAddExpression.event;

	private readonly _container: HTMLElement;
	private readonly _input: HTMLInputElement;
	private _entries = new Map<string, IWatchEntry>();

	constructor(parentDom: HTMLElement, private readonly _session: DebugSession) {
		super();
		this._container = $<HTMLElement>('div', 'dc-watch-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;';
		parentDom.appendChild(this._container);

		const inputRow = $<HTMLElement>('div');
		inputRow.style.cssText = 'display:flex;gap:4px;padding:4px 8px;';

		this._input = $<HTMLInputElement>('input');
		this._input.placeholder = 'Tambah ekspresi watch';
		this._input.style.cssText = 'flex:1;background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:12px;padding:3px 6px;outline:none;';

		const addButton = $<HTMLButtonElement>('button');
		addButton.textContent = '+';
		addButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:2px 8px;cursor:pointer;font-size:12px;';

		inputRow.appendChild(this._input);
		inputRow.appendChild(addButton);
		this._container.appendChild(inputRow);

		this._listContainer = $<HTMLElement>('div', 'dc-watch-list');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);

		this._register(addDisposableListener(addButton, 'click', () => this._addExpression()));
		this._register(addDisposableListener(this._input, 'keydown', (e) => {
			if ((e as KeyboardEvent).key === 'Enter') {
				this._addExpression();
			}
		}));
		this._register(this._session.onDidChangeState(state => {
			if (state === DebugState.Stopped || state === DebugState.Paused) {
				this.refreshValues();
			} else if (state === DebugState.Exited) {
				this._invalidateResults();
			}
		}));
	}

	private _listContainer: HTMLElement;

	public get expressions(): string[] {
		return [...this._entries.keys()];
	}

	public addExpression(expression: string): void {
		const trimmed = expression.trim();
		if (!trimmed || this._entries.has(trimmed)) {
			return;
		}
		this._entries.set(trimmed, { expression: trimmed, result: '', evaluating: false });
		this._onDidAddExpression.fire(trimmed);
		this.refreshValues();
	}

	private _addExpression(): void {
		const value = this._input.value;
		this._input.value = '';
		this.addExpression(value);
	}

	public async refreshValues(): Promise<void> {
		for (const [expression, entry] of this._entries) {
			if (entry.evaluating) {
				continue;
			}
			entry.evaluating = true;
			entry.error = undefined;
			try {
				const result = await this._session.evaluate(expression);
				entry.result = result.result;
				entry.type = result.type;
			} catch (err) {
				entry.error = String(err);
				entry.result = '';
			} finally {
				entry.evaluating = false;
			}
			this.render();
		}
	}

	public removeExpression(expression: string): void {
		this._entries.delete(expression);
		this.render();
	}

	public clear(): void {
		this._entries.clear();
		this.render();
	}

	private _invalidateResults(): void {
		for (const entry of this._entries.values()) {
			entry.result = '';
			entry.error = undefined;
			entry.evaluating = false;
		}
		this.render();
	}

	public render(): void {
		clearNode(this._listContainer);
		if (this._entries.size === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada ekspresi watch';
			empty.style.cssText = 'padding:4px 8px;color:#8a8a8a;font-size:12px;';
			this._listContainer.appendChild(empty);
			return;
		}
		for (const entry of this._entries.values()) {
			this._renderEntry(entry);
		}
	}

	private _renderEntry(entry: IWatchEntry): void {
		const row = $<HTMLElement>('div', 'dc-watch-entry');
		row.style.cssText = 'display:flex;align-items:baseline;gap:6px;padding:2px 8px;font-size:12px;user-select:none;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});

		const expression = $<HTMLElement>('span');
		expression.textContent = entry.expression;
		expression.style.cssText = 'color:#9cdcfe;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		expression.title = entry.expression;

		const equals = $<HTMLElement>('span');
		equals.textContent = '=';
		equals.style.cssText = 'color:#8a8a8a;';

		const value = $<HTMLElement>('span');
		value.style.cssText = 'color:#ce9178;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		if (entry.evaluating) {
			value.textContent = 'mengevaluasi\u2026';
			value.style.color = '#8a8a8a';
		} else if (entry.error) {
			value.textContent = entry.error;
			value.style.color = '#f14c4c';
		} else {
			value.textContent = entry.result || '(kosong)';
		}

		const removeButton = $<HTMLButtonElement>('button');
		removeButton.textContent = '\u2716';
		removeButton.title = 'Hapus';
		removeButton.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:10px;visibility:hidden;';
		row.addEventListener('mouseenter', () => {
			removeButton.style.visibility = 'visible';
		});
		row.addEventListener('mouseleave', () => {
			removeButton.style.visibility = 'hidden';
		});
		removeButton.addEventListener('click', () => {
			this.removeExpression(entry.expression);
		});

		row.appendChild(expression);
		row.appendChild(equals);
		row.appendChild(value);
		row.appendChild(removeButton);
		this._listContainer.appendChild(row);
	}
}
