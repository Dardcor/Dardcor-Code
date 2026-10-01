/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function levenshteinDistance(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}

	let prevRow = new Array(b.length + 1);
	let currRow = new Array(b.length + 1);

	for (let j = 0; j <= b.length; j++) {
		prevRow[j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		currRow[0] = i;
		const charA = a.charCodeAt(i - 1);

		for (let j = 1; j <= b.length; j++) {
			const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
			currRow[j] = Math.min(
				prevRow[j] + 1,
				currRow[j - 1] + 1,
				prevRow[j - 1] + cost
			);
		}

		const temp = prevRow;
		prevRow = currRow;
		currRow = temp;
	}

	return prevRow[b.length];
}

export function calculateSimilarity(a: string, b: string): number {
	if (a === b) {
		return 1.0;
	}
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) {
		return 1.0;
	}
	const distance = levenshteinDistance(a, b);
	return Math.max(0, 1.0 - distance / maxLen);
}
