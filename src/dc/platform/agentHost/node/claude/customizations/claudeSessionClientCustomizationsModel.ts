/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { equals as arraysEqual } from '../../../../../base/common/arrays.js';
import { equals as objectsEqual } from '../../../../../base/common/objects.js';
import { URI } from '../../../../../base/common/uri.js';
import { autorun, IObservable, ISettableObservable, observableValueOpts } from '../../../../../base/common/observable.js';
import type { ISyncedCustomization } from '../../../common/agentPluginManager.js';
import type { ClientPluginCustomization } from '../../../common/state/sessionState.js';

export interface ISessionCustomizationsState {
	readonly synced: readonly ISyncedCustomization[];
}

const INITIAL_STATE: ISessionCustomizationsState = { synced: [] };

export class SessionClientCustomizationsModel {

	private readonly _byClient = new Map<string, readonly ISyncedCustomization[]>();

	private readonly _state: ISettableObservable<ISessionCustomizationsState> = observableValueOpts(
		{ owner: this, equalsFn: stateEqual },
		INITIAL_STATE,
	);
	readonly state: IObservable<ISessionCustomizationsState> = this._state;

	private _mergedSynced(): readonly ISyncedCustomization[] {
		const seen = new Set<string>();
		const result: ISyncedCustomization[] = [];
		for (const synced of this._byClient.values()) {
			for (const item of synced) {
				if (seen.has(item.customization.id)) {
					continue;
				}
				seen.add(item.customization.id);
				result.push(item);
			}
		}
		return result;
	}

	setSyncedCustomizations(clientId: string, synced: readonly ISyncedCustomization[]): void {
		this._byClient.set(clientId, synced);
		this._state.set({ synced: this._mergedSynced() }, undefined);
	}

	removeClient(clientId: string): void {
		if (!this._byClient.delete(clientId)) {
			return;
		}
		this._state.set({ synced: this._mergedSynced() }, undefined);
	}
}

export class SessionClientCustomizationsDiff extends Disposable {

	readonly model: SessionClientCustomizationsModel = new SessionClientCustomizationsModel();

	private _dirty = false;
	private _appliedPluginPaths: readonly URI[] = [];
	private _ignoreNextFire = true;

	readonly onDidChange: Event<void> = Event.fromObservableLight(this.model.state);

	constructor() {
		super();
		this._register(autorun(reader => {
			this.model.state.read(reader);
			if (this._ignoreNextFire) {
				this._ignoreNextFire = false;
				return;
			}
			this._dirty = true;
		}));
	}

	get hasDifference(): boolean {
		return this._dirty;
	}

	hasDifferenceFrom(pluginPaths: readonly URI[]): boolean {
		return this._dirty || !pluginPathsEqual(this._appliedPluginPaths, pluginPaths);
	}

	consume(paths: readonly URI[]): readonly URI[] {
		this._appliedPluginPaths = paths;
		this._dirty = false;
		return paths;
	}

	markDirty(): void {
		this._dirty = true;
	}
}

function stateEqual(a: ISessionCustomizationsState, b: ISessionCustomizationsState): boolean {
	return syncedListEqual(a.synced, b.synced);
}

function syncedListEqual(a: readonly ISyncedCustomization[], b: readonly ISyncedCustomization[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		const ai = a[i].customization as ClientPluginCustomization;
		const bi = b[i].customization as ClientPluginCustomization;
		if (ai.id !== bi.id) {
			return false;
		}
		if (ai.uri !== bi.uri) {
			return false;
		}
		if (ai.nonce !== bi.nonce) {
			return false;
		}
		if (ai.name !== bi.name) {
			return false;
		}
		if (!objectsEqual(ai.enablement ?? [], bi.enablement ?? [])) {
			return false;
		}
		if (!objectsEqual(ai.childEnablement ?? {}, bi.childEnablement ?? {})) {
			return false;
		}
		if (ai.load?.kind !== bi.load?.kind) {
			return false;
		}
		if (loadMessageOf(ai.load) !== loadMessageOf(bi.load)) {
			return false;
		}
		if (!childrenEqual(ai.children, bi.children)) {
			return false;
		}
		if (a[i].pluginDir?.toString() !== b[i].pluginDir?.toString()) {
			return false;
		}
	}
	return true;
}

function loadMessageOf(load: { kind: string; message?: string } | undefined): string | undefined {
	return load && load.message ? load.message : undefined;
}

function childrenEqual(a: readonly { id: string; name: string }[] | undefined, b: readonly { id: string; name: string }[] | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b || a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i].id !== b[i].id || a[i].name !== b[i].name) {
			return false;
		}
	}
	return true;
}

function pluginPathsEqual(a: readonly URI[], b: readonly URI[]): boolean {
	return arraysEqual(a, b, (x, y) => x.toString() === y.toString());
}
