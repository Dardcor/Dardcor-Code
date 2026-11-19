/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from '../../../../base/common/errors.js';
import { OffsetRange } from '../../../common/core/ranges/offsetRange.js';

export type CompressedVirtualizedItemVisibility = 'before' | 'visible' | 'after';

export interface ICompressedVirtualizedItemLayout {
	readonly contentRange: OffsetRange;
	readonly renderedRange: OffsetRange;
	readonly maxScrollOffset: number;
	readonly scrollOffset: number;
	readonly visibility: CompressedVirtualizedItemVisibility;
}

export interface ICompressedVirtualizedScrollLayout {
	readonly revision: LayoutRevision;
	readonly scrollTop: number;
	readonly logicalScrollHeight: number;
	readonly scrollHeight: number;
	readonly leadingScrollSlack: number;
	readonly trailingScrollSlack: number;
	readonly renderedHeight: number;
	readonly contentViewport: OffsetRange;
	readonly renderedViewport: OffsetRange;
	readonly hiddenContentHeightAboveViewport: number;
	readonly items: readonly ICompressedVirtualizedItemLayout[];
}

export interface ICompressedVirtualizedScrollLayoutInput {
	readonly revision?: LayoutRevision;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly itemGap: number;
	readonly itemHeights: readonly number[];
	readonly leadingScrollSlack?: number;
	readonly trailingScrollSlack?: number;
}

export type LayoutRevision = number & { readonly _brand: 'LayoutRevision' };

export interface ILogicalPosition {
	readonly revision: LayoutRevision;
	readonly offset: number;
}

export interface ISizeEdit {
	readonly oldRange: OffsetRange;
	readonly newRange: OffsetRange;
}

export interface IAnchoredSizeEditBatch {
	readonly fromRevision: LayoutRevision;
	readonly toRevision: LayoutRevision;
	readonly edits: readonly ISizeEdit[];
	readonly anchor: ILogicalPosition;
}

export function asLayoutRevision(value: number): LayoutRevision {
	return value as LayoutRevision;
}

export function computeCompressedVirtualizedScrollLayout(input: ICompressedVirtualizedScrollLayoutInput): ICompressedVirtualizedScrollLayout {
	assertNonNegative('viewportHeight', input.viewportHeight);
	const leadingScrollSlack = input.leadingScrollSlack ?? 0;
	const trailingScrollSlack = input.trailingScrollSlack ?? 0;
	assertNonNegative('leadingScrollSlack', leadingScrollSlack);
	assertNonNegative('trailingScrollSlack', trailingScrollSlack);
	const logicalScrollHeight = computeCompressedVirtualizedScrollHeight(input.itemHeights, input.itemGap);
	const scrollHeight = leadingScrollSlack + logicalScrollHeight + trailingScrollSlack;
	const maxScrollTop = Math.max(0, scrollHeight - input.viewportHeight);
	const scrollTop = Math.max(0, Math.min(input.scrollTop, maxScrollTop));
	const contentViewport = OffsetRange.ofStartAndLength(scrollTop - leadingScrollSlack, input.viewportHeight);

	let contentTop = 0;
	let renderedTop = leadingScrollSlack;
	let hiddenContentHeightAboveViewport = 0;
	const items: ICompressedVirtualizedItemLayout[] = [];

	for (let index = 0; index < input.itemHeights.length; index++) {
		const fullHeight = input.itemHeights[index];
		const renderedHeight = Math.min(fullHeight, input.viewportHeight);
		const maxScrollOffset = fullHeight - renderedHeight;
		const contentRange = OffsetRange.ofStartAndLength(contentTop, fullHeight);
		const renderedRange = OffsetRange.ofStartAndLength(renderedTop, renderedHeight);

		let visibility: CompressedVirtualizedItemVisibility;
		let scrollOffset: number;
		if (contentRange.isBefore(contentViewport)) {
			visibility = 'before';
			scrollOffset = maxScrollOffset;
		} else if (contentRange.isAfter(contentViewport)) {
			visibility = 'after';
			scrollOffset = 0;
		} else {
			visibility = 'visible';
			scrollOffset = Math.max(0, Math.min(contentViewport.start - contentRange.start, maxScrollOffset));
		}

		hiddenContentHeightAboveViewport += scrollOffset;
		items.push({
			contentRange,
			renderedRange,
			maxScrollOffset,
			scrollOffset,
			visibility,
		});

		if (index < input.itemHeights.length - 1) {
			contentTop += fullHeight + input.itemGap;
			renderedTop += renderedHeight + input.itemGap;
		} else {
			contentTop += fullHeight;
			renderedTop += renderedHeight;
		}
	}

	const renderedScrollTop = scrollTop - hiddenContentHeightAboveViewport;
	return {
		revision: input.revision ?? asLayoutRevision(0),
		scrollTop,
		logicalScrollHeight,
		scrollHeight,
		leadingScrollSlack,
		trailingScrollSlack,
		renderedHeight: renderedTop + trailingScrollSlack,
		contentViewport,
		renderedViewport: OffsetRange.ofStartAndLength(renderedScrollTop, input.viewportHeight),
		hiddenContentHeightAboveViewport,
		items,
	};
}

export function computeItemRanges(itemHeights: readonly number[], itemGap: number): readonly OffsetRange[] {
	assertNonNegative('itemGap', itemGap);
	const ranges: OffsetRange[] = [];
	let offset = 0;
	for (let index = 0; index < itemHeights.length; index++) {
		const height = itemHeights[index];
		assertNonNegative(`itemHeights[${index}]`, height);
		ranges.push(OffsetRange.ofStartAndLength(offset, height));
		offset += height + (index < itemHeights.length - 1 ? itemGap : 0);
	}
	return ranges;
}

export function createAnchoredSizeEditBatch(
	fromRevision: LayoutRevision,
	toRevision: LayoutRevision,
	oldItemHeights: readonly number[],
	newItemHeights: readonly number[],
	oldItemGap: number,
	newItemGap: number,
	anchorOffset: number,
): IAnchoredSizeEditBatch {
	if (oldItemHeights.length !== newItemHeights.length) {
		throw new BugIndicatingError('Size edits require stable item identity and ordering');
	}
	const oldRanges = computeItemRanges(oldItemHeights, oldItemGap);
	const newRanges = computeItemRanges(newItemHeights, newItemGap);
	const edits: ISizeEdit[] = [];
	for (let index = 0; index < oldRanges.length; index++) {
		if (!oldRanges[index].equals(newRanges[index])) {
			edits.push({ oldRange: oldRanges[index], newRange: newRanges[index] });
		}
	}
	return {
		fromRevision,
		toRevision,
		edits,
		anchor: { revision: fromRevision, offset: anchorOffset },
	};
}

export function mapLogicalPosition(position: ILogicalPosition, edit: IAnchoredSizeEditBatch): ILogicalPosition {
	if (position.revision !== edit.fromRevision) {
		throw new BugIndicatingError(`Cannot map layout revision ${position.revision} through revision ${edit.fromRevision}`);
	}
	let mappedOffset = position.offset;
	for (const sizeEdit of edit.edits) {
		if (position.offset < sizeEdit.oldRange.start) {
			break;
		}
		if (sizeEdit.oldRange.contains(position.offset)) {
			const relativeOffset = position.offset - sizeEdit.oldRange.start;
			mappedOffset = relativeOffset < sizeEdit.newRange.length
				? sizeEdit.newRange.start + relativeOffset
				: sizeEdit.newRange.start;
			return { revision: edit.toRevision, offset: mappedOffset };
		}
		mappedOffset = position.offset + sizeEdit.newRange.endExclusive - sizeEdit.oldRange.endExclusive;
	}
	return { revision: edit.toRevision, offset: mappedOffset };
}

export function computeCompressedVirtualizedScrollHeight(itemHeights: readonly number[], itemGap: number): number {
	assertNonNegative('itemGap', itemGap);
	for (let i = 0; i < itemHeights.length; i++) {
		assertNonNegative(`itemHeights[${i}]`, itemHeights[i]);
	}
	if (itemHeights.length === 0) {
		return 0;
	}
	return itemHeights.reduce((result, height) => result + height, 0) + itemGap * (itemHeights.length - 1);
}

function assertNonNegative(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new BugIndicatingError(`${name} must be a finite non-negative number, got ${value}`);
	}
}
