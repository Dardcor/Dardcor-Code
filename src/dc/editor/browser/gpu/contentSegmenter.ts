/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { safeIntl } from '../../../base/common/date.js';
import type { ViewLineRenderingData } from '../../common/viewModel.js';
import type { ViewLineOptions } from '../viewParts/viewLines/viewLineOptions.js';

export interface IContentSegmenter {
	getSegmentAtIndex(index: number): string | undefined;
	getSegmentData(index: number): Intl.SegmentData | undefined;
}

export function createContentSegmenter(lineData: ViewLineRenderingData, options: ViewLineOptions): IContentSegmenter {
	if (lineData.isBasicASCII && options.useMonospaceOptimizations) {
		return new AsciiContentSegmenter(lineData);
	}
	return new GraphemeContentSegmenter(lineData);
}

class AsciiContentSegmenter implements IContentSegmenter {
	private readonly _content: string;

	constructor(lineData: ViewLineRenderingData) {
		this._content = lineData.content;
	}

	getSegmentAtIndex(index: number): string {
		return this._content[index];
	}

	getSegmentData(index: number): Intl.SegmentData | undefined {
		return undefined;
	}
}

class GraphemeContentSegmenter implements IContentSegmenter {
	private readonly _segments: (Intl.SegmentData | undefined)[] = [];

	constructor(lineData: ViewLineRenderingData) {
		const content = lineData.content;
		const segmenter = safeIntl.Segmenter(undefined, { granularity: 'grapheme' }).value;
		const segmentedContent = Array.from(segmenter.segment(content));
		let segmenterIndex = 0;

		for (let x = 0; x < content.length; x++) {
			const segment = segmentedContent[segmenterIndex];

			if (!segment) {
				break;
			}

			if (segment.index !== x) {
				this._segments.push(undefined);
				continue;
			}

			segmenterIndex++;
			this._segments.push(segment);
		}
	}

	getSegmentAtIndex(index: number): string | undefined {
		return this._segments[index]?.segment;
	}

	getSegmentData(index: number): Intl.SegmentData | undefined {
		return this._segments[index];
	}
}
