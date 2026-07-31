/**
 * Dardcor Code - Lifecycle Phase Tracker (Task 76)
 * Mirrors: vs/workbench/services/lifecycle/common/lifecycle.ts
 */

import { Emitter, Event } from '../events/emitter.js';
import { IDisposable } from '../lifecycle/disposable.js';

export const enum LifecyclePhase {
	Starting = 1,
	Ready = 2,
	Restored = 3,
	Eventually = 4,
}

export class LifecyclePhaseTracker implements IDisposable {
	private _phase: LifecyclePhase = LifecyclePhase.Starting;
	private readonly _onDidChangePhase = new Emitter<LifecyclePhase>();
	public readonly onDidChangePhase: Event<LifecyclePhase> = this._onDidChangePhase.event;
	private readonly _phaseWaiters = new Map<LifecyclePhase, Array<() => void>>();

	get phase(): LifecyclePhase {
		return this._phase;
	}

	set phase(value: LifecyclePhase) {
		if (value <= this._phase) return;
		this._phase = value;
		this._onDidChangePhase.fire(value);
		const waiters = this._phaseWaiters.get(value);
		if (waiters) {
			for (const resolve of waiters) resolve();
			this._phaseWaiters.delete(value);
		}
	}

	when(phase: LifecyclePhase): Promise<void> {
		if (this._phase >= phase) return Promise.resolve();
		return new Promise<void>(resolve => {
			let list = this._phaseWaiters.get(phase);
			if (!list) {
				list = [];
				this._phaseWaiters.set(phase, list);
			}
			list.push(resolve);
		});
	}

	dispose(): void {
		this._onDidChangePhase.dispose();
		this._phaseWaiters.clear();
	}
}
