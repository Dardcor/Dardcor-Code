/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IModelDecorationOptions, IModelDecorationsChangeAccessor, IModelDeltaDecoration, ITextModel } from '../../../common/model.js';
import { FoldingRegion, FoldingRegions, ILineRange, FoldRange, FoldSource } from './foldingRanges.js';
import { hash } from '../../../../base/common/hash.js';
import { SelectedLines } from './folding.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IRange, Range } from '../../../common/core/range.js';

export interface IDecorationProvider {
	getDecorationOption(isCollapsed: boolean, isHidden: boolean, isManual: boolean): IModelDecorationOptions;
	changeDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null;
	removeDecorations(decorationIds: string[]): void;
}

export interface FoldingModelChangeEvent {
	model: FoldingModel;
	collapseStateChanged?: FoldingRegion[];
}

interface ILineMemento extends ILineRange {
	checksum?: number;
	isCollapsed?: boolean;
	source?: FoldSource;
}

export type CollapseMemento = ILineMemento[];

export class FoldingModel implements IDisposable {
	private readonly _textModel: ITextModel;
	private readonly _decorationProvider: IDecorationProvider;

	private _regions: FoldingRegions;
	private _editorDecorationIds: string[];

	private readonly _updateEventEmitter = new Emitter<FoldingModelChangeEvent>();
	public readonly onDidChange: Event<FoldingModelChangeEvent> = this._updateEventEmitter.event;

	public get regions(): FoldingRegions { return this._regions; }
	public get textModel() { return this._textModel; }
	public get decorationProvider() { return this._decorationProvider; }

	constructor(textModel: ITextModel, decorationProvider: IDecorationProvider) {
		this._textModel = textModel;
		this._decorationProvider = decorationProvider;
		this._regions = new FoldingRegions(new Uint32Array(0), new Uint32Array(0));
		this._editorDecorationIds = [];
	}

	public toggleCollapseState(toggledRegions: FoldingRegion[]) {
		if (!toggledRegions.length) {
			return;
		}
		toggledRegions = toggledRegions.sort((r1, r2) => r1.regionIndex - r2.regionIndex);

		const processed: { [key: string]: boolean | undefined } = {};
		this._decorationProvider.changeDecorations(accessor => {
			let k = 0;
			let dirtyRegionEndLine = -1;
			let lastHiddenLine = -1;
			const updateDecorationsUntil = (index: number) => {
				while (k < index) {
					const endLineNumber = this._regions.getEndLineNumber(k);
					const isCollapsed = this._regions.isCollapsed(k);
					if (endLineNumber <= dirtyRegionEndLine) {
						const isManual = this.regions.getSource(k) !== FoldSource.provider;
						accessor.changeDecorationOptions(this._editorDecorationIds[k], this._decorationProvider.getDecorationOption(isCollapsed, endLineNumber <= lastHiddenLine, isManual));
					}
					if (isCollapsed && endLineNumber > lastHiddenLine) {
						lastHiddenLine = endLineNumber;
					}
					k++;
				}
			};
			for (const region of toggledRegions) {
				const index = region.regionIndex;
				const editorDecorationId = this._editorDecorationIds[index];
				if (editorDecorationId && !processed[editorDecorationId]) {
					processed[editorDecorationId] = true;

					updateDecorationsUntil(index);

					const newCollapseState = !this._regions.isCollapsed(index);
					this._regions.setCollapsed(index, newCollapseState);

					dirtyRegionEndLine = Math.max(dirtyRegionEndLine, this._regions.getEndLineNumber(index));
				}
			}
			updateDecorationsUntil(this._regions.length);
		});
		this._updateEventEmitter.fire({ model: this, collapseStateChanged: toggledRegions });
	}

	public removeManualRanges(ranges: readonly IRange[]) {
		const rangeIndexesToRemove = new Set<number>();
		let removeAll = false;
		for (const range of ranges) {
			if (Range.isEmpty(range)) {
				let index = this._regions.findRange(range.startLineNumber);
				while (index !== -1 && this._regions.getSource(index) === FoldSource.provider) {
					index = this._regions.getParentIndex(index);
				}
				if (index === -1) {
					removeAll = true;
				} else {
					rangeIndexesToRemove.add(index);
				}
			}
		}
		const newFoldingRanges: FoldRange[] = new Array();
		const intersectsSelection = (foldRange: FoldRange) => {
			for (const range of ranges) {
				if (!Range.isEmpty(range) && !(range.startLineNumber > foldRange.endLineNumber || foldRange.startLineNumber > range.endLineNumber)) {
					return true;
				}
			}
			return false;
		};
		for (let i = 0; i < this._regions.length; i++) {
			const foldRange = this._regions.toFoldRange(i);
			if (foldRange.source === FoldSource.provider || (!removeAll && !rangeIndexesToRemove.has(i) && !intersectsSelection(foldRange))) {
				newFoldingRanges.push(foldRange);
			}
		}
		this.updatePost(FoldingRegions.fromFoldRanges(newFoldingRanges));
	}

	public update(newRegions: FoldingRegions, selection?: SelectedLines): void {
		const foldedOrManualRanges = this._currentFoldedOrManualRanges(selection);
		const newRanges = FoldingRegions.sanitizeAndMerge(newRegions, foldedOrManualRanges, this._textModel.getLineCount(), selection);
		this.updatePost(FoldingRegions.fromFoldRanges(newRanges));
	}

	public updatePost(newRegions: FoldingRegions) {
		const newEditorDecorations: IModelDeltaDecoration[] = [];
		let lastHiddenLine = -1;
		for (let index = 0, limit = newRegions.length; index < limit; index++) {
			const startLineNumber = newRegions.getStartLineNumber(index);
			const endLineNumber = newRegions.getEndLineNumber(index);
			const isCollapsed = newRegions.isCollapsed(index);
			const isManual = newRegions.getSource(index) !== FoldSource.provider;
			const decorationRange = {
				startLineNumber: startLineNumber,
				startColumn: this._textModel.getLineMaxColumn(startLineNumber),
				endLineNumber: endLineNumber,
				endColumn: this._textModel.getLineMaxColumn(endLineNumber) + 1
			};
			newEditorDecorations.push({ range: decorationRange, options: this._decorationProvider.getDecorationOption(isCollapsed, endLineNumber <= lastHiddenLine, isManual) });
			if (isCollapsed && endLineNumber > lastHiddenLine) {
				lastHiddenLine = endLineNumber;
			}
		}
		this._decorationProvider.changeDecorations(accessor => this._editorDecorationIds = accessor.deltaDecorations(this._editorDecorationIds, newEditorDecorations));
		this._regions = newRegions;
		this._updateEventEmitter.fire({ model: this });
	}

	private _currentFoldedOrManualRanges(selection?: SelectedLines): FoldRange[] {
		const foldedRanges: FoldRange[] = [];
		for (let i = 0, limit = this._regions.length; i < limit; i++) {
			let isCollapsed = this.regions.isCollapsed(i);
			const source = this.regions.getSource(i);
			if (isCollapsed || source !== FoldSource.provider) {
				const foldRange = this._regions.toFoldRange(i);
				const decRange = this._textModel.getDecorationRange(this._editorDecorationIds[i]);
				if (decRange) {
					if (isCollapsed && selection?.startsInside(decRange.startLineNumber + 1, decRange.endLineNumber)) {
						isCollapsed = false;
					}
					foldedRanges.push({
						startLineNumber: decRange.startLineNumber,
						endLineNumber: decRange.endLineNumber,
						type: foldRange.type,
						isCollapsed,
						source
					});
				}
			}
		}

		return foldedRanges;
	}

	public getMemento(): CollapseMemento | undefined {
		const foldedOrManualRanges = this._currentFoldedOrManualRanges();
		const result: ILineMemento[] = [];
		const maxLineNumber = this._textModel.getLineCount();
		for (let i = 0, limit = foldedOrManualRanges.length; i < limit; i++) {
			const range = foldedOrManualRanges[i];
			if (range.startLineNumber >= range.endLineNumber || range.startLineNumber < 1 || range.endLineNumber > maxLineNumber) {
				continue;
			}
			const checksum = this._getLinesChecksum(range.startLineNumber + 1, range.endLineNumber);
			result.push({
				startLineNumber: range.startLineNumber,
				endLineNumber: range.endLineNumber,
				isCollapsed: range.isCollapsed,
				source: range.source,
				checksum: checksum
			});
		}
		return (result.length > 0) ? result : undefined;
	}

	public applyMemento(state: CollapseMemento) {
		if (!Array.isArray(state)) {
			return;
		}
		const rangesToRestore: FoldRange[] = [];
		const maxLineNumber = this._textModel.getLineCount();
		for (const range of state) {
			if (range.startLineNumber >= range.endLineNumber || range.startLineNumber < 1 || range.endLineNumber > maxLineNumber) {
				continue;
			}
			const checksum = this._getLinesChecksum(range.startLineNumber + 1, range.endLineNumber);
			if (!range.checksum || checksum === range.checksum) {
				rangesToRestore.push({
					startLineNumber: range.startLineNumber,
					endLineNumber: range.endLineNumber,
					type: undefined,
					isCollapsed: range.isCollapsed ?? true,
					source: range.source ?? FoldSource.provider
				});
			}
		}

		const newRanges = FoldingRegions.sanitizeAndMerge(this._regions, rangesToRestore, maxLineNumber);
		this.updatePost(FoldingRegions.fromFoldRanges(newRanges));
	}

	private _getLinesChecksum(lineNumber1: number, lineNumber2: number): number {
		const h = hash(this._textModel.getLineContent(lineNumber1)
			+ this._textModel.getLineContent(lineNumber2));
		return h % 1000000;
	}

	public dispose() {
		this._decorationProvider.removeDecorations(this._editorDecorationIds);
		this._updateEventEmitter.dispose();
	}

	getAllRegionsAtLine(lineNumber: number, filter?: (r: FoldingRegion, level: number) => boolean): FoldingRegion[] {
		const result: FoldingRegion[] = [];
		if (this._regions) {
			let index = this._regions.findRange(lineNumber);
			let level = 1;
			while (index >= 0) {
				const current = this._regions.toRegion(index);
				if (!filter || filter(current, level)) {
					result.push(current);
				}
				level++;
				index = current.parentIndex;
			}
		}
		return result;
	}

	getRegionAtLine(lineNumber: number): FoldingRegion | null {
		if (this._regions) {
			const index = this._regions.findRange(lineNumber);
			if (index >= 0) {
				return this._regions.toRegion(index);
			}
		}
		return null;
	}

	getRegionsInside(region: FoldingRegion | null, filter?: RegionFilter | RegionFilterWithLevel): FoldingRegion[] {
		const result: FoldingRegion[] = [];
		const index = region ? region.regionIndex + 1 : 0;
		const endLineNumber = region ? region.endLineNumber : Number.MAX_VALUE;

		if (filter && filter.length === 2) {
			const levelStack: FoldingRegion[] = [];
			for (let i = index, len = this._regions.length; i < len; i++) {
				const current = this._regions.toRegion(i);
				if (this._regions.getStartLineNumber(i) < endLineNumber) {
					while (levelStack.length > 0 && !current.containedBy(levelStack[levelStack.length - 1])) {
						levelStack.pop();
					}
					levelStack.push(current);
					if (filter(current, levelStack.length)) {
						result.push(current);
					}
				} else {
					break;
				}
			}
		} else {
			for (let i = index, len = this._regions.length; i < len; i++) {
				const current = this._regions.toRegion(i);
				if (this._regions.getStartLineNumber(i) < endLineNumber) {
					if (!filter || (filter as RegionFilter)(current)) {
						result.push(current);
					}
				} else {
					break;
				}
			}
		}
		return result;
	}

}

type RegionFilter = (r: FoldingRegion) => boolean;
type RegionFilterWithLevel = (r: FoldingRegion, level: number) => boolean;


export function toggleCollapseState(foldingModel: FoldingModel, levels: number, lineNumbers: number[]) {
	const toToggle: FoldingRegion[] = [];
	for (const lineNumber of lineNumbers) {
		const region = foldingModel.getRegionAtLine(lineNumber);
		if (region) {
			const doCollapse = !region.isCollapsed;
			toToggle.push(region);
			if (levels > 1) {
				const regionsInside = foldingModel.getRegionsInside(region, (r, level: number) => r.isCollapsed !== doCollapse && level < levels);
				toToggle.push(...regionsInside);
			}
		}
	}
	foldingModel.toggleCollapseState(toToggle);
}


export function setCollapseStateLevelsDown(foldingModel: FoldingModel, doCollapse: boolean, levels = Number.MAX_VALUE, lineNumbers?: number[]): void {
	const toToggle: FoldingRegion[] = [];
	if (lineNumbers && lineNumbers.length > 0) {
		for (const lineNumber of lineNumbers) {
			const region = foldingModel.getRegionAtLine(lineNumber);
			if (region) {
				if (region.isCollapsed !== doCollapse) {
					toToggle.push(region);
				}
				if (levels > 1) {
					const regionsInside = foldingModel.getRegionsInside(region, (r, level: number) => r.isCollapsed !== doCollapse && level < levels);
					toToggle.push(...regionsInside);
				}
			}
		}
	} else {
		const regionsInside = foldingModel.getRegionsInside(null, (r, level: number) => r.isCollapsed !== doCollapse && level < levels);
		toToggle.push(...regionsInside);
	}
	foldingModel.toggleCollapseState(toToggle);
}

export function setCollapseStateLevelsUp(foldingModel: FoldingModel, doCollapse: boolean, levels: number, lineNumbers: number[]): void {
	const toToggle: FoldingRegion[] = [];
	for (const lineNumber of lineNumbers) {
		const regions = foldingModel.getAllRegionsAtLine(lineNumber, (region, level) => region.isCollapsed !== doCollapse && level <= levels);
		toToggle.push(...regions);
	}
	foldingModel.toggleCollapseState(toToggle);
}

export function setCollapseStateUp(foldingModel: FoldingModel, doCollapse: boolean, lineNumbers: number[]): void {
	const toToggle: FoldingRegion[] = [];
	for (const lineNumber of lineNumbers) {
		const regions = foldingModel.getAllRegionsAtLine(lineNumber, (region,) => region.isCollapsed !== doCollapse);
		if (regions.length > 0) {
			toToggle.push(regions[0]);
		}
	}
	foldingModel.toggleCollapseState(toToggle);
}

export function setCollapseStateAtLevel(foldingModel: FoldingModel, foldLevel: number, doCollapse: boolean, blockedLineNumbers: number[]): void {
	const filter = (region: FoldingRegion, level: number) => level === foldLevel && region.isCollapsed !== doCollapse && !blockedLineNumbers.some(line => region.containsLine(line));
	const toToggle = foldingModel.getRegionsInside(null, filter);
	foldingModel.toggleCollapseState(toToggle);
}

export function setCollapseStateForRest(foldingModel: FoldingModel, doCollapse: boolean, blockedLineNumbers: number[]): void {
	const filteredRegions: FoldingRegion[] = [];
	for (const lineNumber of blockedLineNumbers) {
		const regions = foldingModel.getAllRegionsAtLine(lineNumber, undefined);
		if (regions.length > 0) {
			filteredRegions.push(regions[0]);
		}
	}
	const filter = (region: FoldingRegion) => filteredRegions.every((filteredRegion) => !filteredRegion.containedBy(region) && !region.containedBy(filteredRegion)) && region.isCollapsed !== doCollapse;
	const toToggle = foldingModel.getRegionsInside(null, filter);
	foldingModel.toggleCollapseState(toToggle);
}

export function setCollapseStateForMatchingLines(foldingModel: FoldingModel, regExp: RegExp, doCollapse: boolean): void {
	const editorModel = foldingModel.textModel;
	const regions = foldingModel.regions;
	const toToggle: FoldingRegion[] = [];
	for (let i = regions.length - 1; i >= 0; i--) {
		if (doCollapse !== regions.isCollapsed(i)) {
			const startLineNumber = regions.getStartLineNumber(i);
			if (regExp.test(editorModel.getLineContent(startLineNumber))) {
				toToggle.push(regions.toRegion(i));
			}
		}
	}
	foldingModel.toggleCollapseState(toToggle);
}

export function setCollapseStateForType(foldingModel: FoldingModel, type: string, doCollapse: boolean): void {
	const regions = foldingModel.regions;
	const toToggle: FoldingRegion[] = [];
	for (let i = regions.length - 1; i >= 0; i--) {
		if (doCollapse !== regions.isCollapsed(i) && type === regions.getType(i)) {
			toToggle.push(regions.toRegion(i));
		}
	}
	foldingModel.toggleCollapseState(toToggle);
}

export function getParentFoldLine(lineNumber: number, foldingModel: FoldingModel): number | null {
	let startLineNumber: number | null = null;
	const foldingRegion = foldingModel.getRegionAtLine(lineNumber);
	if (foldingRegion !== null) {
		startLineNumber = foldingRegion.startLineNumber;
		if (lineNumber === startLineNumber) {
			const parentFoldingIdx = foldingRegion.parentIndex;
			if (parentFoldingIdx !== -1) {
				startLineNumber = foldingModel.regions.getStartLineNumber(parentFoldingIdx);
			} else {
				startLineNumber = null;
			}
		}
	}
	return startLineNumber;
}

export function getPreviousFoldLine(lineNumber: number, foldingModel: FoldingModel): number | null {
	let foldingRegion = foldingModel.getRegionAtLine(lineNumber);
	if (foldingRegion !== null && foldingRegion.startLineNumber === lineNumber) {
		if (lineNumber !== foldingRegion.startLineNumber) {
			return foldingRegion.startLineNumber;
		} else {
			const expectedParentIndex = foldingRegion.parentIndex;
			let minLineNumber = 0;
			if (expectedParentIndex !== -1) {
				minLineNumber = foldingModel.regions.getStartLineNumber(foldingRegion.parentIndex);
			}

			while (foldingRegion !== null) {
				if (foldingRegion.regionIndex > 0) {
					foldingRegion = foldingModel.regions.toRegion(foldingRegion.regionIndex - 1);

					if (foldingRegion.startLineNumber <= minLineNumber) {
						return null;
					} else if (foldingRegion.parentIndex === expectedParentIndex) {
						return foldingRegion.startLineNumber;
					}
				} else {
					return null;
				}
			}
		}
	} else {
		if (foldingModel.regions.length > 0) {
			foldingRegion = foldingModel.regions.toRegion(foldingModel.regions.length - 1);
			while (foldingRegion !== null) {
				if (foldingRegion.startLineNumber < lineNumber) {
					return foldingRegion.startLineNumber;
				}
				if (foldingRegion.regionIndex > 0) {
					foldingRegion = foldingModel.regions.toRegion(foldingRegion.regionIndex - 1);
				} else {
					foldingRegion = null;
				}
			}
		}
	}
	return null;
}

export function getNextFoldLine(lineNumber: number, foldingModel: FoldingModel): number | null {
	let foldingRegion = foldingModel.getRegionAtLine(lineNumber);
	if (foldingRegion !== null && foldingRegion.startLineNumber === lineNumber) {
		const expectedParentIndex = foldingRegion.parentIndex;
		let maxLineNumber = 0;
		if (expectedParentIndex !== -1) {
			maxLineNumber = foldingModel.regions.getEndLineNumber(foldingRegion.parentIndex);
		} else if (foldingModel.regions.length === 0) {
			return null;
		} else {
			maxLineNumber = foldingModel.regions.getEndLineNumber(foldingModel.regions.length - 1);
		}

		while (foldingRegion !== null) {
			if (foldingRegion.regionIndex < foldingModel.regions.length) {
				foldingRegion = foldingModel.regions.toRegion(foldingRegion.regionIndex + 1);

				if (foldingRegion.startLineNumber >= maxLineNumber) {
					return null;
				} else if (foldingRegion.parentIndex === expectedParentIndex) {
					return foldingRegion.startLineNumber;
				}
			} else {
				return null;
			}
		}
	} else {
		if (foldingModel.regions.length > 0) {
			foldingRegion = foldingModel.regions.toRegion(0);
			while (foldingRegion !== null) {
				if (foldingRegion.startLineNumber > lineNumber) {
					return foldingRegion.startLineNumber;
				}
				if (foldingRegion.regionIndex < foldingModel.regions.length) {
					foldingRegion = foldingModel.regions.toRegion(foldingRegion.regionIndex + 1);
				} else {
					foldingRegion = null;
				}
			}
		}
	}
	return null;
}
