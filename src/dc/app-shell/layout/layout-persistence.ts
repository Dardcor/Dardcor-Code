/**
 * Dardcor Code - Window Geometry & Panel Sizes State Saver
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IStorageService, StorageScope, StorageTarget } from '../../services/storage/storage-service.js';

export interface IWindowGeometry {
	readonly width: number;
	readonly height: number;
	readonly x: number;
	readonly y: number;
	readonly maximized: boolean;
}

export interface IPanelSizes {
	readonly sidebarWidth: number;
	readonly panelHeight: number;
	readonly panelPosition: 'bottom' | 'right' | 'left';
	readonly sidebarVisible: boolean;
	readonly panelVisible: boolean;
}

export interface IPersistedLayout {
	readonly geometry?: IWindowGeometry;
	readonly sizes: IPanelSizes;
	readonly version: number;
}

const STORAGE_KEY = 'dc.layout.v1';
const SAVE_DEBOUNCE_MS = 300;

export class LayoutPersistence extends Disposable {
	private readonly _storage: IStorageService;
	private readonly _windowTarget: Window;
	private _saveTimer: ReturnType<typeof setTimeout> | null = null;

	private readonly _onDidSave = this._register(new Emitter<IPersistedLayout>());
	readonly onDidSave: Event<IPersistedLayout> = this._onDidSave.event;

	private readonly _onDidRestore = this._register(new Emitter<IPersistedLayout | null>());
	readonly onDidRestore: Event<IPersistedLayout | null> = this._onDidRestore.event;

	constructor(
		storage: IStorageService | null = null,
		windowTarget: Window = window
	) {
		super();
		this._windowTarget = windowTarget;
		this._storage = storage ?? new LocalStorageAdapter();

		windowTarget.addEventListener('resize', () => this.scheduleSave());
		windowTarget.addEventListener('beforeunload', () => {
			this.save();
		});
	}

	get isStorageAvailable(): boolean {
		try {
			return this._storage.get(STORAGE_KEY, StorageScope.GLOBAL) !== undefined;
		} catch {
			return false;
		}
	}

	saveGeometry(geometry: IWindowGeometry): void {
		const current = this.load();
		const next: IPersistedLayout = {
			...current,
			geometry,
			version: 1,
		};
		this._store(next);
	}

	savePanelSizes(sizes: IPanelSizes): void {
		const current = this.load();
		const next: IPersistedLayout = {
			...current,
			sizes,
			version: 1,
		};
		this._store(next);
	}

	save(): void {
		const geometry = this._captureGeometry();
		const sizes = this.load()?.sizes ?? LayoutPersistence.getDefaultSizes();
		this._store({ geometry, sizes, version: 1 });
	}

	scheduleSave(): void {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
		}
		this._saveTimer = setTimeout(() => {
			this._saveTimer = null;
			this.save();
		}, SAVE_DEBOUNCE_MS);
	}

	load(): IPersistedLayout | null {
		try {
			const raw = this._storage.get(STORAGE_KEY, StorageScope.GLOBAL);
			if (!raw) {
				return null;
			}
			const parsed = JSON.parse(raw) as IPersistedLayout;
			if (!parsed || typeof parsed !== 'object' || !parsed.sizes) {
				return null;
			}
			return parsed;
		} catch {
			return null;
		}
	}

	restore(): IPersistedLayout | null {
		const layout = this.load();
		if (layout) {
			this._onDidRestore.fire(layout);
		}
		return layout;
	}

	clear(): void {
		try {
			this._storage.remove(STORAGE_KEY, StorageScope.GLOBAL);
		} catch {
			// storage unavailable
		}
	}

	private _captureGeometry(): IWindowGeometry {
		const win = this._windowTarget;
		return {
			width: win.outerWidth,
			height: win.outerHeight,
			x: win.screenX,
			y: win.screenY,
			maximized: win.outerWidth >= win.screen.width - 4 && win.outerHeight >= win.screen.height - 4,
		};
	}

	private _store(layout: IPersistedLayout): void {
		try {
			this._storage.store(STORAGE_KEY, JSON.stringify(layout), StorageScope.GLOBAL, StorageTarget.MACHINE);
			this._onDidSave.fire(layout);
		} catch {
			// storage unavailable
		}
	}

	static getDefaultSizes(): IPanelSizes {
		return {
			sidebarWidth: 260,
			panelHeight: 200,
			panelPosition: 'bottom',
			sidebarVisible: true,
			panelVisible: true,
		};
	}

	dispose(): void {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		super.dispose();
	}
}

class LocalStorageAdapter implements IStorageService {
	declare readonly _serviceBrand: undefined;
	private readonly _memory = new Map<string, string>();

	private get _backend(): Storage | null {
		try {
			return typeof localStorage !== 'undefined' ? localStorage : null;
		} catch {
			return null;
		}
	}

	get onDidChangeStorage(): Event<{ key: string; scope: StorageScope }> {
		return () => ({ dispose() {} });
	}

	get(key: string, _scope: StorageScope, fallbackValue?: string): string | undefined {
		const backend = this._backend;
		if (backend) {
			const value = backend.getItem(key);
			return value ?? fallbackValue;
		}
		return this._memory.get(key) ?? fallbackValue;
	}

	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean {
		const value = this.get(key, scope);
		return value !== undefined ? value === 'true' : fallbackValue;
	}

	getNumber(key: string, scope: StorageScope, fallbackValue: number): number {
		const value = this.get(key, scope);
		return value !== undefined ? Number(value) : fallbackValue;
	}

	store(key: string, value: string | boolean | number | undefined | null, _scope: StorageScope, _target: StorageTarget): void {
		if (value === undefined || value === null) {
			this.remove(key, StorageScope.GLOBAL);
			return;
		}
		const backend = this._backend;
		if (backend) {
			backend.setItem(key, String(value));
		} else {
			this._memory.set(key, String(value));
		}
	}

	remove(key: string, _scope: StorageScope): void {
		const backend = this._backend;
		if (backend) {
			backend.removeItem(key);
		} else {
			this._memory.delete(key);
		}
	}
}
