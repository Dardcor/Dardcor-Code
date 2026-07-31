import { Emitter, Event } from '../../core/events/emitter.js';

export interface IExtensionCrashEvent {
	readonly extensionId: string;
	readonly restartCount: number;
	readonly willRestart: boolean;
}

export type ExtensionRestartListener = (event: IExtensionCrashEvent) => void;

export class ExtensionCrashHandler {
	public readonly maxRestarts = 3;
	private readonly _restartCounts = new Map<string, number>();
	private readonly _listeners: ExtensionRestartListener[] = [];
	private readonly _onDidCrash = new Emitter<IExtensionCrashEvent>();
	readonly onDidCrash: Event<IExtensionCrashEvent> = this._onDidCrash.event;

	public handleCrash(extensionId: string): boolean {
		const count = this.getRestartCount(extensionId) + 1;
		this._restartCounts.set(extensionId, count);
		const willRestart = count <= this.maxRestarts;
		const event: IExtensionCrashEvent = { extensionId, restartCount: count, willRestart };
		this._onDidCrash.fire(event);
		for (const listener of this._listeners) {
			try {
				listener(event);
			} catch {
			}
		}
		return willRestart;
	}

	public getRestartCount(extensionId: string): number {
		return this._restartCounts.get(extensionId) ?? 0;
	}

	public registerRestartListener(listener: ExtensionRestartListener): void {
		this._listeners.push(listener);
	}

	public reset(extensionId?: string): void {
		if (extensionId === undefined) {
			this._restartCounts.clear();
		} else {
			this._restartCounts.delete(extensionId);
		}
	}

	public getCrashCounts(): Map<string, number> {
		return new Map(this._restartCounts);
	}

	public shouldRestart(extensionId: string): boolean {
		return this.getRestartCount(extensionId) < this.maxRestarts;
	}
}
