/**
 * Dardcor Code - Indent-Based Folding Range Strategy
 */

import { IRange } from "../../model/text-model.js";

export interface IFoldingRange {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly indentLevel: number;
	readonly isComment: boolean;
}

export interface IFoldingOptions {
	readonly tabSize: number;
	readonly maxRegionLines: number;
}

export class FoldingRanges {
	private readonly _ranges: IFoldingRange[];

	private constructor(ranges: IFoldingRange[]) {
		this._ranges = ranges;
	}

	public static compute(lineIndents: number[], lineCount: number, options: IFoldingOptions = { tabSize: 4, maxRegionLines: 500 }): FoldingRanges {
		const ranges: IFoldingRange[] = [];
		const levels = lineIndents;
		const n = Math.min(levels.length, lineCount);
		for (let i = 0; i < n - 1; i++) {
			const nextLevel = levels[i + 1];
			const level = levels[i];
			if (nextLevel > level) {
				const start = i;
				let end = i;
				for (let j = i + 1; j < n; j++) {
					if (levels[j] <= level) {
						break;
					}
					end = j;
				}
				if (end > start) {
					let endLine = end;
					if (endLine === n - 1 && levels[endLine] === 0) {
						// A trailing blank line at document end must not be folded in.
						endLine--;
					}
					if (endLine > start && endLine - start + 1 <= options.maxRegionLines) {
						ranges.push({
							startLineNumber: start + 1,
							endLineNumber: endLine + 1,
							indentLevel: level,
							isComment: false
						});
					}
				}
				i = end - 1;
			}
		}
		return new FoldingRanges(ranges);
	}

	public static computeIndentLevels(lines: readonly string[], tabSize: number = 4): number[] {
		const levels: number[] = [];
		let lastLevel = 0;
		for (const line of lines) {
			if (line.trim().length === 0) {
				levels.push(lastLevel);
				continue;
			}
			let level = 0;
			for (const ch of line) {
				if (ch === " ") {
					level++;
				} else if (ch === "\t") {
					level += tabSize;
				} else {
					break;
				}
			}
			lastLevel = Math.floor(level / tabSize);
			levels.push(lastLevel);
		}
		return levels;
	}

	public getRanges(): readonly IFoldingRange[] {
		return this._ranges;
	}

	public getRangeCount(): number {
		return this._ranges.length;
	}

	public getRangeAt(index: number): IFoldingRange | null {
		return this._ranges[index] ?? null;
	}

	public findRangeContainingLine(lineNumber: number): IFoldingRange | null {
		for (const range of this._ranges) {
			if (lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber) {
				return range;
			}
		}
		return null;
	}

	public toRanges(): IRange[] {
		return this._ranges.map(r => ({
			startLineNumber: r.startLineNumber,
			startColumn: 1,
			endLineNumber: r.endLineNumber,
			endColumn: 1
		}));
	}
}

export function computeFoldingRangesFromModel(getLine: (line: number) => string, lineCount: number): FoldingRanges {
	const lines: string[] = [];
	for (let i = 1; i <= lineCount; i++) {
		lines.push(getLine(i));
	}
	const levels = FoldingRanges.computeIndentLevels(lines);
	return FoldingRanges.compute(levels, lineCount);
}
