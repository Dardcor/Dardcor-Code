/**
 * Dardcor Code - Status Bar Total Error & Warning Count Indicator
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';
import { DiagnosticsModel } from './diagnostics-model';

export interface IDiagnosticsStatusbarState {
	readonly errorCount: number;
	readonly warningCount: number;
	readonly infoCount: number;
	readonly totalCount: number;
}

export class DiagnosticsStatusbar extends Disposable {
	private readonly _onDidClick = this._register(new Emitter<void>());
	readonly onDidClick: Event<void> = this._onDidClick.event;

	private readonly _onDidChange = this._register(new Emitter<IDiagnosticsStatusbarState>());
	readonly onDidChange: Event<IDiagnosticsStatusbarState> = this._onDidChange.event;

	private readonly _element: HTMLElement;
	private readonly _model: DiagnosticsModel;
	private _state: IDiagnosticsStatusbarState = { errorCount: 0, warningCount: 0, infoCount: 0, totalCount: 0 };

	constructor(parentDom: HTMLElement, model?: DiagnosticsModel) {
		super();
		this._model = model ?? new DiagnosticsModel();

		this._element = $<HTMLElement>('span', 'dc-diagnostics-statusbar');
		this._element.style.cssText = 'display:inline-flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;user-select:none;color:#cccccc;padding:0 6px;height:100%;';
		this._element.title = 'Buka panel Problems';
		this._element.addEventListener('click', () => this._onDidClick.fire());

		parentDom.appendChild(this._element);
		this._register(this._model.onDidChange(() => this.update()));
		this.update();
	}

	get element(): HTMLElement {
		return this._element;
	}

	get model(): DiagnosticsModel {
		return this._model;
	}

	get state(): IDiagnosticsStatusbarState {
		return this._state;
	}

	public update(): void {
		this._state = {
			errorCount: this._model.errorCount,
			warningCount: this._model.warningCount,
			infoCount: this._model.infoCount,
			totalCount: this._model.totalCount
		};

		this._element.textContent = '';
		this._element.appendChild(this._createCount(this._model.errorCount, '\u2715', '#f14c4c'));
		this._element.appendChild(this._createCount(this._model.warningCount, '\u26A0', '#e5e510'));
		this._element.appendChild(this._createCount(this._model.infoCount, '\u2139', '#3794ff'));
		this._onDidChange.fire(this._state);
	}

	public setModel(model: DiagnosticsModel): void {
		(this._model as unknown as DiagnosticsModel) = model;
		this.update();
	}

	private _createCount(count: number, icon: string, color: string): HTMLElement {
		const span = $<HTMLElement>('span');
		if (count === 0) {
			span.style.opacity = '0.45';
		}
		span.style.cssText = `color:${color};display:inline-flex;align-items:center;gap:3px;`;
		span.textContent = `${icon} ${count}`;
		return span;
	}
}
