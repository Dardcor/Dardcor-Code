/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { computeLevenshteinDistance } from '../../../../../base/common/diff/diff.js';
import { CellKind } from '../notebookCommon.js';


type EditCount = number;
type OriginalIndex = number;
type ModifiedIndex = number;
type CellEditCountCache = {
	modifiedToOriginal: Map<ModifiedIndex, Map<OriginalIndex, { editCount: EditCount }>>;
	originalToModified: Map<OriginalIndex, Map<ModifiedIndex, { editCount: EditCount }>>;
};

type ICell = {
	internalMetadata?: {
		internalId?: string;
	};
	getValue(): string;
	getLinesContent(): string[];
	cellKind: CellKind;
};

export function matchCellBasedOnSimilarties(modifiedCells: ICell[], originalCells: ICell[]): { modified: number; original: number; percentage: number }[] {
	const cache: CellEditCountCache = {
		modifiedToOriginal: new Map<ModifiedIndex, Map<OriginalIndex, { editCount: EditCount }>>(),
		originalToModified: new Map<OriginalIndex, Map<ModifiedIndex, { editCount: EditCount }>>(),
	};
	const results: { modified: number; original: number; dist: number; percentage: number; possibleOriginal: number }[] = [];
	const mappedOriginalCellToModifiedCell = new Map<number, number>();
	const mappedModifiedIndexes = new Set<number>();
	const originalIndexWithMostEdits = new Map<number, { dist: number; modifiedIndex: number }>();
	const canOriginalIndexBeMappedToModifiedIndex = (originalIndex: number, value: { editCount: EditCount }) => {
		if (mappedOriginalCellToModifiedCell.has(originalIndex)) {
			return false;
		}
		const existingEdits = originalIndexWithMostEdits.get(originalIndex)?.dist ?? Number.MAX_SAFE_INTEGER;
		return value.editCount < existingEdits;
	};
	const trackMappedIndexes = (modifiedIndex: number, originalIndex: number) => {
		mappedOriginalCellToModifiedCell.set(originalIndex, modifiedIndex);
		mappedModifiedIndexes.add(modifiedIndex);
	};

	for (let i = 0; i < modifiedCells.length; i++) {
		const modifiedCell = modifiedCells[i];
		const { index, editCount: dist, percentage } = computeClosestCell({ cell: modifiedCell, index: i }, originalCells, true, cache, canOriginalIndexBeMappedToModifiedIndex);
		if (index >= 0 && dist === 0) {
			trackMappedIndexes(i, index);
			results.push({ modified: i, original: index, dist, percentage, possibleOriginal: index });
		} else {
			originalIndexWithMostEdits.set(index, { dist: dist, modifiedIndex: i });
			results.push({ modified: i, original: -1, dist: dist, percentage, possibleOriginal: index });
		}
	}

	results.forEach((result, i) => {
		if (result.original >= 0) {
			return;
		}

		const previousMatchedCell = i > 0 ? results.slice(0, i).reverse().find(r => r.original >= 0) : undefined;
		const previousMatchedOriginalIndex = previousMatchedCell?.original ?? -1;
		const previousMatchedModifiedIndex = previousMatchedCell?.modified ?? -1;
		const matchedCell = results.slice(i + 1).find(r => r.original >= 0);
		const unavailableIndexes = new Set<number>();
		const nextMatchedModifiedIndex = results.findIndex((item, idx) => idx > i && item.original >= 0);
		const nextMatchedOriginalIndex = nextMatchedModifiedIndex >= 0 ? results[nextMatchedModifiedIndex].original : -1;
		originalCells.forEach((_, i) => {
			if (mappedOriginalCellToModifiedCell.has(i)) {
				unavailableIndexes.add(i);
				return;
			}
			if (matchedCell && i >= matchedCell.original) {
				unavailableIndexes.add(i);
			}
			if (nextMatchedOriginalIndex >= 0 && i > nextMatchedOriginalIndex) {
				unavailableIndexes.add(i);
			}
		});


		const modifiedCell = modifiedCells[i];
		if (result.original === -1 && result.possibleOriginal >= 0 && !unavailableIndexes.has(result.possibleOriginal) && canOriginalIndexBeMappedToModifiedIndex(result.possibleOriginal, { editCount: result.dist })) {
			trackMappedIndexes(i, result.possibleOriginal);
			result.original = result.possibleOriginal;
			return;
		}


		if (previousMatchedOriginalIndex > 0 && previousMatchedModifiedIndex > 0 && previousMatchedOriginalIndex === previousMatchedModifiedIndex) {
			if ((nextMatchedModifiedIndex >= 0 ? nextMatchedModifiedIndex : modifiedCells.length - 1) === (nextMatchedOriginalIndex >= 0 ? nextMatchedOriginalIndex : originalCells.length - 1) && !unavailableIndexes.has(i) && i < originalCells.length) {
				const remainingModifiedItems = (nextMatchedModifiedIndex >= 0 ? nextMatchedModifiedIndex : modifiedCells.length) - previousMatchedModifiedIndex;
				const remainingOriginalItems = (nextMatchedOriginalIndex >= 0 ? nextMatchedOriginalIndex : originalCells.length) - previousMatchedOriginalIndex;
				if (remainingModifiedItems === remainingOriginalItems && modifiedCell.cellKind === originalCells[i].cellKind) {
					trackMappedIndexes(i, i);
					result.original = i;
					return;
				}
			}
		}
		const { index, percentage } = computeClosestCell({ cell: modifiedCell, index: i }, originalCells, false, cache, (originalIndex: number, originalValue: { editCount: EditCount }) => {
			if (unavailableIndexes.has(originalIndex)) {
				return false;
			}

			if (nextMatchedModifiedIndex > 0 || previousMatchedOriginalIndex > 0) {
				const matchesForThisOriginalIndex = cache.originalToModified.get(originalIndex);
				if (matchesForThisOriginalIndex && previousMatchedOriginalIndex < originalIndex) {
					const betterMatch = Array.from(matchesForThisOriginalIndex).find(([modifiedIndex, value]) => {
						if (modifiedIndex === i) {
							return false;
						}
						if (modifiedIndex >= nextMatchedModifiedIndex) {
							return false;
						}
						if (mappedModifiedIndexes.has(i)) {
							return false;
						}
						return value.editCount < originalValue.editCount;
					});
					if (betterMatch) {
						return false;
					}
				}
			}
			return !unavailableIndexes.has(originalIndex);
		});

		if (index >= 0 && i > 0 && results[i - 1].original === index - 1) {
			trackMappedIndexes(i, index);
			results[i].original = index;
			return;
		}

		const nextOriginalCell = (i > 0 && originalCells.length > results[i - 1].original) ? results[i - 1].original + 1 : -1;
		const nextOriginalCellValue = i > 0 && nextOriginalCell >= 0 && nextOriginalCell < originalCells.length ? originalCells[nextOriginalCell].getValue() : undefined;
		if (index >= 0 && i > 0 && typeof nextOriginalCellValue === 'string' && !mappedOriginalCellToModifiedCell.has(nextOriginalCell)) {
			if (modifiedCell.getValue().includes(nextOriginalCellValue) || nextOriginalCellValue.includes(modifiedCell.getValue())) {
				trackMappedIndexes(i, nextOriginalCell);
				results[i].original = nextOriginalCell;
				return;
			}
		}

		if (percentage < 90 || (i === 0 && results.length === 1)) {
			trackMappedIndexes(i, index);
			results[i].original = index;
			return;
		}
	});

	return results;
}

function computeClosestCell({ cell, index: cellIndex }: { cell: ICell; index: number }, arr: readonly ICell[], ignoreEmptyCells: boolean, cache: CellEditCountCache, canOriginalIndexBeMappedToModifiedIndex: (originalIndex: number, value: { editCount: EditCount }) => boolean): { index: number; editCount: number; percentage: number } {
	let min_edits = Infinity;
	let min_index = -1;

	const internalId = cell.internalMetadata?.internalId;
	if (internalId) {
		const internalIdIndex = arr.findIndex(cell => cell.internalMetadata?.internalId === internalId);
		if (internalIdIndex >= 0) {
			return { index: internalIdIndex, editCount: 0, percentage: Number.MAX_SAFE_INTEGER };
		}
	}

	for (let i = 0; i < arr.length; i++) {
		if (arr[i].cellKind !== cell.cellKind) {
			continue;
		}
		const str = arr[i].getValue();
		const cacheEntry = cache.modifiedToOriginal.get(cellIndex) ?? new Map<OriginalIndex, { editCount: EditCount }>();
		const value = cacheEntry.get(i) ?? { editCount: computeNumberOfEdits(cell, arr[i]), };
		cacheEntry.set(i, value);
		cache.modifiedToOriginal.set(cellIndex, cacheEntry);

		const originalCacheEntry = cache.originalToModified.get(i) ?? new Map<ModifiedIndex, { editCount: EditCount }>();
		originalCacheEntry.set(cellIndex, value);
		cache.originalToModified.set(i, originalCacheEntry);

		if (!canOriginalIndexBeMappedToModifiedIndex(i, value)) {
			continue;
		}
		if (str.length === 0 && ignoreEmptyCells) {
			continue;
		}
		if (str === cell.getValue() && cell.getValue().length > 0) {
			return { index: i, editCount: 0, percentage: 0 };
		}

		if (value.editCount < min_edits) {
			min_edits = value.editCount;
			min_index = i;
		}
	}

	if (min_index === -1) {
		return { index: -1, editCount: Number.MAX_SAFE_INTEGER, percentage: Number.MAX_SAFE_INTEGER };
	}
	const percentage = !cell.getValue().length && !arr[min_index].getValue().length ? 0 : (cell.getValue().length ? (min_edits * 100 / cell.getValue().length) : Number.MAX_SAFE_INTEGER);
	return { index: min_index, editCount: min_edits, percentage };
}

function computeNumberOfEdits(modified: ICell, original: ICell) {
	if (modified.getValue() === original.getValue()) {
		return 0;
	}

	return computeLevenshteinDistance(modified.getValue(), original.getValue());
}
