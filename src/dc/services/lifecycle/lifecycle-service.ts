/**
 * Dardcor Code - App Lifecycle Shutdown Gatekeeper (Task 132)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export enum LifecyclePhase {
	Starting = 1,
	Ready = 2,
	Restored = 3,
	Running = 4
}

export enum LifecycleShutdownReason {
	Load = 1,
	Quit = 2,
	Reload = 3,
	WindowClosed = 4,
	Crash = 5
}

export interface IWillShutdownEvent {
	readonly reason: LifecycleShutdownReason;
	readonly join: (promise: Promise<void>) => void;
}

export interface ILifecycleService {
	readonly _serviceBrand: undefined;
	readonly phase: LifecyclePhase;
	readonly isShuttingDown: boolean;
	readonly onDidChangePhase: Event<LifecyclePhase>;
	readonly onBeforeShutdown: Event<IWillShutdownEvent>;
	readonly onWillShutdown: Event<IWillShutdownEvent>;
	setPhase(phase: LifecyclePhase): void;
	shutdown(reason: LifecycleShutdownReason): Promise<void>;
}

export const ILifecycleService = createDecorator<ILifecycleService>('lifecycleService');

const SHUTDOWN_TIMEOUT_MS = 5000;

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LifecycleService extends Disposable implements ILifecycleService {
	declare readonly _serviceBrand: undefined;

	private _phase: LifecyclePhase = LifecyclePhase.Starting;
	private _shuttingDown = false;

	private readonly _onDidChangePhase = this._register(new Emitter<LifecyclePhase>());
	readonly onDidChangePhase = this._onDidChangePhase.event;

	private readonly _onBeforeShutdown = this._register(new Emitter<IWillShutdownEvent>());
	readonly onBeforeShutdown = this._onBeforeShutdown.event;

	private readonly _onWillShutdown = this._register(new Emitter<IWillShutdownEvent>());
	readonly onWillShutdown = this._onWillShutdown.event;

	public get phase(): LifecyclePhase {
		return this._phase;
	}

	public get isShuttingDown(): boolean {
		return this._shuttingDown;
	}

	public setPhase(phase: LifecyclePhase): void {
		if (phase <= this._phase) {
			return;
		}
		this._phase = phase;
		this._onDidChangePhase.fire(phase);
	}

	public async shutdown(reason: LifecycleShutdownReason): Promise<void> {
		if (this._shuttingDown) {
			return;
		}
		this._shuttingDown = true;

		const beforeJoins: Promise<void>[] = [];
		const beforeEvent: IWillShutdownEvent = { reason, join: (p) => beforeJoins.push(p) };
		this._onBeforeShutdown.fire(beforeEvent);
		await Promise.race([Promise.all(beforeJoins), wait(SHUTDOWN_TIMEOUT_MS)]);

		const willJoins: Promise<void>[] = [];
		const willEvent: IWillShutdownEvent = { reason, join: (p) => willJoins.push(p) };
		this._onWillShutdown.fire(willEvent);
		await Promise.race([Promise.all(willJoins), wait(SHUTDOWN_TIMEOUT_MS)]);
	}
}
