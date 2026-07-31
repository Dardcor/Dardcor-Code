import { globalShortcut } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter } from '../../core/events/emitter';

export interface ShortcutRegistration {
	accelerator: string;
	callback: () => void;
}

export class GlobalShortcuts extends Disposable {
	private readonly _registrations = new Map<string, () => void>();
	private readonly _onDidFailRegister = new Emitter<{ accelerator: string; error: string }>();
	public readonly onDidFailRegister = this._onDidFailRegister.event;

	constructor() {
		super();
		this._register(this._onDidFailRegister);
		this._register(toDisposable(() => this.unregisterAll()));
	}

	public register(accelerator: string, callback: () => void): boolean {
		if (this._registrations.has(accelerator)) {
			return this.isRegistered(accelerator);
		}
		try {
			const wrapped = (): void => {
				try {
					callback();
				} catch (err) {
					console.error(`[global-shortcuts] callback for '${accelerator}' failed:`, err);
				}
			};
			const success = globalShortcut.register(accelerator, wrapped);
			if (success) {
				this._registrations.set(accelerator, wrapped);
			}
			return success;
		} catch (err) {
			this._onDidFailRegister.fire({ accelerator, error: String(err) });
			return false;
		}
	}

	public registerMany(registrations: ShortcutRegistration[]): { success: string[]; failed: string[] } {
		const success: string[] = [];
		const failed: string[] = [];
		for (const registration of registrations) {
			if (this.register(registration.accelerator, registration.callback)) {
				success.push(registration.accelerator);
			} else {
				failed.push(registration.accelerator);
			}
		}
		return { success, failed };
	}

	public unregister(accelerator: string): void {
		try {
			globalShortcut.unregister(accelerator);
		} catch {
			// Ignore.
		}
		this._registrations.delete(accelerator);
	}

	public unregisterAll(): void {
		try {
			globalShortcut.unregisterAll();
		} catch {
			// Ignore.
		}
		this._registrations.clear();
	}

	public isRegistered(accelerator: string): boolean {
		try {
			return globalShortcut.isRegistered(accelerator);
		} catch {
			return false;
		}
	}

	public getRegisteredAccelerators(): string[] {
		return [...this._registrations.keys()];
	}

	public get count(): number {
		return this._registrations.size;
	}

	public override dispose(): void {
		this.unregisterAll();
		super.dispose();
	}
}

export function createGlobalShortcuts(): GlobalShortcuts {
	return new GlobalShortcuts();
}

export function registerGlobalShortcut(accelerator: string, callback: () => void): boolean {
	try {
		return globalShortcut.register(accelerator, callback);
	} catch (err) {
		console.warn(`[global-shortcuts] failed to register '${accelerator}':`, err);
		return false;
	}
}

export function unregisterGlobalShortcut(accelerator: string): void {
	try {
		globalShortcut.unregister(accelerator);
	} catch {
		// Ignore.
	}
}

export function unregisterAllGlobalShortcuts(): void {
	try {
		globalShortcut.unregisterAll();
	} catch {
		// Ignore.
	}
}

export function isGlobalShortcutRegistered(accelerator: string): boolean {
	try {
		return globalShortcut.isRegistered(accelerator);
	} catch {
		return false;
	}
}
