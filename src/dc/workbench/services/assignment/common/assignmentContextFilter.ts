/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import type { IAssignmentFilter } from './assignmentService.js';

export class AssignmentContextFilter extends Disposable {

	private static readonly STORAGE_KEY = 'workbench.assignment.filteredOutAssignmentContextIds';

	private readonly _filters: IAssignmentFilter[] = [];
	private readonly _filterDisposables = this._register(new DisposableStore());

	private _cachedFilteredOutIds: Map<string, Set<string>>;

	private readonly _registeredFilterIds = new Set<string>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		private readonly storageService: IStorageService
	) {
		super();

		this._cachedFilteredOutIds = this._loadFilteredOutIds();
	}

	addFilter(filter: IAssignmentFilter): void {
		this._filters.push(filter);

		this._registeredFilterIds.add(filter.id);
		if (this._cachedFilteredOutIds.has(filter.id)) {
			const next = new Map(this._cachedFilteredOutIds);
			next.delete(filter.id);
			this._storeFilteredOutIds(next);
		}

		this._filterDisposables.add(filter.onDidChange(() => this._onDidChange.fire()));
		this._onDidChange.fire();
	}

	filter(assignmentContext: string): string {
		const assignments = assignmentContext.split(';');

		const freshFilteredOut = new Map<string, Set<string>>();

		const filteredAssignments = assignments.filter(assignment => {
			let excluded = false;
			for (const filter of this._filters) {
				if (filter.exclude(assignment)) {
					let set = freshFilteredOut.get(filter.id);
					if (!set) {
						set = new Set<string>();
						freshFilteredOut.set(filter.id, set);
					}
					set.add(assignment);
					excluded = true;
				}
			}
			if (excluded) {
				return false;
			}

			for (const [filterId, ids] of this._cachedFilteredOutIds) {
				if (!this._registeredFilterIds.has(filterId) && ids.has(assignment)) {
					return false;
				}
			}

			return true;
		});

		const next = new Map<string, Set<string>>();
		for (const [filterId, ids] of this._cachedFilteredOutIds) {
			if (!this._registeredFilterIds.has(filterId)) {
				next.set(filterId, ids);
			}
		}
		for (const [filterId, ids] of freshFilteredOut) {
			next.set(filterId, ids);
		}
		this._storeFilteredOutIds(next);

		return filteredAssignments.join(';');
	}

	private _loadFilteredOutIds(): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		const raw = this.storageService.get(AssignmentContextFilter.STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return result;
		}

		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				for (const [filterId, ids] of Object.entries(parsed)) {
					if (Array.isArray(ids)) {
						const set = new Set(ids.filter((id): id is string => typeof id === 'string'));
						if (set.size > 0) {
							result.set(filterId, set);
						}
					}
				}
			}
		} catch {
		}

		return result;
	}

	private _storeFilteredOutIds(next: Map<string, Set<string>>): void {
		const normalized = new Map<string, Set<string>>();
		for (const [filterId, ids] of next) {
			if (ids.size > 0) {
				normalized.set(filterId, ids);
			}
		}

		if (areCachesEqual(normalized, this._cachedFilteredOutIds)) {
			return;
		}

		this._cachedFilteredOutIds = normalized;

		if (normalized.size === 0) {
			this.storageService.remove(AssignmentContextFilter.STORAGE_KEY, StorageScope.APPLICATION);
		} else {
			const serializable: Record<string, string[]> = {};
			for (const [filterId, ids] of normalized) {
				serializable[filterId] = Array.from(ids);
			}
			this.storageService.store(AssignmentContextFilter.STORAGE_KEY, JSON.stringify(serializable), StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
	}
}

function areCachesEqual(a: Map<string, Set<string>>, b: Map<string, Set<string>>): boolean {
	if (a.size !== b.size) {
		return false;
	}
	for (const [filterId, ids] of a) {
		const other = b.get(filterId);
		if (!other || other.size !== ids.size) {
			return false;
		}
		for (const id of ids) {
			if (!other.has(id)) {
				return false;
			}
		}
	}
	return true;
}
