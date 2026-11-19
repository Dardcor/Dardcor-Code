/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isStatusbarEntryLocation, IStatusbarEntryPriority, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { hide, show, isAncestorOfActiveElement } from '../../../../base/browser/dom.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Emitter } from '../../../../base/common/event.js';

export interface IStatusbarViewModelEntry {
	readonly id: string;
	readonly extensionId: string | undefined;
	readonly name: string;
	readonly hasCommand: boolean;
	readonly alignment: StatusbarAlignment;
	readonly priority: IStatusbarEntryPriority;
	readonly container: HTMLElement;
	readonly labelContainer: HTMLElement;
}

export class StatusbarViewModel extends Disposable {

	private static readonly HIDDEN_ENTRIES_KEY = 'workbench.statusbar.hidden';

	private readonly _onDidChangeEntryVisibility = this._register(new Emitter<{ id: string; visible: boolean }>());
	readonly onDidChangeEntryVisibility = this._onDidChangeEntryVisibility.event;

	private _entries: IStatusbarViewModelEntry[] = [];
	get entries(): IStatusbarViewModelEntry[] { return this._entries.slice(0); }

	private _lastFocusedEntry: IStatusbarViewModelEntry | undefined;
	get lastFocusedEntry(): IStatusbarViewModelEntry | undefined {
		return this._lastFocusedEntry && !this.isHidden(this._lastFocusedEntry.id) ? this._lastFocusedEntry : undefined;
	}

	private hidden = new Set<string>();

	constructor(private readonly storageService: IStorageService) {
		super();

		this.restoreState();
		this.registerListeners();
	}

	private restoreState(): void {
		const hiddenRaw = this.storageService.get(StatusbarViewModel.HIDDEN_ENTRIES_KEY, StorageScope.PROFILE);
		if (hiddenRaw) {
			try {
				this.hidden = new Set(JSON.parse(hiddenRaw));
			} catch (error) {
			}
		}
	}

	private registerListeners(): void {
		this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, StatusbarViewModel.HIDDEN_ENTRIES_KEY, this._store)(() => this.onDidStorageValueChange()));
	}

	private onDidStorageValueChange(): void {

		const currentlyHidden = new Set(this.hidden);

		this.hidden.clear();
		this.restoreState();

		const changed = new Set<string>();

		for (const id of currentlyHidden) {
			if (!this.hidden.has(id)) {
				changed.add(id);
			}
		}

		for (const id of this.hidden) {
			if (!currentlyHidden.has(id)) {
				changed.add(id);
			}
		}

		if (changed.size > 0) {
			for (const entry of this._entries) {
				if (changed.has(entry.id)) {
					this.updateVisibility(entry.id, true);

					changed.delete(entry.id);
				}
			}
		}
	}

	add(entry: IStatusbarViewModelEntry): void {

		this._entries.push(entry);

		this.updateVisibility(entry, false);

		this.sort();

		this.markFirstLastVisibleEntry();
	}

	remove(entry: IStatusbarViewModelEntry): void {
		const index = this._entries.indexOf(entry);
		if (index >= 0) {

			this._entries.splice(index, 1);

			if (this._entries.some(otherEntry => isStatusbarEntryLocation(otherEntry.priority.primary) && otherEntry.priority.primary.location.id === entry.id)) {
				this.sort();
			}

			this.markFirstLastVisibleEntry();
		}
	}

	isHidden(id: string): boolean {
		return this.hidden.has(id);
	}

	hide(id: string): void {
		if (!this.hidden.has(id)) {
			this.hidden.add(id);

			this.updateVisibility(id, true);

			this.saveState();
		}
	}

	show(id: string): void {
		if (this.hidden.delete(id)) {
			this.updateVisibility(id, true);

			this.saveState();
		}
	}

	findEntry(container: HTMLElement): IStatusbarViewModelEntry | undefined {
		return this._entries.find(entry => entry.container === container);
	}

	getEntries(alignment: StatusbarAlignment): IStatusbarViewModelEntry[] {
		return this._entries.filter(entry => entry.alignment === alignment);
	}

	focusNextEntry(): void {
		this.focusEntry(+1, 0);
	}

	focusPreviousEntry(): void {
		this.focusEntry(-1, this.entries.length - 1);
	}

	isEntryFocused(): boolean {
		return !!this.getFocusedEntry();
	}

	private getFocusedEntry(): IStatusbarViewModelEntry | undefined {
		return this._entries.find(entry => isAncestorOfActiveElement(entry.container));
	}

	private focusEntry(delta: number, restartPosition: number): void {

		const getVisibleEntry = (start: number) => {
			let indexToFocus = start;
			let entry = (indexToFocus >= 0 && indexToFocus < this._entries.length) ? this._entries[indexToFocus] : undefined;
			while (entry && this.isHidden(entry.id)) {
				indexToFocus += delta;
				entry = (indexToFocus >= 0 && indexToFocus < this._entries.length) ? this._entries[indexToFocus] : undefined;
			}

			return entry;
		};

		const focused = this.getFocusedEntry();
		if (focused) {
			const entry = getVisibleEntry(this._entries.indexOf(focused) + delta);
			if (entry) {
				this._lastFocusedEntry = entry;

				entry.labelContainer.focus();

				return;
			}
		}

		const entry = getVisibleEntry(restartPosition);
		if (entry) {
			this._lastFocusedEntry = entry;
			entry.labelContainer.focus();
		}
	}

	private updateVisibility(id: string, trigger: boolean): void;
	private updateVisibility(entry: IStatusbarViewModelEntry, trigger: boolean): void;
	private updateVisibility(arg1: string | IStatusbarViewModelEntry, trigger: boolean): void {

		if (typeof arg1 === 'string') {
			const id = arg1;

			for (const entry of this._entries) {
				if (entry.id === id) {
					this.updateVisibility(entry, trigger);
				}
			}
		}

		else {
			const entry = arg1;
			const isHidden = this.isHidden(entry.id);

			if (isHidden) {
				hide(entry.container);
			} else {
				show(entry.container);
			}

			if (trigger) {
				this._onDidChangeEntryVisibility.fire({ id: entry.id, visible: !isHidden });
			}

			this.markFirstLastVisibleEntry();
		}
	}

	private saveState(): void {
		if (this.hidden.size > 0) {
			this.storageService.store(StatusbarViewModel.HIDDEN_ENTRIES_KEY, JSON.stringify(Array.from(this.hidden.values())), StorageScope.PROFILE, StorageTarget.USER);
		} else {
			this.storageService.remove(StatusbarViewModel.HIDDEN_ENTRIES_KEY, StorageScope.PROFILE);
		}
	}

	private sort(): void {
		const allEntryIds = new Set(this._entries.map(entry => entry.id));

		const mapEntryWithNumberedPriorityToIndex = new Map<IStatusbarViewModelEntry, number >();
		const mapEntryWithRelativePriority = new Map<string , Map<string, IStatusbarViewModelEntry>>();
		for (let i = 0; i < this._entries.length; i++) {
			const entry = this._entries[i];
			if (typeof entry.priority.primary === 'number' || !allEntryIds.has(entry.priority.primary.location.id)) {
				mapEntryWithNumberedPriorityToIndex.set(entry, i);
			} else {
				const referenceEntryId = entry.priority.primary.location.id;
				let entries = mapEntryWithRelativePriority.get(referenceEntryId);
				if (!entries) {


					for (const relativeEntries of mapEntryWithRelativePriority.values()) {
						if (relativeEntries.has(referenceEntryId)) {
							entries = relativeEntries;
							break;
						}
					}

					if (!entries) {
						entries = new Map();
						mapEntryWithRelativePriority.set(referenceEntryId, entries);
					}
				}
				entries.set(entry.id, entry);
			}
		}

		const sortedEntriesWithNumberedPriority = Array.from(mapEntryWithNumberedPriorityToIndex.keys());
		sortedEntriesWithNumberedPriority.sort((entryA, entryB) => {
			if (entryA.alignment === entryB.alignment) {


				const entryAPrimaryPriority = typeof entryA.priority.primary === 'number' ? entryA.priority.primary : entryA.priority.primary.location.priority;
				const entryBPrimaryPriority = typeof entryB.priority.primary === 'number' ? entryB.priority.primary : entryB.priority.primary.location.priority;

				if (entryAPrimaryPriority !== entryBPrimaryPriority) {
					return entryBPrimaryPriority - entryAPrimaryPriority;
				}

				if (entryA.priority.secondary !== entryB.priority.secondary) {
					return entryB.priority.secondary - entryA.priority.secondary;
				}

				return mapEntryWithNumberedPriorityToIndex.get(entryA)! - mapEntryWithNumberedPriorityToIndex.get(entryB)!;
			}

			if (entryA.alignment === StatusbarAlignment.LEFT) {
				return -1;
			}

			if (entryB.alignment === StatusbarAlignment.LEFT) {
				return 1;
			}

			return 0;
		});

		let sortedEntries: IStatusbarViewModelEntry[];

		if (mapEntryWithRelativePriority.size > 0) {
			sortedEntries = [];

			for (const entry of sortedEntriesWithNumberedPriority) {
				const relativeEntriesMap = mapEntryWithRelativePriority.get(entry.id);
				const relativeEntries = relativeEntriesMap ? Array.from(relativeEntriesMap.values()) : undefined;

				if (relativeEntries) {
					sortedEntries.push(...relativeEntries
						.filter(entry => isStatusbarEntryLocation(entry.priority.primary) && entry.priority.primary.alignment === StatusbarAlignment.LEFT)
						.sort((entryA, entryB) => entryB.priority.secondary - entryA.priority.secondary));
				}

				sortedEntries.push(entry);

				if (relativeEntries) {
					sortedEntries.push(...relativeEntries
						.filter(entry => isStatusbarEntryLocation(entry.priority.primary) && entry.priority.primary.alignment === StatusbarAlignment.RIGHT)
						.sort((entryA, entryB) => entryB.priority.secondary - entryA.priority.secondary));
				}

				mapEntryWithRelativePriority.delete(entry.id);
			}

			for (const [, entries] of mapEntryWithRelativePriority) {
				sortedEntries.push(...Array.from(entries.values()).sort((entryA, entryB) => entryB.priority.secondary - entryA.priority.secondary));
			}
		}

		else {
			sortedEntries = sortedEntriesWithNumberedPriority;
		}

		this._entries = sortedEntries;
	}

	private markFirstLastVisibleEntry(): void {
		this.doMarkFirstLastVisibleStatusbarItem(this.getEntries(StatusbarAlignment.LEFT));
		this.doMarkFirstLastVisibleStatusbarItem(this.getEntries(StatusbarAlignment.RIGHT));
	}

	private doMarkFirstLastVisibleStatusbarItem(entries: IStatusbarViewModelEntry[]): void {
		let firstVisibleItem: IStatusbarViewModelEntry | undefined;
		let lastVisibleItem: IStatusbarViewModelEntry | undefined;

		for (const entry of entries) {

			entry.container.classList.remove('first-visible-item', 'last-visible-item');

			const isVisible = !this.isHidden(entry.id);
			if (isVisible) {
				if (!firstVisibleItem) {
					firstVisibleItem = entry;
				}

				lastVisibleItem = entry;
			}
		}

		firstVisibleItem?.container.classList.add('first-visible-item');

		lastVisibleItem?.container.classList.add('last-visible-item');
	}
}
