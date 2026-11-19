/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeSitterOffsetRange } from '../../node/nodes';

export interface MarkerRange extends TreeSitterOffsetRange {
	kind?: string;
}

interface InsertMarkersOptions {
	withOffsets: boolean;
	includeArrayIndex: boolean;
	includeKindIndex: boolean;
}

export function insertRangeMarkers(source: string, ranges: MarkerRange[], opts?: Partial<InsertMarkersOptions>) {

	opts = {
		...{ withOffsets: false, includeArrayIndex: false, includeKindIndex: true },
		...opts,
	};

	const sortedRanges = ranges.sort(TreeSitterOffsetRange.compare);

	const unsortedMarkedOffsets = sortedRanges.flatMap((range, i) => {
		const rangeKind = range.kind;
		const indexInArray = i;
		const len = range.endIndex - range.startIndex;
		return [
			{ offset: range.startIndex, offsetKind: 'start', rangeKind, indexInArray, len, },
			{ offset: range.endIndex, offsetKind: 'end', rangeKind, indexInArray, len, }
		];
	});

	const markedOffsets = unsortedMarkedOffsets.sort(({ offset, offsetKind, len, indexInArray }, { offset: otherOffset, offsetKind: otherOffsetKind, len: otherLen, indexInArray: otherIndexInArray }) => {
		const offsetDiff = offset - otherOffset;
		if (offsetDiff !== 0) {
			return offsetDiff;
		}

		if (offsetKind === otherOffsetKind) {
			const d = len - otherLen;
			return offsetKind === 'start' ? -d : d;
		} else {
			return indexInArray === otherIndexInArray
				? offsetKind === 'start' ? -1 : 1
				: offsetKind === 'start' ? 1 : -1;
		}
	});

	const result: string[] = [];
	let cursor = 0;

	const includeArrayIndex = opts.includeArrayIndex && sortedRanges.length > 1;

	const kindIndexMap = new Map< string, number>();
	const arrayIndexToKindIndex = new Map<number, number>();

	for (const { offset, offsetKind, indexInArray, rangeKind } of markedOffsets) {

		result.push(source.substring(cursor, offset));

		let printedRangeKind = '';
		if (rangeKind !== undefined) {
			if (opts.includeKindIndex) {
				let k: number;
				if (offsetKind === 'start') {
					k = kindIndexMap.get(rangeKind) ?? 0;
					kindIndexMap.set(rangeKind, k + 1);
					arrayIndexToKindIndex.set(indexInArray, k);
				} else {
					k = arrayIndexToKindIndex.get(indexInArray)!;
				}
				printedRangeKind = k === 0 ? rangeKind : `${rangeKind}-${k}`;
			} else {
				printedRangeKind = rangeKind;
			}
		}

		const conditionalArrayIndex = includeArrayIndex ? indexInArray.toString() : '';
		const optionalOffset = opts.withOffsets ? `[${offset}]` : '';
		const printedMarker = [printedRangeKind, conditionalArrayIndex, optionalOffset].filter(s => s.length > 0).join('-');
		result.push(`<${offsetKind === 'end' ? '/' : ''}${printedMarker}>`);
		cursor = offset;
	}

	if (cursor < source.length) {
		result.push(source.substring(cursor));
	}

	return result.join('');
}
