/**
 * Dardcor Code - Inline Debug Variable Value Decoration Overlay
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { CssInjector } from '../../core/dom/css-injector.js';

export interface IInlineValue {
	readonly variableName: string;
	readonly value: string;
	readonly lineNumber: number;
	readonly column?: number;
	readonly expression?: string;
}

export type InlineValueKind = 'variable' | 'expression';

export class InlineValues extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _values = new Map<string, IInlineValue>();
	private _enabled = true;
	private _overlay: HTMLElement | undefined;

	constructor() {
		super();
		CssInjector.inject('dc-inline-values-styles', `
			.dc-inline-value {
				position:absolute; background:#094771; color:#9cdcfe;
				font-family:Consolas, monospace; font-size:11px; padding:1px 6px;
				border-radius:2px; white-space:nowrap; pointer-events:none; z-index:50;
				box-shadow:0 1px 3px rgba(0,0,0,0.4);
			}
		`);
	}

	get enabled(): boolean {
		return this._enabled;
	}

	public setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		if (!enabled) {
			this.clear();
		}
	}

	get values(): IInlineValue[] {
		return [...this._values.values()];
	}

	public setValue(key: string, value: IInlineValue): void {
		this._values.set(key, value);
		this._onDidChange.fire();
	}

	public removeValue(key: string): void {
		if (this._values.delete(key)) {
			this._onDidChange.fire();
		}
	}

	public clear(): void {
		if (this._values.size > 0) {
			this._values.clear();
			this._onDidChange.fire();
		}
	}

	public getValueForLine(lineNumber: number): IInlineValue | undefined {
		for (const value of this._values.values()) {
			if (value.lineNumber === lineNumber) {
				return value;
			}
		}
		return undefined;
	}

	public getValuesForLine(lineNumber: number): IInlineValue[] {
		return [...this._values.values()].filter(v => v.lineNumber === lineNumber);
	}

	public updateFromVariables(variables: Array<{ name: string; value: string; lineNumber: number; column?: number }>): void {
		this.clear();
		for (const variable of variables) {
			const key = `${variable.lineNumber}:${variable.name}`;
			this.setValue(key, {
				variableName: variable.name,
				value: variable.value,
				lineNumber: variable.lineNumber,
				column: variable.column
			});
		}
	}

	public renderOverlay(editor: HTMLElement): void {
		this.removeOverlay();
		if (!this._enabled || this._values.size === 0) {
			return;
		}
		this._overlay = document.createElement('div');
		this._overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:50;';
		for (const value of this._values.values()) {
			const badge = document.createElement('span');
			badge.className = 'dc-inline-value';
			badge.textContent = `${value.variableName} = ${value.value}`;
			const lineEl = editor.querySelector(`[data-line="${value.lineNumber}"]`);
			if (lineEl) {
				const rect = lineEl.getBoundingClientRect();
				const editorRect = editor.getBoundingClientRect();
				badge.style.top = `${rect.top - editorRect.top}px`;
				badge.style.left = `${rect.width + 8}px`;
			}
			this._overlay.appendChild(badge);
		}
		editor.appendChild(this._overlay);
	}

	public removeOverlay(): void {
		if (this._overlay) {
			this._overlay.remove();
			this._overlay = undefined;
		}
	}

	public static keyFor(lineNumber: number, name: string): string {
		return `${lineNumber}:${name}`;
	}

	public static truncate(value: string, maxLength = 120): string {
		if (value.length <= maxLength) {
			return value;
		}
		return `${value.slice(0, maxLength - 3)}\u2026`;
	}
}
