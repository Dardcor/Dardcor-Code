/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable, ObservablePromise } from '../../../../../../base/common/observable.js';
import { IDocumentDiff } from '../../../../../../editor/common/diff/documentDiffProvider.js';
import { DetailedLineRangeMapping } from '../../../../../../editor/common/diff/rangeMapping.js';
import { ITextModel } from '../../../../../../editor/common/model.js';


export type ICellDiffInfo = |
	{
		originalCellIndex: number;
		modifiedCellIndex: number;
		type: 'unchanged';
	} & IDocumentDiffWithModelsAndActions |
	{
		originalCellIndex: number;
		modifiedCellIndex: number;
		type: 'modified';
	} & IDocumentDiffWithModelsAndActions |
	{
		modifiedCellIndex: undefined;
		originalCellIndex: number;
		type: 'delete';
	} & IDocumentDiffWithModelsAndActions |
	{
		modifiedCellIndex: number;
		originalCellIndex: undefined;
		type: 'insert';
	} & IDocumentDiffWithModelsAndActions;



interface IDocumentDiffWithModelsAndActions {
	diff: ISettableObservable<IDocumentDiff>;
	originalModel: ObservablePromise<ITextModel>;
	modifiedModel: ObservablePromise<ITextModel>;
	keep(changes: DetailedLineRangeMapping): Promise<boolean>;
	undo(changes: DetailedLineRangeMapping): Promise<boolean>;
}


export function countChanges(changes: ICellDiffInfo[]): number {
	return changes.reduce((count, change) => {
		const diff = change.diff.get();
		if (diff.identical) {
			return count;
		}
		switch (change.type) {
			case 'delete':
				return count + 1;
			case 'insert':
				return count + 1;
			case 'modified':
				return count + diff.changes.length;
			default:
				return count;
		}
	}, 0);

}

export function sortCellChanges(changes: ICellDiffInfo[]): ICellDiffInfo[] {
	const indexes = new Map<ICellDiffInfo, number>();
	changes.forEach((c, i) => indexes.set(c, i));
	return [...changes].sort((a, b) => {
		if ((a.type === 'unchanged' || a.type === 'modified') &&
			(b.type === 'unchanged' || b.type === 'modified')) {
			return a.modifiedCellIndex - b.modifiedCellIndex;
		}

		if (a.type === 'delete' && b.type === 'delete') {
			return a.originalCellIndex - b.originalCellIndex;
		}

		if (a.type === 'insert' && b.type === 'insert') {
			return a.modifiedCellIndex - b.modifiedCellIndex;
		}

		if (a.type === 'delete' && b.type === 'insert') {
			return indexes.get(a)! - indexes.get(b)!;
		}
		if (a.type === 'insert' && b.type === 'delete') {
			return indexes.get(a)! - indexes.get(b)!;
		}

		if ((a.type === 'delete' && b.type !== 'insert') || (a.type !== 'insert' && b.type === 'delete')) {
			return a.originalCellIndex - b.originalCellIndex;
		}

		const aIndex = a.type === 'delete' ? a.originalCellIndex :
			(a.type === 'insert' ? a.modifiedCellIndex : a.modifiedCellIndex);
		const bIndex = b.type === 'delete' ? b.originalCellIndex :
			(b.type === 'insert' ? b.modifiedCellIndex : b.modifiedCellIndex);

		return aIndex - bIndex;
	});
}
