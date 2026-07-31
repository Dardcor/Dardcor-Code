import { powerMonitor } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface PowerMonitorHandlers {
	onSuspend?: () => void;
	onResume?: () => void;
	onLock?: () => void;
	onUnlock?: () => void;
	onShutdown?: () => void;
	onBatteryStatus?: (onBattery: boolean) => void;
	onAc?: () => void;
	onBattery?: () => void;
}

export function registerPowerMonitor(handlers: PowerMonitorHandlers = {}): () => void {
	const disposables: Array<() => void> = [];

	if (handlers.onSuspend) {
		const listener = (): void => handlers.onSuspend?.();
		powerMonitor.on('suspend', listener);
		disposables.push(() => powerMonitor.removeListener('suspend', listener));
	}
	if (handlers.onResume) {
		const listener = (): void => handlers.onResume?.();
		powerMonitor.on('resume', listener);
		disposables.push(() => powerMonitor.removeListener('resume', listener));
	}
	if (handlers.onLock) {
		const listener = (): void => handlers.onLock?.();
		powerMonitor.on('lock-screen', listener);
		disposables.push(() => powerMonitor.removeListener('lock-screen', listener));
	}
	if (handlers.onUnlock) {
		const listener = (): void => handlers.onUnlock?.();
		powerMonitor.on('unlock-screen', listener);
		disposables.push(() => powerMonitor.removeListener('unlock-screen', listener));
	}
	if (handlers.onShutdown) {
		const listener = (): void => handlers.onShutdown?.();
		powerMonitor.on('shutdown', listener);
		disposables.push(() => powerMonitor.removeListener('shutdown', listener));
	}
	if (handlers.onBatteryStatus) {
		const onBatteryListener = (): void => handlers.onBatteryStatus?.(true);
		const onAcListener = (): void => handlers.onBatteryStatus?.(false);
		powerMonitor.on('on-battery', onBatteryListener);
		powerMonitor.on('on-ac', onAcListener);
		disposables.push(() => {
			powerMonitor.removeListener('on-battery', onBatteryListener);
			powerMonitor.removeListener('on-ac', onAcListener);
		});
	}
	if (handlers.onAc) {
		const listener = (): void => handlers.onAc?.();
		powerMonitor.on('on-ac', listener);
		disposables.push(() => powerMonitor.removeListener('on-ac', listener));
	}
	if (handlers.onBattery) {
		const listener = (): void => handlers.onBattery?.();
		powerMonitor.on('on-battery', listener);
		disposables.push(() => powerMonitor.removeListener('on-battery', listener));
	}

	return () => {
		for (const dispose of disposables) {
			try {
				dispose();
			} catch {
				// Ignore.
			}
		}
	};
}

let lastOnBattery = false;
powerMonitor.on('on-battery', () => {
	lastOnBattery = true;
});
powerMonitor.on('on-ac', () => {
	lastOnBattery = false;
});

export function isOnBatteryPower(): boolean {
	return lastOnBattery;
}

export function getSystemIdleTime(): number {
	try {
		return powerMonitor.getSystemIdleTime();
	} catch {
		return 0;
	}
}

export class PowerMonitor extends Disposable {
	constructor() {
		super();
	}

	public register(handlers: PowerMonitorHandlers): void {
		this._register(toDisposable(registerPowerMonitor(handlers)));
	}

	public getBatteryLevel(): number {
		try {
			const level = (powerMonitor as any).getBatteryLevel?.();
			return typeof level === 'number' ? level : 1;
		} catch {
			return 1;
		}
	}
}

export function createPowerMonitor(): PowerMonitor {
	return new PowerMonitor();
}
