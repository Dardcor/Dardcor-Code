/**
 * Dardcor Code - Collapse Block Comment Strategy
 */

import { ITextModel } from "../../model/text-model.js";
import { IFoldingRange } from "./folding-ranges.js";
import { FoldingRegion } from "./folding-region.js";

export interface ICommentBlock {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly isJSDoc: boolean;
}

export interface ICommentFoldOptions {
	readonly maxCommentLines: number;
	readonly onlyJSDoc: boolean;
}

const DEFAULT_OPTIONS: ICommentFoldOptions = {
	maxCommentLines: 500,
	onlyJSDoc: false
};

/**
 * Scans the document for block comment regions (/* ... *\/ and JSDoc
 * /** ... *\/) and produces fold ranges covering each multi-line comment.
 */
export class FoldingComments {
	public static computeCommentBlocks(model: ITextModel, options: ICommentFoldOptions = { ...DEFAULT_OPTIONS }): ICommentBlock[] {
		const blocks: ICommentBlock[] = [];
		const lineCount = model.getLineCount();
		let inComment = false;
		let commentStart = 0;
		let isJSDoc = false;

		const flush = (endLine: number) => {
			if (inComment) {
				if (endLine > commentStart) {
					blocks.push({
						startLineNumber: commentStart,
						endLineNumber: endLine,
						isJSDoc
					});
				}
				inComment = false;
				isJSDoc = false;
			}
		};

		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			const trimmed = text.trim();
			if (inComment) {
				if (trimmed.includes("*/")) {
					flush(line);
				}
				continue;
			}
			const startMatch = /\/\*+/.exec(trimmed);
			if (startMatch) {
				const isSingleLine = trimmed.includes("*/");
				if (isSingleLine) {
					continue;
				}
				inComment = true;
				commentStart = line;
				isJSDoc = trimmed.startsWith("/**");
				continue;
			}
		}
		flush(lineCount);
		if (inComment) {
			blocks.push({ startLineNumber: commentStart, endLineNumber: lineCount, isJSDoc });
		}
		return blocks.filter(block => block.endLineNumber - block.startLineNumber + 1 <= options.maxCommentLines);
	}

	public static computeFoldingRanges(model: ITextModel, options?: ICommentFoldOptions): IFoldingRange[] {
		const blocks = FoldingComments.computeCommentBlocks(model, options);
		return blocks
			.filter(block => block.endLineNumber > block.startLineNumber)
			.map(block => ({
				startLineNumber: block.startLineNumber,
				endLineNumber: block.endLineNumber,
				indentLevel: 0,
				isComment: true
			}));
	}

	public static collapseComments(model: ITextModel, collapse: (range: { startLineNumber: number; endLineNumber: number }) => void, options?: ICommentFoldOptions): number {
		const ranges = FoldingComments.computeFoldingRanges(model, options);
		for (const range of ranges) {
			collapse(range);
		}
		return ranges.length;
	}

	public static isCommentRegion(region: FoldingRegion): boolean {
		return region.isComment;
	}

	public static getJSDocBlocks(model: ITextModel): ICommentBlock[] {
		return FoldingComments.computeCommentBlocks(model, { ...DEFAULT_OPTIONS, onlyJSDoc: true }).filter(block => block.isJSDoc);
	}
}

export function findCommentBlocks(model: ITextModel): ICommentBlock[] {
	return FoldingComments.computeCommentBlocks(model);
}

export function foldCommentRegions(model: ITextModel, regions: readonly FoldingRegion[]): FoldingRegion[] {
	return regions.filter(region => region.isComment);
}
