/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EndOfLine } from '../../../dardcorTypes';

export class CrLfOffsetTranslator {
	private readonly crlfOffsets: number[] = [];

	constructor(original: string, private readonly originalEol: EndOfLine) {
		if (originalEol === EndOfLine.CRLF) {
			for (let i = 0; i < original.length - 1; i++) {
				if (original[i] === '\r' && original[i + 1] === '\n') {
					this.crlfOffsets.push(i);
					i++;
				}
			}
		}
	}

	translate(originalOffset: number): number {
		if (this.originalEol === EndOfLine.LF) {
			return originalOffset;
		}
		let left = 0, right = this.crlfOffsets.length;
		while (left < right) {
			const mid = (left + right) >> 1;
			if (this.crlfOffsets[mid] < originalOffset) {
				left = mid + 1;
			} else {
				right = mid;
			}
		}
		return originalOffset - left;
	}
}
