/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../base/common/collections.js';
import { deepClone, equals } from '../../../base/common/objects.js';
import * as semver from '../../../base/common/semver/semver.js';
import { assertReturnsDefined } from '../../../base/common/types.js';
import { IExtensionIdentifier } from '../../extensions/common/extensions.js';
import { ILocalSyncExtension, IRemoteSyncExtension, ISyncExtension } from './userDataSync.js';

export interface IMergeResult {
	readonly local: { added: ISyncExtension[]; removed: IExtensionIdentifier[]; updated: ISyncExtension[] };
	readonly remote: { added: ISyncExtension[]; removed: ISyncExtension[]; updated: ISyncExtension[]; all: ISyncExtension[] } | null;
}

export function merge(localExtensions: ILocalSyncExtension[], remoteExtensions: IRemoteSyncExtension[] | null, lastSyncExtensions: IRemoteSyncExtension[] | null, skippedExtensions: ISyncExtension[], ignoredExtensions: string[], lastSyncBuiltinExtensions: IExtensionIdentifier[] | null): IMergeResult {
	const added: ISyncExtension[] = [];
	const removed: IExtensionIdentifier[] = [];
	const updated: ISyncExtension[] = [];

	if (!remoteExtensions) {
		const remote = localExtensions.filter(({ identifier }) => ignoredExtensions.every(id => id.toLowerCase() !== identifier.id.toLowerCase()));
		return {
			local: {
				added,
				removed,
				updated,
			},
			remote: remote.length > 0 ? {
				added: remote,
				updated: [],
				removed: [],
				all: remote
			} : null
		};
	}

	localExtensions = localExtensions.map(massageIncomingExtension) as ILocalSyncExtension[];
	remoteExtensions = remoteExtensions.map(massageIncomingExtension);
	lastSyncExtensions = lastSyncExtensions ? lastSyncExtensions.map(massageIncomingExtension) : null;

	const uuids: Map<string, string> = new Map<string, string>();
	const addUUID = (identifier: IExtensionIdentifier) => { if (identifier.uuid) { uuids.set(identifier.id.toLowerCase(), identifier.uuid); } };
	localExtensions.forEach(({ identifier }) => addUUID(identifier));
	remoteExtensions.forEach(({ identifier }) => addUUID(identifier));
	lastSyncExtensions?.forEach(({ identifier }) => addUUID(identifier));
	skippedExtensions?.forEach(({ identifier }) => addUUID(identifier));
	lastSyncBuiltinExtensions?.forEach(identifier => addUUID(identifier));

	const getKey = (extension: ISyncExtension): string => {
		const uuid = extension.identifier.uuid || uuids.get(extension.identifier.id.toLowerCase());
		return uuid ? `uuid:${uuid}` : `id:${extension.identifier.id.toLowerCase()}`;
	};
	const addExtensionToMap = (map: Map<string, ISyncExtension>, extension: ISyncExtension) => {
		map.set(getKey(extension), extension);
		return map;
	};
	const localExtensionsMap: Map<string, ISyncExtension> = localExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>());
	const remoteExtensionsMap = remoteExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>());
	const newRemoteExtensionsMap = remoteExtensions.reduce((map: Map<string, ISyncExtension>, extension: ISyncExtension) => addExtensionToMap(map, deepClone(extension)), new Map<string, ISyncExtension>());
	const lastSyncExtensionsMap = lastSyncExtensions ? lastSyncExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>()) : null;
	const skippedExtensionsMap = skippedExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>());
	const ignoredExtensionsSet = ignoredExtensions.reduce((set, id) => {
		const uuid = uuids.get(id.toLowerCase());
		return set.add(uuid ? `uuid:${uuid}` : `id:${id.toLowerCase()}`);
	}, new Set<string>());
	const lastSyncBuiltinExtensionsSet = lastSyncBuiltinExtensions ? lastSyncBuiltinExtensions.reduce((set, { id, uuid }) => {
		uuid = uuid ?? uuids.get(id.toLowerCase());
		return set.add(uuid ? `uuid:${uuid}` : `id:${id.toLowerCase()}`);
	}, new Set<string>()) : null;

	const localToRemote = compare(localExtensionsMap, remoteExtensionsMap, ignoredExtensionsSet, false);
	if (localToRemote.added.size > 0 || localToRemote.removed.size > 0 || localToRemote.updated.size > 0) {

		const baseToLocal = compare(lastSyncExtensionsMap, localExtensionsMap, ignoredExtensionsSet, false);
		const baseToRemote = compare(lastSyncExtensionsMap, remoteExtensionsMap, ignoredExtensionsSet, true);

		const merge = (key: string, localExtension: ISyncExtension, remoteExtension: ISyncExtension, preferred: ISyncExtension): ISyncExtension => {
			let pinned: boolean | undefined, version: string | undefined, preRelease: boolean | undefined;
			if (localExtension.installed) {
				pinned = preferred.pinned;
				preRelease = preferred.preRelease;
				if (pinned) {
					version = preferred.version;
				}
			} else {
				pinned = remoteExtension.pinned;
				preRelease = remoteExtension.preRelease;
				if (pinned) {
					version = remoteExtension.version;
				}
			}
			if (pinned === undefined ) {
				pinned = localExtension.pinned;
				if (pinned) {
					version = localExtension.version;
				}
			}
			if (preRelease === undefined ) {
				preRelease = localExtension.preRelease;
			}
			return {
				...preferred,
				installed: localExtension.installed || remoteExtension.installed,
				pinned,
				preRelease,
				version: version ?? (remoteExtension.version && (!localExtension.installed || semver.gt(remoteExtension.version, localExtension.version)) ? remoteExtension.version : localExtension.version),
				state: mergeExtensionState(localExtension, remoteExtension, lastSyncExtensionsMap?.get(key)),
			};
		};

		for (const key of baseToRemote.removed.values()) {
			const localExtension = localExtensionsMap.get(key);
			if (!localExtension) {
				continue;
			}

			const baseExtension = assertReturnsDefined(lastSyncExtensionsMap?.get(key));
			const wasAnInstalledExtensionDuringLastSync = lastSyncBuiltinExtensionsSet && !lastSyncBuiltinExtensionsSet.has(key) && baseExtension.installed;
			if (localExtension.installed && wasAnInstalledExtensionDuringLastSync ) {
				removed.push(localExtension.identifier);
			} else {
				newRemoteExtensionsMap.set(key, localExtension);
			}

		}

		for (const key of baseToRemote.added.values()) {
			const remoteExtension = assertReturnsDefined(remoteExtensionsMap.get(key));
			const localExtension = localExtensionsMap.get(key);

			if (localExtension) {
				if (localToRemote.updated.has(key)) {
					const mergedExtension = merge(key, localExtension, remoteExtension, remoteExtension);
					if (!areSame(localExtension, remoteExtension, false, false)) {
						updated.push(massageOutgoingExtension(mergedExtension, key));
					}
					newRemoteExtensionsMap.set(key, mergedExtension);
				}
			} else {
				if (remoteExtension.installed) {
					added.push(massageOutgoingExtension(remoteExtension, key));
				}
			}
		}

		for (const key of baseToRemote.updated.values()) {
			const remoteExtension = assertReturnsDefined(remoteExtensionsMap.get(key));
			const baseExtension = assertReturnsDefined(lastSyncExtensionsMap?.get(key));
			const localExtension = localExtensionsMap.get(key);

			if (localExtension) {
				const wasAnInstalledExtensionDuringLastSync = lastSyncBuiltinExtensionsSet && !lastSyncBuiltinExtensionsSet.has(key) && baseExtension.installed;
				if (wasAnInstalledExtensionDuringLastSync && localExtension.installed && !remoteExtension.installed) {
					removed.push(localExtension.identifier);
				} else {
					const mergedExtension = merge(key, localExtension, remoteExtension, remoteExtension);
					updated.push(massageOutgoingExtension(mergedExtension, key));
					newRemoteExtensionsMap.set(key, mergedExtension);
				}
			}
			else if (remoteExtension.installed) {
				added.push(massageOutgoingExtension(remoteExtension, key));
			}

		}

		for (const key of baseToLocal.added.values()) {
			if (baseToRemote.added.has(key)) {
				continue;
			}
			newRemoteExtensionsMap.set(key, assertReturnsDefined(localExtensionsMap.get(key)));
		}

		for (const key of baseToLocal.updated.values()) {
			if (baseToRemote.removed.has(key)) {
				continue;
			}
			if (baseToRemote.updated.has(key)) {
				continue;
			}
			const localExtension = assertReturnsDefined(localExtensionsMap.get(key));
			const remoteExtension = assertReturnsDefined(remoteExtensionsMap.get(key));
			newRemoteExtensionsMap.set(key, merge(key, localExtension, remoteExtension, localExtension));
		}

		for (const key of baseToLocal.removed.values()) {
			if (baseToRemote.updated.has(key)) {
				continue;
			}
			if (baseToRemote.removed.has(key)) {
				continue;
			}
			if (skippedExtensionsMap.has(key)) {
				continue;
			}
			if (!assertReturnsDefined(remoteExtensionsMap.get(key)).installed) {
				continue;
			}
			if (!lastSyncBuiltinExtensionsSet) {
				continue;
			}
			if (lastSyncBuiltinExtensionsSet.has(key) || !assertReturnsDefined(lastSyncExtensionsMap?.get(key)).installed) {
				continue;
			}
			newRemoteExtensionsMap.delete(key);
		}
	}

	const remote: ISyncExtension[] = [];
	const remoteChanges = compare(remoteExtensionsMap, newRemoteExtensionsMap, new Set<string>(), true);
	const hasRemoteChanges = remoteChanges.added.size > 0 || remoteChanges.updated.size > 0 || remoteChanges.removed.size > 0;
	if (hasRemoteChanges) {
		newRemoteExtensionsMap.forEach((value, key) => remote.push(massageOutgoingExtension(value, key)));
	}

	return {
		local: { added, removed, updated },
		remote: hasRemoteChanges ? {
			added: [...remoteChanges.added].map(id => newRemoteExtensionsMap.get(id)!),
			updated: [...remoteChanges.updated].map(id => newRemoteExtensionsMap.get(id)!),
			removed: [...remoteChanges.removed].map(id => remoteExtensionsMap.get(id)!),
			all: remote
		} : null
	};
}

function compare(from: Map<string, ISyncExtension> | null, to: Map<string, ISyncExtension>, ignoredExtensions: Set<string>, checkVersionProperty: boolean): { added: Set<string>; removed: Set<string>; updated: Set<string> } {
	const fromKeys = from ? [...from.keys()].filter(key => !ignoredExtensions.has(key)) : [];
	const toKeys = [...to.keys()].filter(key => !ignoredExtensions.has(key));
	const added = toKeys.filter(key => !fromKeys.includes(key)).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const removed = fromKeys.filter(key => !toKeys.includes(key)).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const updated: Set<string> = new Set<string>();

	for (const key of fromKeys) {
		if (removed.has(key)) {
			continue;
		}
		const fromExtension = from!.get(key)!;
		const toExtension = to.get(key);
		if (!toExtension || !areSame(fromExtension, toExtension, checkVersionProperty, true)) {
			updated.add(key);
		}
	}

	return { added, removed, updated };
}

function areSame(fromExtension: ISyncExtension, toExtension: ISyncExtension, checkVersionProperty: boolean, checkInstalledProperty: boolean): boolean {
	if (fromExtension.disabled !== toExtension.disabled) {
		return false;
	}

	if (!!fromExtension.isApplicationScoped !== !!toExtension.isApplicationScoped) {
		return false;
	}

	if (checkInstalledProperty && fromExtension.installed !== toExtension.installed) {
		return false;
	}

	if (fromExtension.installed && toExtension.installed) {

		if (fromExtension.preRelease !== toExtension.preRelease) {
			return false;
		}

		if (fromExtension.pinned !== toExtension.pinned) {
			return false;
		}

		if (toExtension.pinned && fromExtension.version !== toExtension.version) {
			return false;
		}
	}

	if (!isSameExtensionState(fromExtension.state, toExtension.state)) {
		return false;
	}

	if ((checkVersionProperty && fromExtension.version !== toExtension.version)) {
		return false;
	}

	return true;
}

function mergeExtensionState(localExtension: ISyncExtension, remoteExtension: ISyncExtension, lastSyncExtension: ISyncExtension | undefined): IStringDictionary<any> | undefined {
	const localState = localExtension.state;
	const remoteState = remoteExtension.state;
	const baseState = lastSyncExtension?.state;

	if (!remoteExtension.version) {
		return localState;
	}

	if (localState && semver.gt(localExtension.version, remoteExtension.version)) {
		return localState;
	}
	if (remoteState && semver.gt(remoteExtension.version, localExtension.version)) {
		return remoteState;
	}



	if (!localState) {
		return remoteState;
	}
	if (!remoteState) {
		return localState;
	}

	const mergedState: IStringDictionary<any> = deepClone(localState);
	const baseToRemote = baseState ? compareExtensionState(baseState, remoteState) : { added: Object.keys(remoteState).reduce((r, k) => { r.add(k); return r; }, new Set<string>()), removed: new Set<string>(), updated: new Set<string>() };
	const baseToLocal = baseState ? compareExtensionState(baseState, localState) : { added: Object.keys(localState).reduce((r, k) => { r.add(k); return r; }, new Set<string>()), removed: new Set<string>(), updated: new Set<string>() };
	for (const key of [...baseToRemote.added.values(), ...baseToRemote.updated.values()]) {
		mergedState[key] = remoteState[key];
	}
	for (const key of baseToRemote.removed.values()) {
		if (!baseToLocal.updated.has(key)) {
			delete mergedState[key];
		}
	}
	return mergedState;
}

function compareExtensionState(from: IStringDictionary<any>, to: IStringDictionary<any>): { added: Set<string>; removed: Set<string>; updated: Set<string> } {
	const fromKeys = Object.keys(from);
	const toKeys = Object.keys(to);
	const added = toKeys.filter(key => !fromKeys.includes(key)).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const removed = fromKeys.filter(key => !toKeys.includes(key)).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const updated: Set<string> = new Set<string>();

	for (const key of fromKeys) {
		if (removed.has(key)) {
			continue;
		}
		const value1 = from[key];
		const value2 = to[key];
		if (!equals(value1, value2)) {
			updated.add(key);
		}
	}

	return { added, removed, updated };
}

function isSameExtensionState(a: IStringDictionary<any> = {}, b: IStringDictionary<any> = {}): boolean {
	const { added, removed, updated } = compareExtensionState(a, b);
	return added.size === 0 && removed.size === 0 && updated.size === 0;
}

function massageIncomingExtension(extension: ISyncExtension): ISyncExtension {
	return { ...extension, ...{ disabled: !!extension.disabled, installed: !!extension.installed } };
}

function massageOutgoingExtension(extension: ISyncExtension, key: string): ISyncExtension {
	const massagedExtension: ISyncExtension = {
		...extension,
		identifier: {
			id: extension.identifier.id,
			uuid: key.startsWith('uuid:') ? key.substring('uuid:'.length) : undefined
		},
		preRelease: !!extension.preRelease,
		pinned: !!extension.pinned,
	};
	if (!extension.disabled) {
		delete massagedExtension.disabled;
	}
	if (!extension.installed) {
		delete massagedExtension.installed;
	}
	if (!extension.state) {
		delete massagedExtension.state;
	}
	if (!extension.isApplicationScoped) {
		delete massagedExtension.isApplicationScoped;
	}
	return massagedExtension;
}
