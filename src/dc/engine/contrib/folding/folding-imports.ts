/**
 * Dardcor Code - Collapse Import Statements Strategy
 */

import { ITextModel } from "../../model/text-model.js";
import { IFoldingRange } from "./folding-ranges.js";
import { FoldingRegion } from "./folding-region.js";

export interface IImportBlock {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly importCount: number;
}

export interface IImportFoldStrategyOptions {
	readonly maxImportLines: number;
	readonly blankLineThreshold: number;
}

const DEFAULT_OPTIONS: IImportFoldStrategyOptions = {
	maxImportLines: 500,
	blankLineThreshold: 2
};

const IMPORT_PATTERNS = [
	/^\s*import\s+/,
	/^\s*from\s+["'][^"']+["']\s*;?\s*$/,
	/^\s*export\s+(?:default\s+)?(?:import|from)\s+/
];

function isImportLine(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return false;
	}
	return IMPORT_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Detects consecutive import statement blocks (top-of-file or anywhere in the
 * document) and produces a single fold range covering each block, so the
 * "collapse imports" command can hide them with one action.
 */
export class FoldingImports {
	public static computeImportBlocks(model: ITextModel, options: IImportFoldStrategyOptions = { ...DEFAULT_OPTIONS }): IImportBlock[] {
		const blocks: IImportBlock[] = [];
		const lineCount = model.getLineCount();
		let start = -1;
		let end = -1;
		let count = 0;
		let blankLines = 0;

		const flush = () => {
			if (start !== -1 && count > 0) {
				blocks.push({ startLineNumber: start, endLineNumber: end, importCount: count });
			}
			start = -1;
			end = -1;
			count = 0;
			blankLines = 0;
		};

		for (let line = 1; line <= lineCount && count < options.maxImportLines; line++) {
			const text = model.getLineContent(line);
			if (isImportLine(text)) {
				if (start === -1) {
					start = line;
				}
				end = line;
				count++;
				blankLines = 0;
				continue;
			}
			if (text.trim().length === 0) {
				if (start !== -1) {
					blankLines++;
					if (blankLines >= options.blankLineThreshold) {
						flush();
					}
				}
				continue;
			}
			if (start !== -1) {
				flush();
			}
		}
		flush();
		return blocks;
	}

	public static computeFoldingRanges(model: ITextModel, options?: IImportFoldStrategyOptions): IFoldingRange[] {
		const blocks = FoldingImports.computeImportBlocks(model, options);
		return blocks
			.filter(block => block.endLineNumber > block.startLineNumber)
			.map(block => ({
				startLineNumber: block.startLineNumber,
				endLineNumber: block.endLineNumber,
				indentLevel: 0,
				isComment: false
			}));
	}

	public static collapseImports(model: ITextModel, collapse: (range: { startLineNumber: number; endLineNumber: number }) => void, options?: IImportFoldStrategyOptions): number {
		const ranges = FoldingImports.computeFoldingRanges(model, options);
		for (const range of ranges) {
			collapse(range);
		}
		return ranges.length;
	}

	public static isImportBlock(region: FoldingRegion, model: ITextModel): boolean {
		const line = model.getLineContent(region.startLineNumber);
		return isImportLine(line);
	}
}

export function findImportBlocks(model: ITextModel): IImportBlock[] {
	return FoldingImports.computeImportBlocks(model);
}

export function foldImportRegions(model: ITextModel, regions: readonly FoldingRegion[]): FoldingRegion[] {
	const importLines = new Set<number>();
	for (const block of FoldingImports.computeImportBlocks(model)) {
		for (let line = block.startLineNumber; line <= block.endLineNumber; line++) {
			importLines.add(line);
		}
	}
	return regions.filter(region => importLines.has(region.startLineNumber));
}
