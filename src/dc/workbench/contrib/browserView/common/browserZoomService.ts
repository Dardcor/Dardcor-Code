/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { browserZoomDefaultIndex, browserZoomFactors } from '../../../../platform/browserView/common/browserView.js';
import { zoomLevelToZoomFactor } from '../../../../platform/window/common/window.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export const IBrowserZoomService = createDecorator<IBrowserZoomService>('browserZoomService');

const BROWSER_ZOOM_PER_HOST_STORAGE_KEY = 'browserView.zoomPerHost';

export const MATCH_WINDOW_ZOOM_LABEL = 'Match Window';

export interface IBrowserZoomChangeEvent {
	/**
	 * The host (e.g. `"example.com"`) whose zoom changed, or `undefined`
	 * when the global default zoom level changed.
	 */
	readonly host: string | undefined;

	readonly isEphemeralChange: boolean;
}

export interface IBrowserZoomService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeZoom: Event<IBrowserZoomChangeEvent>;

	getEffectiveZoomIndex(host: string | undefined, isEphemeral: boolean): number;

	setHostZoomIndex(host: string, zoomIndex: number, isEphemeral: boolean): void;

	notifyWindowZoomChanged(windowZoomFactor: number): void;
}


const ZOOM_LABEL_TO_INDEX = new Map<string, number>(
	browserZoomFactors.map((f, i) => [`${Math.round(f * 100)}%`, i])
);

export class BrowserZoomService extends Disposable implements IBrowserZoomService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeZoom = this._register(new Emitter<IBrowserZoomChangeEvent>());
	readonly onDidChangeZoom: Event<IBrowserZoomChangeEvent> = this._onDidChangeZoom.event;

	private _persistentZoomMap: Record<string, number>;

	private readonly _ephemeralZoomMap = new Map<string, number>();

	private _windowZoomFactor: number = zoomLevelToZoomFactor(0);

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this._persistentZoomMap = this._readPersistentZoomMap();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.browser.pageZoom')) {
				this._onDidChangeZoom.fire({ host: undefined, isEphemeralChange: false });
			}
		}));
	}

	getEffectiveZoomIndex(host: string | undefined, isEphemeral: boolean): number {
		if (host !== undefined) {
			if (isEphemeral) {
				const ephemeralIndex = this._ephemeralZoomMap.get(host);
				if (ephemeralIndex !== undefined) {
					return this._clamp(ephemeralIndex);
				}
			} else {
				const persistentIndex = this._persistentZoomMap[host];
				if (persistentIndex !== undefined) {
					return this._clamp(persistentIndex);
				}
			}
		}

		return this._getDefaultZoomIndex();
	}

	setHostZoomIndex(host: string, zoomIndex: number, isEphemeral: boolean): void {
		const clamped = this._clamp(zoomIndex);
		const defaultIndex = this._getDefaultZoomIndex();
		const matchesDefault = clamped === defaultIndex;

		if (isEphemeral) {
			if (matchesDefault) {
				if (!this._ephemeralZoomMap.has(host)) {
					return;
				}
				this._ephemeralZoomMap.delete(host);
			} else {
				if (this._ephemeralZoomMap.get(host) === clamped) {
					return;
				}
				this._ephemeralZoomMap.set(host, clamped);
			}
			this._onDidChangeZoom.fire({ host, isEphemeralChange: true });
		} else {
			let persistentChanged = false;
			if (matchesDefault) {
				if (Object.prototype.hasOwnProperty.call(this._persistentZoomMap, host)) {
					delete this._persistentZoomMap[host];
					persistentChanged = true;
				}
			} else if (this._persistentZoomMap[host] !== clamped) {
				this._persistentZoomMap[host] = clamped;
				persistentChanged = true;
			}

			let ephemeralChanged = false;
			if (matchesDefault) {
				ephemeralChanged = this._ephemeralZoomMap.delete(host);
			} else if (this._ephemeralZoomMap.get(host) !== clamped) {
				this._ephemeralZoomMap.set(host, clamped);
				ephemeralChanged = true;
			}

			if (!persistentChanged && !ephemeralChanged) {
				return;
			}
			if (persistentChanged) {
				this._writePersistentZoomMap();
			}
			this._onDidChangeZoom.fire({ host, isEphemeralChange: false });
		}
	}

	notifyWindowZoomChanged(windowZoomFactor: number): void {
		this._windowZoomFactor = windowZoomFactor;
		const label = this.configurationService.getValue<string>('workbench.browser.pageZoom');
		if (label === MATCH_WINDOW_ZOOM_LABEL) {
			this._onDidChangeZoom.fire({ host: undefined, isEphemeralChange: false });
		}
	}


	private _getDefaultZoomIndex(): number {
		const label = this.configurationService.getValue<string>('workbench.browser.pageZoom');
		if (label === MATCH_WINDOW_ZOOM_LABEL) {
			return this._getMatchWindowZoomIndex();
		}
		return ZOOM_LABEL_TO_INDEX.get(label) ?? browserZoomDefaultIndex;
	}

	private _getMatchWindowZoomIndex(): number {
		const windowFactor = this._windowZoomFactor;
		let bestIndex = browserZoomDefaultIndex;
		let bestDist = Infinity;
		for (let i = 0; i < browserZoomFactors.length; i++) {
			const dist = Math.abs(Math.log(browserZoomFactors[i]) - Math.log(windowFactor));
			if (dist < bestDist) {
				bestDist = dist;
				bestIndex = i;
			}
		}
		return bestIndex;
	}

	private _readPersistentZoomMap(): Record<string, number> {
		const raw = this.storageService.get(BROWSER_ZOOM_PER_HOST_STORAGE_KEY, StorageScope.PROFILE);
		if (!raw) {
			return {};
		}
		try {
			const parsed = JSON.parse(raw);
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				return {};
			}
			const result: Record<string, number> = {};
			for (const [host, index] of Object.entries(parsed)) {
				if (typeof index === 'number' && index >= 0 && index < browserZoomFactors.length) {
					result[host] = index;
				}
			}
			return result;
		} catch {
			return {};
		}
	}

	private _writePersistentZoomMap(): void {
		const hasEntries = Object.keys(this._persistentZoomMap).length > 0;
		if (hasEntries) {
			this.storageService.store(BROWSER_ZOOM_PER_HOST_STORAGE_KEY, JSON.stringify(this._persistentZoomMap), StorageScope.PROFILE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(BROWSER_ZOOM_PER_HOST_STORAGE_KEY, StorageScope.PROFILE);
		}
	}

	private _clamp(index: number): number {
		return Math.max(0, Math.min(Math.trunc(index), browserZoomFactors.length - 1));
	}
}
