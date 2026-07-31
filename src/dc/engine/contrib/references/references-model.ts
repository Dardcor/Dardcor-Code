/**
 * Dardcor Code - Reference Search Result Tree Model
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { URI } from "../../../core/types/uri.js";
import { IReference } from "./references-controller.js";

export interface IReferencesGroup {
	readonly uri: URI;
	readonly displayName: string;
	readonly references: readonly IReference[];
}

export interface IReferencesModelState {
	readonly totalCount: number;
	readonly groupCount: number;
	readonly groups: readonly IReferencesGroup[];
	readonly flatList: readonly IReference[];
	readonly selectedIndex: number;
}

function getDisplayName(uri: URI): string {
	const path = uri.path.split("/");
	const name = path[path.length - 1] || uri.path || uri.toString();
	return name.length > 0 ? name : uri.toString();
}

export class ReferencesModel extends Disposable {
	private _references: IReference[] = [];
	private _groups: IReferencesGroup[] = [];
	private _selectedIndex: number = -1;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidSelect = this._register(new Emitter<IReference | null>());
	readonly onDidSelect: Event<IReference | null> = this._onDidSelect.event;

	public setReferences(references: IReference[]): void {
		this._references = [...references];
		this._groups = this._groupByFile(this._references);
		this._selectedIndex = this._references.length > 0 ? 0 : -1;
		this._onDidChange.fire();
	}

	public getReferences(): readonly IReference[] {
		return this._references;
	}

	public getGroups(): readonly IReferencesGroup[] {
		return this._groups;
	}

	public getFlatList(): readonly IReference[] {
		return this._references;
	}

	public getTotalCount(): number {
		return this._references.length;
	}

	public getGroupCount(): number {
		return this._groups.length;
	}

	public getSelectedIndex(): number {
		return this._selectedIndex;
	}

	public getCurrentReference(): IReference | null {
		if (this._selectedIndex < 0 || this._selectedIndex >= this._references.length) {
			return null;
		}
		return this._references[this._selectedIndex];
	}

	public selectNext(): void {
		if (this._references.length === 0) {
			return;
		}
		this._selectedIndex = (this._selectedIndex + 1) % this._references.length;
		this._onDidChange.fire();
		this._onDidSelect.fire(this.getCurrentReference());
	}

	public selectPrevious(): void {
		if (this._references.length === 0) {
			return;
		}
		this._selectedIndex = (this._selectedIndex - 1 + this._references.length) % this._references.length;
		this._onDidChange.fire();
		this._onDidSelect.fire(this.getCurrentReference());
	}

	public selectIndex(index: number): void {
		if (index < 0 || index >= this._references.length) {
			return;
		}
		this._selectedIndex = index;
		this._onDidChange.fire();
		this._onDidSelect.fire(this.getCurrentReference());
	}

	public selectReference(reference: IReference): void {
		const index = this._references.indexOf(reference);
		if (index !== -1) {
			this.selectIndex(index);
		}
	}

	public getState(): IReferencesModelState {
		return {
			totalCount: this._references.length,
			groupCount: this._groups.length,
			groups: this._groups,
			flatList: this._references,
			selectedIndex: this._selectedIndex
		};
	}

	private _groupByFile(references: IReference[]): IReferencesGroup[] {
		const byUri = new Map<string, { uri: URI; references: IReference[] }>();
		for (const reference of references) {
			const key = reference.uri.toString();
			let group = byUri.get(key);
			if (!group) {
				group = { uri: reference.uri, references: [] };
				byUri.set(key, group);
			}
			group.references.push(reference);
		}
		const groups: IReferencesGroup[] = [];
		for (const group of byUri.values()) {
			group.references.sort((a, b) => {
				if (a.range.startLineNumber !== b.range.startLineNumber) {
					return a.range.startLineNumber - b.range.startLineNumber;
				}
				return a.range.startColumn - b.range.startColumn;
			});
			groups.push({
				uri: group.uri,
				displayName: getDisplayName(group.uri),
				references: group.references
			});
		}
		groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
		return groups;
	}
}
