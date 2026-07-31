import { powerMonitor } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export interface BatteryStatus {
	onBattery: boolean;
	level: number;
	batterySaverEnabled: boolean;
	timestamp: number;
}

const LOW_BATTERY_THRESHOLD = 0.2;

export class BatterySaver extends Disposable {
	private _onBattery = false;
	private _level = 1;
	private _monitoring = false;
	private readonly _onDidChange = new Emitter<BatteryStatus>();
	public readonly onDidChange = this._onDidChange.event;

	constructor() {
		super();
		this._register(this._onDidChange);
		this._register(toDisposable(() => this.stop()));
	}

	public start(): void {
		if (this._monitoring) {
			return;
		}
		this._monitoring = true;
		this._syncLevel();

		const onBatteryListener = (): void => {
			this._onBattery = true;
			this._syncLevel();
		};
		const onAcListener = (): void => {
			this._onBattery = false;
			this._syncLevel();
		};
		const batteryStatusListener = (): void => {
			this._syncLevel();
		};

		powerMonitor.on('on-battery', onBatteryListener);
		powerMonitor.on('on-ac', onAcListener);
		if (typeof (powerMonitor as any).on === 'function') {
			try {
				(powerMonitor as any).on('battery-status', batteryStatusListener);
			} catch {
				// Not available on this platform.
			}
		}

		this._register(toDisposable(() => {
			powerMonitor.removeListener('on-battery', onBatteryListener);
			powerMonitor.removeListener('on-ac', onAcListener);
			try {
				(powerMonitor as any).removeListener('battery-status', batteryStatusListener);
			} catch {
				// Ignore.
			}
		}));
	}

	public stop(): void {
		this._monitoring = false;
	}

	public isBatterySaverEnabled(): boolean {
		return this._onBattery && this._level <= LOW_BATTERY_THRESHOLD;
	}

	public getBatteryLevel(): number {
		this._syncLevel();
		return this._level;
	}

	public getStatus(): BatteryStatus {
		this._syncLevel();
		return {
			onBattery: this._onBattery,
			level: this._level,
			batterySaverEnabled: this.isBatterySaverEnabled(),
			timestamp: Date.now()
		};
	}

	public isMonitoring(): boolean {
		return this._monitoring;
	}

	private _syncLevel(): void {
		let level = 1;
		try {
			const value = (powerMonitor as any).getBatteryLevel?.();
			if (typeof value === 'number' && !isNaN(value)) {
				level = Math.max(0, Math.min(1, value));
			}
		} catch {
			// Level unavailable.
		}
		this._level = level;
		if (this._monitoring) {
			this._onDidChange.fire(this.getStatus());
		}
	}
}

export function createBatterySaver(): BatterySaver {
	return new BatterySaver();
}

export function isBatterySaverActive(): boolean {
	return new BatterySaver().isBatterySaverEnabled();
}

export function getBatteryLevel(): number {
	try {
		const level = (powerMonitor as any).getBatteryLevel?.();
		return typeof level === 'number' && !isNaN(level) ? level : 1;
	} catch {
		return 1;
	}
}
