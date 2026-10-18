/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { webContents as electronWebContents } from 'electron';
import { localize } from '../../../nls.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { StorageScope, StorageTarget } from '../../storage/common/storage.js';
import {
	BrowserDeviceType,
	BrowserPermissionStore,
	IBrowserDeviceCandidate,
	IPermissionCategoryState,
	ISerializedBrowserPermissionsSnapshot,
	PermissionCategory,
	electronPermissionToCategories,
	isAlwaysAllowedPermission,
	toOriginKey,
} from '../common/browserPermissions.js';
import { BrowserViewStorageScope, IBrowserViewPermissionRequestEvent, IBrowserViewStorageKeys } from '../common/browserView.js';
import type { BrowserSession } from './browserSession.js';

const PROMPT_TIMEOUT_MS = 30_000;

export interface IBrowserSessionPermissionRequest {
	readonly webContents: Electron.WebContents;
	readonly request: IBrowserViewPermissionRequestEvent;
	claim(): void;
}

export interface IBrowserSessionDeviceRequest {
	readonly webContents: Electron.WebContents;
	readonly origin: string;
	readonly requestId: string;
	readonly deviceType: BrowserDeviceType;
	readonly devices: IBrowserDeviceCandidate[];
	claim(): void;
}

interface IPendingDeviceRequest {
	readonly requestId: string;
	readonly webContents: Electron.WebContents;
	readonly origin: string;
	readonly deviceType: BrowserDeviceType;
	devices: IBrowserDeviceCandidate[];
	settled: boolean;
	invoke: (deviceId: string | null) => void;
	settle(deviceId: string | null): void;
}


export interface IBrowserSessionPermissions {
	readonly storageKeys: IBrowserViewStorageKeys;
	readonly onDidRequestPermission: Event<IBrowserSessionPermissionRequest>;
	readonly onDidRequestDevice: Event<IBrowserSessionDeviceRequest>;
	readonly onDidChange: Event<void>;
	serialize(): ISerializedBrowserPermissionsSnapshot;
	set(origin: string, grants: readonly IPermissionCategoryState[]): void;
	clear(): void;
	beginBluetoothRequest(webContents: Electron.WebContents, devices: Electron.BluetoothDevice[], callback: (deviceId: string) => void): void;
	resolveDevice(requestId: string, deviceId: string | null): void;
}

interface IPendingRequest {
	readonly origin: string;
	readonly category: PermissionCategory;
	readonly deferred: DeferredPromise<void>;
}

export class BrowserSessionPermissions extends Disposable implements IBrowserSessionPermissions {

	private readonly _permissionStore = this._register(new BrowserPermissionStore());

	readonly onDidChange: Event<void> = this._permissionStore.onDidChange;

	private _storage: IApplicationStorageMainService | undefined;
	private _persistable = false;

	private _batching = false;
	private _batchDirty = false;

	private readonly _onDidRequestPermission = this._register(new Emitter<IBrowserSessionPermissionRequest>());
	readonly onDidRequestPermission = this._onDidRequestPermission.event;

	private readonly _onDidRequestDevice = this._register(new Emitter<IBrowserSessionDeviceRequest>());
	readonly onDidRequestDevice = this._onDidRequestDevice.event;

	private readonly _pending = new Set<IPendingRequest>();
	private readonly _pendingDevices = new Map<string, IPendingDeviceRequest>();

	readonly storageKeys: IBrowserViewStorageKeys;

	constructor(session: BrowserSession) {
		super();

		this.storageKeys = session.storageScope === BrowserViewStorageScope.Ephemeral
			? {}
			: { permissions: `browser.permissions.${session.id}` };

		this._register(this._permissionStore.onDidChange(() => {
			this._resolvePending();
			if (this._batching) {
				this._batchDirty = true;
				return;
			}
			if (this._persistable) {
				this._flushNow();
			}
		}));

		this._register(toDisposable(() => {
			for (const pending of this._pending) {
				pending.deferred.complete();
			}
			this._pending.clear();
			for (const device of [...this._pendingDevices.values()]) {
				device.settle(null);
			}
		}));
	}

	configure(electronSession: Electron.Session): void {
		electronSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
			this._resolveRequest(webContents, permission, details).then(callback, () => callback(false));
		});
		electronSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
			if (isAlwaysAllowedPermission(permission)) {
				return true;
			}
			const origin = toOriginKey(details.requestingUrl || requestingOrigin);
			const categories = electronPermissionToCategories(permission, mediaKindsFromDetails(details));
			if (categories.length === 0) {
				return false;
			}
			return categories.every(category => this._permissionStore.isAllowed(origin, category));
		});

		electronSession.on('select-usb-device', (event, details, callback) => {
			event.preventDefault();
			const target = this._frameTarget(details.frame);
			if (!target || !this._deviceAllowed(target.origin)) {
				callback();
				return;
			}
			this._beginDeviceRequest({
				webContents: target.webContents,
				origin: target.origin,
				deviceType: 'usb',
				devices: details.deviceList.map(usbCandidate),
				invoke: deviceId => deviceId === null ? callback() : callback(deviceId),
			});
		});
		electronSession.on('usb-device-added', (_event, device, webContents) => {
			this._addDevice(webContents, 'usb', usbCandidate(device));
		});
		electronSession.on('usb-device-removed', (_event, device, webContents) => {
			this._removeDevice(webContents, 'usb', device.deviceId);
		});

		electronSession.on('select-serial-port', (event, portList, webContents, callback) => {
			event.preventDefault();
			const origin = toOriginKey(webContents.getURL());
			if (!this._deviceAllowed(origin)) {
				callback('');
				return;
			}
			this._beginDeviceRequest({
				webContents,
				origin,
				deviceType: 'serial',
				devices: portList.map(serialCandidate),
				invoke: deviceId => callback(deviceId ?? ''),
			});
		});
		electronSession.on('serial-port-added', (_event, port, webContents) => {
			this._addDevice(webContents, 'serial', serialCandidate(port));
		});
		electronSession.on('serial-port-removed', (_event, port, webContents) => {
			this._removeDevice(webContents, 'serial', port.portId);
		});

		electronSession.on('select-hid-device', (event, details, callback) => {
			event.preventDefault();
			const target = this._frameTarget(details.frame);
			if (!target || !this._deviceAllowed(target.origin)) {
				callback(null);
				return;
			}
			this._beginDeviceRequest({
				webContents: target.webContents,
				origin: target.origin,
				deviceType: 'hid',
				devices: details.deviceList.map(hidCandidate),
				invoke: deviceId => callback(deviceId ?? null),
			});
		});
		electronSession.on('hid-device-added', (_event, details) => {
			const target = this._frameTarget(details.frame);
			if (target) {
				this._addDevice(target.webContents, 'hid', hidCandidate(details.device));
			}
		});
		electronSession.on('hid-device-removed', (_event, details) => {
			const target = this._frameTarget(details.frame);
			if (target) {
				this._removeDevice(target.webContents, 'hid', details.device.deviceId);
			}
		});
	}

	connectStorage(storage: IApplicationStorageMainService): void {
		if (this._storage || !this.storageKeys.permissions) {
			return;
		}
		this._storage = storage;
		this._load();
		this._persistable = true;
	}

	serialize(): ISerializedBrowserPermissionsSnapshot {
		return this._permissionStore.serialize();
	}

	set(origin: string, grants: readonly IPermissionCategoryState[]): void {
		const key = toOriginKey(origin);
		for (const grant of grants) {
			if (grant.state === null) {
				this._resolvePendingForCategory(key, grant.category);
			}
		}

		this._batching = true;
		this._batchDirty = false;
		try {
			this._permissionStore.setMany(origin, grants);
		} finally {
			this._batching = false;
		}
		if (this._batchDirty && this._persistable) {
			this._flushNow();
		}
	}

	private _resolvePendingForCategory(origin: string, category: PermissionCategory): void {
		if (!origin || this._pending.size === 0) {
			return;
		}
		for (const pending of [...this._pending]) {
			if (pending.origin === origin && pending.category === category) {
				pending.deferred.complete();
			}
		}
	}

	clear(): void {
		this._permissionStore.clear();
	}


	beginBluetoothRequest(webContents: Electron.WebContents, devices: Electron.BluetoothDevice[], callback: (deviceId: string) => void): void {
		const origin = toOriginKey(webContents.getURL());
		if (!this._deviceAllowed(origin)) {
			callback('');
			return;
		}
		const candidates = devices.map(bluetoothCandidate);
		const existing = this._findActiveDevice(webContents, 'bluetooth');
		if (existing) {
			existing.devices = candidates;
			existing.invoke = deviceId => callback(deviceId ?? '');
			this._emitDeviceRequest(existing);
			return;
		}
		this._beginDeviceRequest({
			webContents,
			origin,
			deviceType: 'bluetooth',
			devices: candidates,
			invoke: deviceId => callback(deviceId ?? ''),
		});
	}

	resolveDevice(requestId: string, deviceId: string | null): void {
		this._pendingDevices.get(requestId)?.settle(deviceId);
	}

	private _beginDeviceRequest(params: {
		readonly webContents: Electron.WebContents;
		readonly origin: string;
		readonly deviceType: BrowserDeviceType;
		readonly devices: IBrowserDeviceCandidate[];
		readonly invoke: (deviceId: string | null) => void;
	}): void {
		const requestId = generateUuid();
		const settle = (deviceId: string | null) => {
			if (pending.settled) {
				return;
			}
			pending.settled = true;
			params.webContents.off('destroyed', cancel);
			this._pendingDevices.delete(requestId);
			pending.invoke(deviceId);
		};
		const cancel = () => settle(null);
		const pending: IPendingDeviceRequest = {
			requestId,
			webContents: params.webContents,
			origin: params.origin,
			deviceType: params.deviceType,
			devices: params.devices,
			settled: false,
			invoke: params.invoke,
			settle,
		};
		params.webContents.on('destroyed', cancel);
		this._pendingDevices.set(requestId, pending);
		if (!this._emitDeviceRequest(pending)) {
			cancel();
		}
	}

	private _emitDeviceRequest(pending: IPendingDeviceRequest): boolean {
		let claimed = false;
		this._onDidRequestDevice.fire({
			webContents: pending.webContents,
			origin: pending.origin,
			requestId: pending.requestId,
			deviceType: pending.deviceType,
			devices: pending.devices,
			claim: () => { claimed = true; },
		});
		return claimed;
	}

	private _addDevice(webContents: Electron.WebContents, deviceType: BrowserDeviceType, candidate: IBrowserDeviceCandidate): void {
		const pending = this._findActiveDevice(webContents, deviceType);
		if (!pending || pending.devices.some(device => device.deviceId === candidate.deviceId)) {
			return;
		}
		pending.devices = [...pending.devices, candidate];
		this._emitDeviceRequest(pending);
	}

	private _removeDevice(webContents: Electron.WebContents, deviceType: BrowserDeviceType, deviceId: string): void {
		const pending = this._findActiveDevice(webContents, deviceType);
		if (!pending) {
			return;
		}
		const next = pending.devices.filter(device => device.deviceId !== deviceId);
		if (next.length === pending.devices.length) {
			return;
		}
		pending.devices = next;
		this._emitDeviceRequest(pending);
	}

	private _findActiveDevice(webContents: Electron.WebContents, deviceType: BrowserDeviceType): IPendingDeviceRequest | undefined {
		for (const pending of this._pendingDevices.values()) {
			if (!pending.settled && pending.webContents === webContents && pending.deviceType === deviceType) {
				return pending;
			}
		}
		return undefined;
	}

	private _frameTarget(frame: Electron.WebFrameMain | null): { webContents: Electron.WebContents; origin: string } | undefined {
		if (!frame) {
			return undefined;
		}
		const webContents = electronWebContents.fromFrame(frame);
		if (!webContents) {
			return undefined;
		}
		return { webContents, origin: toOriginKey(frame.url || webContents.getURL()) };
	}

	private _deviceAllowed(origin: string): boolean {
		return !!origin && this._permissionStore.isAllowed(origin, PermissionCategory.Devices);
	}

	private async _resolveRequest(webContents: Electron.WebContents | null, permission: string, details: PermissionRequestDetails | undefined): Promise<boolean> {
		if (isAlwaysAllowedPermission(permission)) {
			return true;
		}
		const origin = toOriginKey(details?.requestingUrl ?? webContents?.getURL());
		const categories = electronPermissionToCategories(permission, mediaKindsFromDetails(details));
		if (categories.length === 0 || !origin) {
			return false;
		}

		if (categories.every(category => this._permissionStore.isAllowed(origin, category))) {
			return true;
		}
		if (categories.some(category => this._permissionStore.getDecision(origin, category) === 'deny')) {
			return false;
		}

		for (const category of categories) {
			if (!this._permissionStore.getDecision(origin, category)) {
				await this._prompt(webContents, origin, category);
			}
		}

		return categories.every(category => this._permissionStore.isAllowed(origin, category));
	}

	private _prompt(webContents: Electron.WebContents | null, origin: string, category: PermissionCategory): Promise<void> {
		if (!webContents) {
			return Promise.resolve();
		}
		let claimed = false;
		this._onDidRequestPermission.fire({
			webContents,
			request: { origin, category },
			claim: () => { claimed = true; },
		});
		if (!claimed) {
			return Promise.resolve();
		}

		const pending: IPendingRequest = { origin, category, deferred: new DeferredPromise<void>() };
		this._pending.add(pending);

		const timer = setTimeout(() => pending.deferred.complete(), PROMPT_TIMEOUT_MS);
		return pending.deferred.p.finally(() => {
			clearTimeout(timer);
			this._pending.delete(pending);
		});
	}

	private _resolvePending(): void {
		if (this._pending.size === 0) {
			return;
		}
		for (const pending of [...this._pending]) {
			if (this._permissionStore.getDecision(pending.origin, pending.category)) {
				pending.deferred.complete();
			}
		}
	}

	private _load(): void {
		const storage = this._storage;
		const key = this.storageKeys.permissions;
		if (!storage || !key) {
			return;
		}
		const snapshot = parseSnapshot<ISerializedBrowserPermissionsSnapshot>(storage.get(key, StorageScope.APPLICATION));
		this._persistable = false;
		try {
			this._permissionStore.hydrate(snapshot);
		} finally {
			this._persistable = true;
		}
	}

	private _flushNow(): void {
		const storage = this._storage;
		const key = this.storageKeys.permissions;
		if (!storage || !key) {
			return;
		}
		const snapshot = this._permissionStore.serialize();
		if (Object.keys(snapshot.origins).length === 0) {
			storage.remove(key, StorageScope.APPLICATION);
		} else {
			storage.store(key, JSON.stringify(snapshot), StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
	}
}

function parseSnapshot<T>(raw: string | undefined): T | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as T;
		if (!parsed || typeof parsed !== 'object') {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

type PermissionRequestDetails =
	| Electron.PermissionRequest
	| Electron.FilesystemPermissionRequest
	| Electron.MediaAccessPermissionRequest
	| Electron.OpenExternalPermissionRequest;

function mediaKindsFromDetails(details: PermissionRequestDetails | Electron.PermissionCheckHandlerHandlerDetails | undefined): ('video' | 'audio')[] | undefined {
	if (!details) {
		return undefined;
	}
	const kinds = new Set<'video' | 'audio'>();
	// eslint-disable-next-line local/code-no-in-operator
	if ('mediaTypes' in details && details.mediaTypes) {
		for (const kind of details.mediaTypes) {
			kinds.add(kind);
		}
	}
	// eslint-disable-next-line local/code-no-in-operator
	if ('mediaType' in details && (details.mediaType === 'video' || details.mediaType === 'audio')) {
		kinds.add(details.mediaType);
	}
	return kinds.size ? [...kinds] : undefined;
}

function vendorProductHex(vendorId: number | undefined, productId: number | undefined): string {
	const hex = (value: number | undefined) => (value ?? 0).toString(16).padStart(4, '0');
	return `${hex(vendorId)}:${hex(productId)}`;
}

function usbCandidate(device: Electron.USBDevice): IBrowserDeviceCandidate {
	const ids = vendorProductHex(device.vendorId, device.productId);
	return {
		deviceId: device.deviceId,
		label: device.productName || device.manufacturerName || localize('browser.device.usb', "USB Device {0}", ids),
		detail: device.serialNumber ? `${ids} · ${device.serialNumber}` : ids,
	};
}

function serialCandidate(port: Electron.SerialPort): IBrowserDeviceCandidate {
	const ids = port.vendorId && port.productId ? `${port.vendorId}:${port.productId}` : undefined;
	return {
		deviceId: port.portId,
		label: `${port.portName} (${port.displayName})`,
		detail: ids,
	};
}

function hidCandidate(device: Electron.HIDDevice): IBrowserDeviceCandidate {
	const ids = vendorProductHex(device.vendorId, device.productId);
	return {
		deviceId: device.deviceId,
		label: device.name || localize('browser.device.hid', "HID Device {0}", ids),
		detail: device.serialNumber ? `${ids} · ${device.serialNumber}` : ids,
	};
}

function bluetoothCandidate(device: Electron.BluetoothDevice): IBrowserDeviceCandidate {
	return {
		deviceId: device.deviceId,
		label: device.deviceName || device.deviceId,
		detail: device.deviceId,
	};
}
