/**
 * Dardcor Code - Editor Centered View Layout Mode Wrapper
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IStorageService, StorageScope, StorageTarget } from '../../services/storage/storage-service.js';

export interface ICenteredLayoutOptions {
	readonly defaultEnabled?: boolean;
	readonly defaultWidthPercent?: number;
	readonly minWidthPercent?: number;
	readonly maxWidthPercent?: number;
	readonly persistState?: boolean;
}

export interface ICenteredLayoutChangeEvent {
	readonly enabled: boolean;
	readonly widthPercent: number;
}

const CENTERED_STORAGE_KEY = 'dc.centeredLayout';

export class CenteredLayout extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _options: ICenteredLayoutOptions;
	private _enabled: boolean;
	private _widthPercent: number;
	private _originalMaxWidth: string;
	private _originalMargin: string;

	private readonly _onDidChange = this._register(new Emitter<ICenteredLayoutChangeEvent>());
	readonly onDidChange: Event<ICenteredLayoutChangeEvent> = this._onDidChange.event;

	constructor(
		container: HTMLElement,
		options: ICenteredLayoutOptions = {},
		private readonly _storage: IStorageService | null = null
	) {
		super();
		this._container = container;
		this._options = options;
		this._widthPercent = options.defaultWidthPercent ?? 70;
		this._originalMaxWidth = container.style.maxWidth;
		this._originalMargin = container.style.margin;

		let restored = false;
		if (options.persistState && this._storage) {
			restored = this._storage.getBoolean(CENTERED_STORAGE_KEY, StorageScope.WORKSPACE, options.defaultEnabled ?? false);
		}
		this._enabled = restored || (options.defaultEnabled ?? false);
		if (this._enabled) {
			this._apply();
		}
	}

	get isEnabled(): boolean {
		return this._enabled;
	}

	get widthPercent(): number {
		return this._widthPercent;
	}

	setEnabled(enabled: boolean): void {
		if (this._enabled === enabled) {
			return;
		}
		this._enabled = enabled;
		if (enabled) {
			this._apply();
		} else {
			this._restore();
		}
		if (this._options.persistState && this._storage) {
			this._storage.store(CENTERED_STORAGE_KEY, enabled, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		this._onDidChange.fire({ enabled, widthPercent: this._widthPercent });
	}

	toggle(): void {
		this.setEnabled(!this._enabled);
	}

	setWidthPercent(percent: number): void {
		const min = this._options.minWidthPercent ?? 40;
		const max = this._options.maxWidthPercent ?? 90;
		this._widthPercent = Math.max(min, Math.min(max, percent));
		if (this._enabled) {
			this._apply();
		}
		this._onDidChange.fire({ enabled: this._enabled, widthPercent: this._widthPercent });
	}

	reset(): void {
		this.setEnabled(false);
		this._widthPercent = this._options.defaultWidthPercent ?? 70;
	}

	private _apply(): void {
		this._container.classList.add('dc-centered-layout');
		this._container.style.maxWidth = `${this._widthPercent}%`;
		this._container.style.margin = '0 auto';
	}

	private _restore(): void {
		this._container.classList.remove('dc-centered-layout');
		this._container.style.maxWidth = this._originalMaxWidth;
		this._container.style.margin = this._originalMargin;
	}

	dispose(): void {
		if (this._enabled) {
			this._restore();
		}
		super.dispose();
	}
}
