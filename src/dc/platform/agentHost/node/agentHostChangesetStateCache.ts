/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LinkedMap, Touch } from '../../../base/common/map.js';
import { ChangesetStatus, type ChangesetState, type URI } from '../common/state/sessionState.js';

const DEFAULT_CHANGESET_STATE_SOFT_LIMIT = 500;

export interface IAgentHostChangesetStateRetentionOptions {
	readonly softLimit?: number;

	readonly canEvict?: (changeset: URI) => boolean;
}

export class AgentHostChangesetStateCache {

	private readonly _states = new Map<string, ChangesetState>();
	private readonly _lru = new LinkedMap<string, true>();
	private readonly _softLimit: number;
	private readonly _canEvict: (changeset: URI) => boolean;

	constructor(options: IAgentHostChangesetStateRetentionOptions = {}) {
		this._softLimit = Math.max(0, options.softLimit ?? DEFAULT_CHANGESET_STATE_SOFT_LIMIT);
		this._canEvict = options.canEvict ?? (() => true);
	}

	keys(): IterableIterator<string> {
		return this._states.keys();
	}

	has(changeset: URI): boolean {
		return this._states.has(changeset);
	}

	get(changeset: URI): ChangesetState | undefined {
		this._touch(changeset);
		return this._states.get(changeset);
	}

	set(changeset: URI, state: ChangesetState): void {
		this._states.set(changeset, state);
		this._touch(changeset);
		this._evictIfOverLimit();
	}

	delete(changeset: URI): void {
		this._states.delete(changeset);
		this._lru.delete(changeset);
	}

	register(changeset: URI, initialStatus: ChangesetStatus = ChangesetStatus.Computing): void {
		if (this._states.has(changeset)) {
			this._touch(changeset);
			return;
		}
		this.set(changeset, { status: initialStatus, files: [] });
	}

	trimEvictableEntries(): void {
		this._evictIfOverLimit();
	}

	private _touch(changeset: URI): void {
		if (this._states.has(changeset)) {
			this._lru.set(changeset, true, Touch.AsNew);
		}
	}

	private _evictIfOverLimit(): void {
		if (this._softLimit === 0) {
			for (const changeset of [...this._lru.keys()]) {
				if (this._canEvict(changeset)) {
					this.delete(changeset);
				}
			}
			return;
		}

		for (const changeset of [...this._lru.keys()]) {
			if (this._states.size <= this._softLimit) {
				return;
			}
			if (!this._states.has(changeset)) {
				this._lru.delete(changeset);
				continue;
			}
			if (this._canEvict(changeset)) {
				this.delete(changeset);
			}
		}
	}
}
