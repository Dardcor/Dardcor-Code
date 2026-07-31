import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IProgressOptions {
	location: unknown;
	title?: string;
	cancellable?: boolean;
}

export interface IProgress<T> {
	report(value: T): void;
}

export interface IProgressTask<T> {
	(progress: IProgress<T>): Promise<unknown>;
}

export interface IProgressEvent {
	readonly id: number;
	readonly type: 'start' | 'report' | 'end';
	readonly options?: IProgressOptions;
	readonly value?: unknown;
}

export type ProgressListener = (event: IProgressEvent) => void;

export class ExtHostProgress extends Disposable {
	private readonly _listeners: ProgressListener[] = [];
	private _nextId = 1;

	private readonly _onDidReportProgress = this._register(new Emitter<IProgressEvent>());
	readonly onDidReportProgress: Event<IProgressEvent> = this._onDidReportProgress.event;

	public async withProgress<R>(options: IProgressOptions, task: IProgressTask<R>): Promise<R> {
		const id = this._nextId++;
		const listeners = [...this._listeners];
		const progress: IProgress<R> = {
			report: (value: R) => {
				const event: IProgressEvent = { id, type: 'report', value };
				this._onDidReportProgress.fire(event);
				for (const listener of listeners) {
					listener(event);
				}
			}
		};
		const startEvent: IProgressEvent = { id, type: 'start', options };
		this._onDidReportProgress.fire(startEvent);
		for (const listener of listeners) {
			listener(startEvent);
		}
		try {
			return (await Promise.resolve(task(progress))) as R;
		} finally {
			const endEvent: IProgressEvent = { id, type: 'end' };
			this._onDidReportProgress.fire(endEvent);
			for (const listener of listeners) {
				listener(endEvent);
			}
		}
	}

	public addProgressListener(listener: ProgressListener): IDisposable {
		this._listeners.push(listener);
		return toDisposable(() => {
			const index = this._listeners.indexOf(listener);
			if (index !== -1) {
				this._listeners.splice(index, 1);
			}
		});
	}

	public override dispose(): void {
		this._listeners.length = 0;
		super.dispose();
	}
}

let sharedProgress: ExtHostProgress | undefined;

export function withProgress<R>(options: IProgressOptions, task: IProgressTask<R>): Promise<R> {
	return getExtHostProgress().withProgress(options, task);
}

export function getExtHostProgress(): ExtHostProgress {
	if (!sharedProgress) {
		sharedProgress = new ExtHostProgress();
	}
	return sharedProgress;
}
