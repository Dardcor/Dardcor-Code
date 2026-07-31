/**
 * Dardcor Code - Insert/Delete Diff Change Descriptor (Task 247)
 * Mirrors: vs/editor/common/diff/diffComputer.ts
 */

import { Range } from '../model/text-model';

export const enum DiffChangeType {
	Insert = 0,
	Delete = 1,
	Replace = 2,
}

export class DiffChange {
	constructor(
		public readonly originalStartLineNumber: number,
		public readonly originalEndLineNumberExclusive: number,
		public readonly modifiedStartLineNumber: number,
		public readonly modifiedEndLineNumberExclusive: number,
		public readonly type: DiffChangeType
	) {}

	public getOriginalRange(): Range {
		return new Range(
			this.originalStartLineNumber,
			1,
			this.originalEndLineNumberExclusive > this.originalStartLineNumber ? this.originalEndLineNumberExclusive - 1 : this.originalStartLineNumber,
			this.originalEndLineNumberExclusive > this.originalStartLineNumber ? Number.MAX_SAFE_INTEGER : 2
		);
	}

	public getModifiedRange(): Range {
		return new Range(
			this.modifiedStartLineNumber,
			1,
			this.modifiedEndLineNumberExclusive > this.modifiedStartLineNumber ? this.modifiedEndLineNumberExclusive - 1 : this.modifiedStartLineNumber,
			this.modifiedEndLineNumberExclusive > this.modifiedStartLineNumber ? Number.MAX_SAFE_INTEGER : 2
		);
	}

	public getOriginalLength(): number {
		return Math.max(0, this.originalEndLineNumberExclusive - this.originalStartLineNumber);
	}

	public getModifiedLength(): number {
		return Math.max(0, this.modifiedEndLineNumberExclusive - this.modifiedStartLineNumber);
	}

	public isInsertion(): boolean {
		return this.type === DiffChangeType.Insert;
	}

	public isDeletion(): boolean {
		return this.type === DiffChangeType.Delete;
	}

	public isReplacement(): boolean {
		return this.type === DiffChangeType.Replace;
	}
}

export function computeLineDiff(originalLines: readonly string[], modifiedLines: readonly string[]): DiffChange[] {
	const originalLen = originalLines.length;
	const modifiedLen = modifiedLines.length;
	const prefixLength = findCommonPrefix(originalLines, modifiedLines);
	const suffixLength = findCommonSuffix(originalLines, modifiedLines, prefixLength);

	if (prefixLength === originalLen && prefixLength === modifiedLen) {
		return [];
	}

	const changes: DiffChange[] = [];
	const originalMiddleStart = prefixLength;
	const originalMiddleEnd = originalLen - suffixLength;
	const modifiedMiddleStart = prefixLength;
	const modifiedMiddleEnd = modifiedLen - suffixLength;

	const middleOriginal = originalLines.slice(originalMiddleStart, originalMiddleEnd);
	const middleModified = modifiedLines.slice(modifiedMiddleStart, modifiedMiddleEnd);

	if (middleOriginal.length === 0) {
		changes.push(new DiffChange(originalMiddleStart + 1, originalMiddleStart + 1, modifiedMiddleStart + 1, modifiedMiddleEnd + 1, DiffChangeType.Insert));
	} else if (middleModified.length === 0) {
		changes.push(new DiffChange(originalMiddleStart + 1, originalMiddleEnd + 1, modifiedMiddleStart + 1, modifiedMiddleStart + 1, DiffChangeType.Delete));
	} else {
		const lcs = computeLCS(middleOriginal, middleModified);
		computeChangesFromLCS(middleOriginal, middleModified, lcs, originalMiddleStart, modifiedMiddleStart, changes);
	}

	return changes;
}

export function computeTextDiff(originalText: string, modifiedText: string): DiffChange[] {
	return computeLineDiff(splitLines(originalText), splitLines(modifiedText));
}

export function splitLines(text: string): string[] {
	return text.split(/\r?\n/);
}

function findCommonPrefix(a: readonly string[], b: readonly string[]): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) {
		i++;
	}
	return i;
}

function findCommonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
	let i = a.length - 1;
	let j = b.length - 1;
	let count = 0;
	while (i >= prefix && j >= prefix && a[i] === b[j]) {
		i--;
		j--;
		count++;
	}
	return count;
}

function computeLCS(a: readonly string[], b: readonly string[]): number[][] {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = new Array(n + 1);
	for (let i = 0; i <= n; i++) {
		dp[i] = new Array(m + 1).fill(0);
	}
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			if (a[i] === b[j]) {
				dp[i][j] = dp[i + 1][j + 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}
	return dp;
}

function computeChangesFromLCS(
	a: readonly string[],
	b: readonly string[],
	lcs: number[][],
	originalOffset: number,
	modifiedOffset: number,
	changes: DiffChange[]
): void {
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			i++;
			j++;
			continue;
		}
		let insertStart = j;
		while (j < b.length && (i >= a.length || lcs[i][j] !== lcs[i][j + 1])) {
			j++;
		}
		let deleteStart = i;
		while (i < a.length && (j >= b.length || lcs[i][j] !== lcs[i + 1][j])) {
			i++;
		}
		const deleteLength = i - deleteStart;
		const insertLength = j - insertStart;
		if (deleteLength > 0 && insertLength > 0) {
			changes.push(new DiffChange(originalOffset + deleteStart + 1, originalOffset + i + 1, modifiedOffset + insertStart + 1, modifiedOffset + j + 1, DiffChangeType.Replace));
		} else if (deleteLength > 0) {
			changes.push(new DiffChange(originalOffset + deleteStart + 1, originalOffset + i + 1, modifiedOffset + insertStart + 1, modifiedOffset + insertStart + 1, DiffChangeType.Delete));
		} else if (insertLength > 0) {
			changes.push(new DiffChange(originalOffset + deleteStart + 1, originalOffset + deleteStart + 1, modifiedOffset + insertStart + 1, modifiedOffset + j + 1, DiffChangeType.Insert));
		}
	}
	if (i < a.length) {
		changes.push(new DiffChange(originalOffset + i + 1, originalOffset + a.length + 1, modifiedOffset + b.length + 1, modifiedOffset + b.length + 1, DiffChangeType.Delete));
	}
	if (j < b.length) {
		changes.push(new DiffChange(originalOffset + a.length + 1, originalOffset + a.length + 1, modifiedOffset + j + 1, modifiedOffset + b.length + 1, DiffChangeType.Insert));
	}
}
