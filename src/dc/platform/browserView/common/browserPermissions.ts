/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { localize } from '../../../nls.js';


export type PermissionDecision = 'allow' | 'deny';

export type PermissionState = PermissionDecision | 'ask';

export const enum PermissionCategory {
	Location = 'location',
	Camera = 'camera',
	Microphone = 'microphone',
	Notifications = 'notifications',
	Sensors = 'sensors',
	Clipboard = 'clipboard',
	Devices = 'devices',
}

export type BrowserDeviceType = 'usb' | 'serial' | 'hid' | 'bluetooth';

export interface IBrowserDeviceCandidate {
	readonly deviceId: string;
	readonly label: string;
	readonly detail?: string;
}

export interface IPermissionCategoryDescriptor {
	readonly category: PermissionCategory;
	readonly label: string;
	readonly description: string;
	readonly icon: ThemeIcon;
	readonly permissions: string[];
	readonly defaultState: PermissionState;
}

export const PERMISSION_CATEGORY_DESCRIPTORS: Readonly<Record<PermissionCategory, IPermissionCategoryDescriptor>> = {
	[PermissionCategory.Location]: {
		category: PermissionCategory.Location,
		label: localize('browserPermission.location.label', "Location"),
		description: localize('browserPermission.location.description', "Access this device's geographic location"),
		icon: Codicon.location,
		permissions: ['geolocation', 'geolocation-approximate'],
		defaultState: 'ask',
	},
	[PermissionCategory.Camera]: {
		category: PermissionCategory.Camera,
		label: localize('browserPermission.camera.label', "Camera"),
		description: localize('browserPermission.camera.description', "Capture video from cameras"),
		icon: Codicon.deviceCamera,
		permissions: ['media'],
		defaultState: 'ask',
	},
	[PermissionCategory.Microphone]: {
		category: PermissionCategory.Microphone,
		label: localize('browserPermission.microphone.label', "Microphone"),
		description: localize('browserPermission.microphone.description', "Capture audio from microphones"),
		icon: Codicon.mic,
		permissions: ['media'],
		defaultState: 'ask',
	},
	[PermissionCategory.Sensors]: {
		category: PermissionCategory.Sensors,
		label: localize('browserPermission.sensors.label', "Sensors"),
		description: localize('browserPermission.sensors.description', "Read motion and environmental sensors"),
		icon: Codicon.pulse,
		permissions: ['sensors'],
		defaultState: 'allow',
	},
	[PermissionCategory.Clipboard]: {
		category: PermissionCategory.Clipboard,
		label: localize('browserPermission.clipboard.label', "Clipboard"),
		description: localize('browserPermission.clipboard.description', "Read from and write to the system clipboard"),
		icon: Codicon.clippy,
		permissions: ['clipboard-read'],
		defaultState: 'ask',
	},
	[PermissionCategory.Notifications]: {
		category: PermissionCategory.Notifications,
		label: localize('browserPermission.notifications.label', "Notifications"),
		description: localize('browserPermission.notifications.description', "Display desktop notifications"),
		icon: Codicon.bell,
		permissions: ['notifications'],
		defaultState: 'ask',
	},
	[PermissionCategory.Devices]: {
		category: PermissionCategory.Devices,
		label: localize('browserPermission.devices.label', "Devices"),
		description: localize('browserPermission.devices.description', "Request access to USB, serial, HID, and Bluetooth devices"),
		icon: Codicon.plug,
		permissions: ['usb', 'serial', 'hid'],
		defaultState: 'allow',
	},
};

export const ALWAYS_ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
	'pointerLock',
	'keyboardLock',
	'fullscreen',
	'clipboard-sanitized-write',
]);

export function isAlwaysAllowedPermission(permission: string): boolean {
	return ALWAYS_ALLOWED_PERMISSIONS.has(permission);
}

export const ALL_PERMISSION_CATEGORIES: readonly PermissionCategory[] = Object.keys(PERMISSION_CATEGORY_DESCRIPTORS) as PermissionCategory[];

const DEFAULT_PERMISSION_STATES: Readonly<Record<PermissionCategory, PermissionState>> = Object.freeze(
	Object.fromEntries(ALL_PERMISSION_CATEGORIES.map(category => [category, PERMISSION_CATEGORY_DESCRIPTORS[category].defaultState])) as Record<PermissionCategory, PermissionState>
);

const PERMISSION_TO_CATEGORIES: ReadonlyMap<string, PermissionCategory[]> = (() => {
	const map = new Map<string, PermissionCategory[]>();
	for (const category of ALL_PERMISSION_CATEGORIES) {
		for (const permission of PERMISSION_CATEGORY_DESCRIPTORS[category].permissions) {
			if (permission === 'media') {
				continue;
			}
			const existing = map.get(permission);
			if (existing) {
				existing.push(category);
			} else {
				map.set(permission, [category]);
			}
		}
	}
	return map;
})();

export function electronPermissionToCategories(permission: string, mediaKinds?: ReadonlyArray<'video' | 'audio'>): PermissionCategory[] {
	if (permission === 'media') {
		return resolveMediaCategories(mediaKinds);
	}
	return PERMISSION_TO_CATEGORIES.get(permission) ?? [];
}

function resolveMediaCategories(mediaKinds?: ReadonlyArray<'video' | 'audio'>): PermissionCategory[] {
	const categories = new Set<PermissionCategory>();
	for (const kind of mediaKinds ?? []) {
		categories.add(kind === 'video' ? PermissionCategory.Camera : PermissionCategory.Microphone);
	}
	if (categories.size === 0) {
		return [PermissionCategory.Camera, PermissionCategory.Microphone];
	}
	return [...categories];
}

export function toOriginKey(url: string | undefined | null): string {
	const trimmed = url?.trim();
	if (!trimmed || trimmed === 'null') {
		return '';
	}
	try {
		const parsed = new URL(trimmed);
		if (!parsed.host) {
			return `${parsed.protocol}//${parsed.pathname}`;
		}
		return parsed.origin;
	} catch {
		return trimmed;
	}
}

export interface IPermissionGrant {
	readonly origin: string;
	readonly category: PermissionCategory;
	readonly state: PermissionDecision;
}

export interface IPermissionCategoryState {
	readonly category: PermissionCategory;
	readonly state: PermissionDecision | null;
}

export interface ISerializedBrowserPermissionsSnapshot {
	readonly origins: Readonly<Record<string, Partial<Record<PermissionCategory, PermissionDecision>>>>;
}

const VALID_CATEGORIES = new Set<string>(ALL_PERMISSION_CATEGORIES);

export class BrowserPermissionStore extends Disposable {

	private readonly _data = new Map<string, Map<PermissionCategory, PermissionDecision>>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	defaultStateFor(category: PermissionCategory): PermissionState {
		return PERMISSION_CATEGORY_DESCRIPTORS[category].defaultState;
	}

	getDecision(origin: string, category: PermissionCategory): PermissionDecision | undefined {
		return this._data.get(toOriginKey(origin))?.get(category);
	}

	isAllowed(origin: string, category: PermissionCategory): boolean {
		return (this.getDecision(origin, category) ?? this.defaultStateFor(category)) === 'allow';
	}

	set(origin: string, category: PermissionCategory, decision: PermissionDecision | null): void {
		const key = toOriginKey(origin);
		if (!key) {
			return;
		}

		if (decision === null) {
			const categories = this._data.get(key);
			if (!categories?.delete(category)) {
				return;
			}
			if (categories.size === 0) {
				this._data.delete(key);
			}
		} else {
			let categories = this._data.get(key);
			if (categories?.get(category) === decision) {
				return;
			}
			if (!categories) {
				categories = new Map();
				this._data.set(key, categories);
			}
			categories.set(category, decision);
		}

		this._onDidChange.fire();
	}

	setMany(origin: string, grants: Iterable<IPermissionCategoryState>): void {
		for (const { category, state } of grants) {
			this.set(origin, category, state);
		}
	}

	clearOrigin(origin: string): void {
		const key = toOriginKey(origin);
		if (this._data.delete(key)) {
			this._onDidChange.fire();
		}
	}

	clear(): void {
		if (this._data.size === 0) {
			return;
		}
		this._data.clear();
		this._onDidChange.fire();
	}

	getOrigin(origin: string): Record<PermissionCategory, PermissionState> {
		const result: Record<PermissionCategory, PermissionState> = { ...DEFAULT_PERMISSION_STATES };
		const recorded = this._data.get(toOriginKey(origin));
		if (recorded) {
			for (const [category, state] of recorded) {
				result[category] = state;
			}
		}
		return result;
	}

	origins(): string[] {
		return [...this._data.keys()];
	}

	list(): IPermissionGrant[] {
		const grants: IPermissionGrant[] = [];
		for (const [origin, categories] of this._data) {
			for (const [category, state] of categories) {
				grants.push({ origin, category, state });
			}
		}
		return grants;
	}

	serialize(): ISerializedBrowserPermissionsSnapshot {
		const origins: Record<string, Partial<Record<PermissionCategory, PermissionDecision>>> = {};
		for (const [origin, categories] of this._data) {
			const entry: Partial<Record<PermissionCategory, PermissionDecision>> = {};
			for (const [category, state] of categories) {
				entry[category] = state;
			}
			origins[origin] = entry;
		}
		return { origins };
	}

	hydrate(snapshot: ISerializedBrowserPermissionsSnapshot | undefined): void {
		this._data.clear();
		if (snapshot?.origins && typeof snapshot.origins === 'object') {
			for (const [origin, categories] of Object.entries(snapshot.origins)) {
				if (!categories || typeof categories !== 'object') {
					continue;
				}
				const key = toOriginKey(origin);
				if (!key) {
					continue;
				}
				let target: Map<PermissionCategory, PermissionDecision> | undefined;
				for (const [category, state] of Object.entries(categories)) {
					if (!VALID_CATEGORIES.has(category) || (state !== 'allow' && state !== 'deny')) {
						continue;
					}
					if (!target) {
						target = new Map();
						this._data.set(key, target);
					}
					target.set(category as PermissionCategory, state);
				}
			}
		}
		this._onDidChange.fire();
	}
}
