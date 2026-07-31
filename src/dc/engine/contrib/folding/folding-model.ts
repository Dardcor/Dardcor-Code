/**
 * Dardcor Code - Code Folding Range Provider Model
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel } from "../../model/text-model.js";
import { FoldingRanges } from "./folding-ranges.js";
import { FoldingRegion, FoldingRegionTree } from "./folding-region.js";

export class FoldingModel extends Disposable {
	private _model: ITextModel | null = null;
	private _tree: FoldingRegionTree | null = null;
	private _ranges: FoldingRanges | null = null;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.compute();
	}

	public compute(): void {
		const model = this._model;
		if (!model) {
			this._tree = null;
			this._ranges = null;
			this._onDidChange.fire();
			return;
		}
		this._ranges = FoldingRanges.compute(
			FoldingRanges.computeIndentLevels(Array.from({ length: model.getLineCount() }, (_v, i) => model.getLineContent(i + 1))),
			model.getLineCount()
		);
		this._tree = FoldingRegionTree.build(this._ranges.getRanges(), model.getLineCount());
		this._onDidChange.fire();
	}

	public toggle(lineNumber: number): void {
		if (!this._tree) {
			return;
		}
		const region = this._tree.getSmallestRegionAtLine(lineNumber);
		if (region) {
			region.isCollapsed = !region.isCollapsed;
			this._onDidChange.fire();
		}
	}

	public collapse(lineNumber: number): void {
		if (!this._tree) {
			return;
		}
		const region = this._tree.getSmallestRegionAtLine(lineNumber);
		if (region && !region.isCollapsed) {
			region.isCollapsed = true;
			this._onDidChange.fire();
		}
	}

	public expand(lineNumber: number): void {
		if (!this._tree) {
			return;
		}
		const region = this._tree.getSmallestRegionAtLine(lineNumber);
		if (region && region.isCollapsed) {
			region.isCollapsed = false;
			this._onDidChange.fire();
		}
	}

	public collapseAll(): void {
		if (!this._tree) {
			return;
		}
		for (const region of this._tree.flatten()) {
			region.isCollapsed = true;
		}
		this._onDidChange.fire();
	}

	public expandAll(): void {
		if (!this._tree) {
			return;
		}
		for (const region of this._tree.flatten()) {
			region.isCollapsed = false;
		}
		this._onDidChange.fire();
	}

	public isCollapsed(lineNumber: number): boolean {
		if (!this._tree) {
			return false;
		}
		const region = this._tree.getSmallestRegionAtLine(lineNumber);
		return !!region && region.isCollapsed;
	}

	public getRegionsAtLine(lineNumber: number): FoldingRegion[] {
		return this._tree?.getRegionsAtLine(lineNumber) ?? [];
	}

	public getAllRegions(): FoldingRegion[] {
		return this._tree?.flatten() ?? [];
	}

	public getCollapsedRegions(): FoldingRegion[] {
		return this.getAllRegions().filter(r => r.isCollapsed);
	}

	public getFoldingRanges(): FoldingRanges | null {
		return this._ranges;
	}

	public getTree(): FoldingRegionTree | null {
		return this._tree;
	}

	public getModel(): ITextModel | null {
		return this._model;
	}
}
