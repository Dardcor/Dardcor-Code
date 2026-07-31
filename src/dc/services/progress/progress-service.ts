/**
 * Dardcor Code - Progress Service Task Indicator Engine (Task 138)
 */

import { createDecorator } from '../instantiation/annotations';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';

export interface IProgressOptions {
	readonly title?: string;
	readonly location?: string;
	readonly cancellable?: boolean;
	readonly total?: number;
	readonly silent?: boolean;
}

export interface IProgressReport {
	readonly message?: string;
	readonly increment?: number;
	readonly total?: number;
	readonly work?: number;
}

export interface IProgress<T> {
	report(item: T): void;
}

export interface IProgressState {
	readonly id: number;
	readonly active: boolean;
	readonly title?: string;
	readonly message?: string;
	readonly percent?: number;
	readonly cancellable?: boolean;
}

export interface IProgressIndicator {
	readonly state: IProgressState;
	readonly onDidChange: Event<IProgressState>;
	report(report: IProgressReport): void;
	done(): void;
}

export interface IProgressService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProgress: Event<readonly IProgressState[]>;
	withProgress<T>(options: IProgressOptions, task: (progress: IProgress<IProgressReport>) => Promise<T>): Promise<T>;
	createIndicator(options: IProgressOptions): IProgressIndicator;
	getActiveIndicators(): IProgressState[];
	setProgressRenderer(renderer: (states: readonly IProgressState[]) => void): IDisposable;
}

export const IProgressService = createDecorator<IProgressService>('progressService');

interface MutableProgressState {
	id: number;
	active: boolean;
	title?: string;
	message?: string;
	percent?: number;
	cancellable?: boolean;
}

class ProgressIndicator extends Disposable implements IProgressIndicator {
	private readonly _onDidChange = this._register(new Emitter<IProgressState>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _state: MutableProgressState;

	constructor(
		options: IProgressOptions,
		id: number,
		private readonly _onStateChange: (indicator: ProgressIndicator) => void
	) {
		super();
		this._state = {
			id,
			active: true,
			title: options.title,
			message: undefined,
			percent: options.total !== undefined ? 0 : undefined,
			cancellable: options.cancellable
		};
	}

	get state(): IProgressState {
		return this._state;
	}

	public report(report: IProgressReport): void {
		if (report.message !== undefined) {
			this._state.message = report.message;
		}
		if (report.total !== undefined && this._state.percent === undefined) {
			this._state.percent = 0;
		}
		if (report.increment !== undefined && this._state.percent !== undefined) {
			this._state.percent = Math.min(100, this._state.percent + report.increment);
		}
		if (report.work !== undefined && report.total !== undefined && report.total > 0) {
			this._state.percent = Math.min(100, (report.work / report.total) * 100);
		}
		this._onStateChange(this);
		this._onDidChange.fire(this._state);
	}

	public done(): void {
		if (!this._state.active) {
			return;
		}
		this._state.active = false;
		this._state.percent = 100;
		this._onStateChange(this);
		this._onDidChange.fire(this._state);
		this.dispose();
	}
}

export class ProgressService extends Disposable implements IProgressService {
	declare readonly _serviceBrand: undefined;

	private readonly _indicators = new Map<number, ProgressIndicator>();
	private _nextId = 1;
	private _renderer: ((states: readonly IProgressState[]) => void) | null = null;

	private readonly _onDidChangeProgress = this._register(new Emitter<readonly IProgressState[]>());
	readonly onDidChangeProgress = this._onDidChangeProgress.event;

	public async withProgress<T>(options: IProgressOptions, task: (progress: IProgress<IProgressReport>) => Promise<T>): Promise<T> {
		const indicator = this.createIndicator(options);
		try {
			return await task({ report: (item) => indicator.report(item) });
		} finally {
			indicator.done();
		}
	}

	public createIndicator(options: IProgressOptions): IProgressIndicator {
		const indicator = new ProgressIndicator(options, this._nextId++, (changed) => this._onIndicatorChanged(changed));
		this._indicators.set(indicator.state.id, indicator);
		this._notifyChanged();
		return indicator;
	}

	public getActiveIndicators(): IProgressState[] {
		const states: IProgressState[] = [];
		for (const indicator of this._indicators.values()) {
			if (indicator.state.active) {
				states.push(indicator.state);
			}
		}
		return states;
	}

	public setProgressRenderer(renderer: (states: readonly IProgressState[]) => void): IDisposable {
		this._renderer = renderer;
		renderer(this.getActiveIndicators());
		return toDisposable(() => {
			if (this._renderer === renderer) {
				this._renderer = null;
			}
		});
	}

	private _onIndicatorChanged(indicator: ProgressIndicator): void {
		if (!indicator.state.active) {
			this._indicators.delete(indicator.state.id);
		}
		this._notifyChanged();
	}

	private _notifyChanged(): void {
		const states = this.getActiveIndicators();
		this._onDidChangeProgress.fire(states);
		try {
			this._renderer?.(states);
		} catch {
			// A failing renderer must not break progress bookkeeping.
		}
	}
}
