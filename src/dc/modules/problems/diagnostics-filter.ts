/**
 * Dardcor Code - Problem Severity Filter Toggles
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, addDisposableListener } from '../../core/dom/element.js';
import { DiagnosticSeverity } from './diagnostics-model.js';

export interface IDiagnosticsFilterState {
	readonly errors: boolean;
	readonly warnings: boolean;
	readonly info: boolean;
}

export const ALL_DIAGNOSTICS_FILTER: IDiagnosticsFilterState = { errors: true, warnings: true, info: true };

export class DiagnosticsFilter extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<IDiagnosticsFilterState>());
	readonly onDidChange: Event<IDiagnosticsFilterState> = this._onDidChange.event;

	private _state: IDiagnosticsFilterState = { ...ALL_DIAGNOSTICS_FILTER };

	get state(): IDiagnosticsFilterState {
		return this._state;
	}

	public setErrors(enabled: boolean): void {
		this._set({ ...this._state, errors: enabled });
	}

	public setWarnings(enabled: boolean): void {
		this._set({ ...this._state, warnings: enabled });
	}

	public setInfo(enabled: boolean): void {
		this._set({ ...this._state, info: enabled });
	}

	public toggleSeverity(severity: DiagnosticSeverity): void {
		if (severity === DiagnosticSeverity.Error) {
			this.setErrors(!this._state.errors);
		} else if (severity === DiagnosticSeverity.Warning) {
			this.setWarnings(!this._state.warnings);
		} else {
			this.setInfo(!this._state.info);
		}
	}

	public accepts(severity: DiagnosticSeverity): boolean {
		if (severity === DiagnosticSeverity.Error) {
			return this._state.errors;
		}
		if (severity === DiagnosticSeverity.Warning) {
			return this._state.warnings;
		}
		return this._state.info;
	}

	public render(container: HTMLElement): void {
		container.textContent = '';
		const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, color: string): HTMLInputElement => {
			const checkbox = $<HTMLInputElement>('input');
			checkbox.type = 'checkbox';
			checkbox.checked = get();
			checkbox.style.cssText = 'accent-color:#007fd4;margin:0;';
			const lbl = $<HTMLElement>('label');
			lbl.style.cssText = `display:flex;align-items:center;gap:4px;color:${color};font-size:12px;cursor:pointer;user-select:none;`;
			lbl.appendChild(checkbox);
			lbl.appendChild(document.createTextNode(label));
			this._register(addDisposableListener(checkbox, 'change', () => set(checkbox.checked)));
			container.appendChild(lbl);
			return checkbox;
		};
		toggle('Errors', () => this._state.errors, v => this.setErrors(v), '#f14c4c');
		toggle('Warnings', () => this._state.warnings, v => this.setWarnings(v), '#e5e510');
		toggle('Info', () => this._state.info, v => this.setInfo(v), '#3794ff');
	}

	private _set(state: IDiagnosticsFilterState): void {
		this._state = state;
		this._onDidChange.fire(state);
	}
}
