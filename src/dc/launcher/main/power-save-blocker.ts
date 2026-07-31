import { powerSaveBlocker } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';

export type PowerSaveType = 'prevent-app-suspension' | 'prevent-display-sleep';

export class PowerSaveBlocker extends Disposable {
	private _id: number | null = null;
	private _type: PowerSaveType = 'prevent-app-suspension';

	public start(type: PowerSaveType = 'prevent-app-suspension'): number | null {
		if (this._id !== null) {
			return this._id;
		}
		try {
			this._id = powerSaveBlocker.start(type);
			this._type = type;
			this._register(toDisposable(() => this.stop()));
			return this._id;
		} catch (err) {
			console.error('[power-save-blocker] start failed:', err);
			return null;
		}
	}

	public stop(): void {
		if (this._id === null) {
			return;
		}
		try {
			if (powerSaveBlocker.isStarted(this._id)) {
				powerSaveBlocker.stop(this._id);
			}
		} catch (err) {
			console.warn('[power-save-blocker] stop failed:', err);
		}
		this._id = null;
	}

	public isActive(): boolean {
		return this._id !== null && powerSaveBlocker.isStarted(this._id);
	}

	public get type(): PowerSaveType {
		return this._type;
	}

	public get id(): number | null {
		return this._id;
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}
}

export function createPowerSaveBlocker(type?: PowerSaveType): PowerSaveBlocker {
	const blocker = new PowerSaveBlocker();
	if (type) {
		blocker.start(type);
	}
	return blocker;
}

export function preventAppSuspension(): number | null {
	try {
		return powerSaveBlocker.start('prevent-app-suspension');
	} catch {
		return null;
	}
}

export function preventDisplaySleep(): number | null {
	try {
		return powerSaveBlocker.start('prevent-display-sleep');
	} catch {
		return null;
	}
}

export function stopPowerSaveBlocker(id: number): void {
	try {
		if (powerSaveBlocker.isStarted(id)) {
			powerSaveBlocker.stop(id);
		}
	} catch {
		// Ignore.
	}
}

export function isPowerSaveBlockerActive(id: number): boolean {
	try {
		return powerSaveBlocker.isStarted(id);
	} catch {
		return false;
	}
}

export function getPowerSaveBlockerIds(): number[] {
	const ids: number[] = [];
	for (let i = 0; i < 32; i++) {
		try {
			if (powerSaveBlocker.isStarted(i)) {
				ids.push(i);
			}
		} catch {
			break;
		}
	}
	return ids;
}
