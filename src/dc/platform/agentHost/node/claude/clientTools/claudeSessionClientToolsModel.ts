/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { autorun, IObservable, ISettableObservable, observableValueOpts } from '../../../../../base/common/observable.js';
import type { ToolDefinition } from '../../../common/state/protocol/state.js';
import { ActiveClientToolSet, structuralToolsEqual } from '../../activeClientState.js';

export class SessionClientToolsModel {

	private readonly _toolSet = new ActiveClientToolSet();
	private readonly _merged: ISettableObservable<readonly ToolDefinition[]> = observableValueOpts(
		{ owner: this, equalsFn: (a, b) => structuralToolsEqual(a, b) },
		[],
	);
	readonly merged: IObservable<readonly ToolDefinition[]> = this._merged;

	setTools(clientId: string, tools: readonly ToolDefinition[]): void {
		this._toolSet.set(clientId, tools);
		this._merged.set(this._toolSet.merged(), undefined);
	}

	getTools(clientId: string): readonly ToolDefinition[] {
		return this._toolSet.get(clientId);
	}

	removeClient(clientId: string): void {
		if (this._toolSet.delete(clientId)) {
			this._merged.set(this._toolSet.merged(), undefined);
		}
	}

	ownerOf(toolName: string, preferredClientId?: string): string | undefined {
		return this._toolSet.ownerOf(toolName, preferredClientId);
	}
}

export class SessionClientToolsDiff extends Disposable {

	readonly model: SessionClientToolsModel = new SessionClientToolsModel();

	private _dirty = false;
	private _ignoreNextFire = true;
	private _lastAppliedTools: readonly ToolDefinition[] = [];

	constructor() {
		super();
		this._register(autorun(reader => {
			const merged = this.model.merged.read(reader);
			if (this._ignoreNextFire) {
				this._ignoreNextFire = false;
				this._lastAppliedTools = merged;
				return;
			}
			if (!structuralToolsEqual(merged, this._lastAppliedTools)) {
				this._dirty = true;
			}
		}));
	}

	get hasDifference(): boolean {
		return this._dirty;
	}

	consume(): readonly ToolDefinition[] {
		const merged = this.model.merged.get();
		this._dirty = false;
		this._lastAppliedTools = merged;
		return merged;
	}

	markDirty(): void {
		this._dirty = true;
	}
}
