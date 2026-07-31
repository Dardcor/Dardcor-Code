/**
 * Dardcor Code - Pause on Uncaught Exceptions Configuration Checkboxes
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, addDisposableListener } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';

const EXCEPTION_BREAKPOINTS_STYLE_ID = 'dc-exception-breakpoints-styles';

export interface IExceptionBreakpointFilters {
	readonly uncaught: boolean;
	readonly caught: boolean;
}

export interface IExceptionFilterRequest {
	readonly filters: string[];
	readonly applied: boolean;
}

export class ExceptionBreakpoints extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<IExceptionBreakpointFilters>());
	readonly onDidChange: Event<IExceptionBreakpointFilters> = this._onDidChange.event;

	private readonly _onDidApply = this._register(new Emitter<IExceptionFilterRequest>());
	readonly onDidApply: Event<IExceptionFilterRequest> = this._onDidApply.event;

	private _filters: IExceptionBreakpointFilters = { uncaught: true, caught: false };

	public get filters(): IExceptionBreakpointFilters {
		return { ...this._filters };
	}

	public setUncaught(enabled: boolean): void {
		this._filters = { ...this._filters, uncaught: enabled };
		this._notify();
	}

	public setCaught(enabled: boolean): void {
		this._filters = { ...this._filters, caught: enabled };
		this._notify();
	}

	public setFilters(filters: IExceptionBreakpointFilters): void {
		this._filters = { ...filters };
		this._notify();
	}

	public toDapFilters(): string[] {
		const result: string[] = [];
		if (this._filters.uncaught) {
			result.push('uncaught');
		}
		if (this._filters.caught) {
			result.push('caught');
		}
		return result;
	}

	public render(container: HTMLElement): void {
		CssInjector.inject(EXCEPTION_BREAKPOINTS_STYLE_ID, `
			.dc-exception-row { display: flex; align-items: center; gap: 6px; padding: 4px 10px; cursor: pointer; user-select: none; font-size: 13px; color: #cccccc; }
			.dc-exception-row:hover { background: #2a2d2e; }
		`);
		container.textContent = '';

		const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): void => {
			const row = $<HTMLElement>('div', 'dc-exception-row');
			const checkbox = $<HTMLInputElement>('input');
			checkbox.type = 'checkbox';
			checkbox.checked = get();
			checkbox.style.cssText = 'accent-color:#007fd4;margin:0;';
			const text = $<HTMLElement>('span');
			text.textContent = label;
			row.appendChild(checkbox);
			row.appendChild(text);
			this._register(addDisposableListener(checkbox, 'change', () => set(checkbox.checked)));
			container.appendChild(row);
		};

		toggle('Pause on Uncaught Exceptions', () => this._filters.uncaught, v => this.setUncaught(v));
		toggle('Pause on Caught Exceptions', () => this._filters.caught, v => this.setCaught(v));
	}

	private _notify(): void {
		this._onDidChange.fire(this.filters);
		this._onDidApply.fire({ filters: this.toDapFilters(), applied: this.toDapFilters().length > 0 });
	}
}
