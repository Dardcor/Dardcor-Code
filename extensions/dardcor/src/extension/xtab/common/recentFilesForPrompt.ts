/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { DocumentId } from '../../../platform/inlineEdits/common/dataTypes/documentId';
import { LanguageContextResponse } from '../../../platform/inlineEdits/common/dataTypes/languageContext';
import * as xtabPromptOptions from '../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { PromptOptions, RecentFileClippingStrategy } from '../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { StatelessNextEditDocument } from '../../../platform/inlineEdits/common/statelessNextEditProvider';
import { IXtabHistoryEditEntry, IXtabHistoryEntry } from '../../../platform/inlineEdits/common/workspaceEditTracker/nesXtabHistoryTracker';
import { ContextKind } from '../../../platform/languageServer/common/languageContextService';
import { batchArrayElements } from '../../../util/common/arrays';
import { assertNever } from '../../../util/dardcor/base/common/assert';
import { illegalArgument } from '../../../util/dardcor/base/common/errors';
import { OffsetRange } from '../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { StringText } from '../../../util/dardcor/editor/common/core/text/abstractText';
import { expandRangeToPageRange } from './promptCrafting';
import { countTokensForLines, toUniquePath } from './promptCraftingUtils';
import { INeighborFileSnippet } from './similarFilesContextService';
import { PromptTags } from './tags';

export function getRecentCodeSnippets(
	activeDoc: StatelessNextEditDocument,
	xtabHistory: readonly IXtabHistoryEntry[],
	langCtx: LanguageContextResponse | undefined,
	computeTokens: (code: string) => number,
	opts: PromptOptions,
	neighborSnippets?: readonly INeighborFileSnippet[],
): {
	codeSnippets: string;
	documents: Set<DocumentId>;
	neighborSnippetsResult: AppendNeighborFileSnippetsResult | undefined;
	subsections: RecentlyViewedSubsectionSnippets;
} {

	const { includeViewedFiles, nDocuments, clippingStrategy } = opts.recentlyViewedDocuments;

	let recentlyViewedCodeSnippets: RecentCodeSnippet[];

	if (clippingStrategy === RecentFileClippingStrategy.Proportional) {
		const grouped = collectRecentDocumentsGrouped(xtabHistory, activeDoc.id, includeViewedFiles, nDocuments);
		recentlyViewedCodeSnippets = grouped.map(g => historyEntriesToCodeSnippet(g.entries));
	} else {
		const docsBesidesActiveDoc = collectRecentDocuments(xtabHistory, activeDoc.id, includeViewedFiles, nDocuments);
		recentlyViewedCodeSnippets = docsBesidesActiveDoc.map(d => historyEntryToCodeSnippet(d));
	}

	const { snippets, docsInPrompt } = buildCodeSnippetsUsingPagedClipping(recentlyViewedCodeSnippets, computeTokens, opts);

	const langCtxSnippets: string[] = [];
	if (langCtx) {
		appendLanguageContextSnippets(langCtx, langCtxSnippets, opts.languageContext.maxTokens, computeTokens);
	}

	const neighborOutSnippets: string[] = [];
	let neighborSnippetsResult: AppendNeighborFileSnippetsResult | undefined;
	if (opts.neighborFiles.enabled && neighborSnippets && neighborSnippets.length > 0) {
		neighborSnippetsResult = appendNeighborFileSnippets(neighborSnippets, neighborOutSnippets, docsInPrompt, opts.neighborFiles.maxTokens, computeTokens, opts.recentlyViewedDocuments.includeLineNumbers);
	}

	return {
		codeSnippets: [...snippets, ...langCtxSnippets, ...neighborOutSnippets].join('\n\n'),
		documents: docsInPrompt,
		neighborSnippetsResult,
		subsections: {
			recentlyViewedFiles: snippets.join('\n\n'),
			languageContext: langCtxSnippets.join('\n\n'),
			neighborFiles: neighborOutSnippets.join('\n\n'),
		},
	};
}

export interface RecentlyViewedSubsectionSnippets {
	readonly recentlyViewedFiles: string;
	readonly languageContext: string;
	readonly neighborFiles: string;
}

function formatLinesWithLineNumbers(
	lines: string[],
	includeLineNumbers: xtabPromptOptions.IncludeLineNumbersOption,
	startLineOffset: number,
): string[] {
	switch (includeLineNumbers) {
		case xtabPromptOptions.IncludeLineNumbersOption.WithSpaceAfter:
			return lines.map((line, idx) => `${startLineOffset + idx}| ${line}`);
		case xtabPromptOptions.IncludeLineNumbersOption.WithoutSpace:
			return lines.map((line, idx) => `${startLineOffset + idx}|${line}`);
		case xtabPromptOptions.IncludeLineNumbersOption.None:
			return lines;
		default:
			assertNever(includeLineNumbers);
	}
}

function formatCodeSnippet(
	documentId: DocumentId,
	lines: string[],
	opts: { truncated: boolean; includeLineNumbers: xtabPromptOptions.IncludeLineNumbersOption; startLineOffset: number }
): string {
	const filePath = toUniquePath(documentId, undefined);
	const firstLine = opts.truncated
		? `code_snippet_file_path: ${filePath} (truncated)`
		: `code_snippet_file_path: ${filePath}`;

	const formattedLines = formatLinesWithLineNumbers(lines, opts.includeLineNumbers, opts.startLineOffset);
	const fileContent = formattedLines.join('\n');
	return [PromptTags.RECENT_FILE.start, firstLine, fileContent, PromptTags.RECENT_FILE.end].join('\n');
}

function collectRecentDocuments(
	xtabHistory: readonly IXtabHistoryEntry[],
	activeDocId: DocumentId,
	includeViewedFiles: boolean,
	nDocuments: number,
): IXtabHistoryEntry[] {
	const result: IXtabHistoryEntry[] = [];
	const seenDocuments = new Set<DocumentId>();

	for (let i = xtabHistory.length - 1; i >= 0; --i) {
		const entry = xtabHistory[i];

		if (!includeViewedFiles && entry.kind === 'visibleRanges') {
			continue;
		}

		if (entry.docId === activeDocId || seenDocuments.has(entry.docId)) {
			continue;
		}
		result.push(entry);
		seenDocuments.add(entry.docId);
		if (result.length >= nDocuments) {
			break;
		}
	}

	return result;
}

interface GroupedDocumentEntries {
	readonly docId: DocumentId;
	readonly entries: IXtabHistoryEntry[];
}

function collectRecentDocumentsGrouped(
	xtabHistory: readonly IXtabHistoryEntry[],
	activeDocId: DocumentId,
	includeViewedFiles: boolean,
	nDocuments: number,
): GroupedDocumentEntries[] {
	const docOrder: DocumentId[] = [];
	const docEntries = new Map<DocumentId, IXtabHistoryEntry[]>();

	for (let i = xtabHistory.length - 1; i >= 0; --i) {
		const entry = xtabHistory[i];

		if (!includeViewedFiles && entry.kind === 'visibleRanges') {
			continue;
		}

		if (entry.docId === activeDocId) {
			continue;
		}

		const existing = docEntries.get(entry.docId);
		if (existing) {
			existing.push(entry);
		} else {
			if (docOrder.length >= nDocuments) {
				continue;
			}
			docOrder.push(entry.docId);
			docEntries.set(entry.docId, [entry]);
		}
	}

	return docOrder.map(docId => ({ docId, entries: docEntries.get(docId)! }));
}

export type RecentCodeSnippet = {
	readonly id: DocumentId;
	readonly content: StringText;
	readonly focalRanges?: readonly OffsetRange[];
	readonly editEntryCount?: number;
};

export function prepareRecentCodeSnippets(
	activeDoc: StatelessNextEditDocument,
	xtabHistory: readonly IXtabHistoryEntry[],
	opts: PromptOptions,
): RecentCodeSnippet[] {
	const { includeViewedFiles, nDocuments, clippingStrategy } = opts.recentlyViewedDocuments;
	if (clippingStrategy === RecentFileClippingStrategy.Proportional) {
		const grouped = collectRecentDocumentsGrouped(xtabHistory, activeDoc.id, includeViewedFiles, nDocuments);
		return grouped.map(g => historyEntriesToCodeSnippet(g.entries));
	}
	const docsBesidesActiveDoc = collectRecentDocuments(xtabHistory, activeDoc.id, includeViewedFiles, nDocuments);
	return docsBesidesActiveDoc.map(d => historyEntryToCodeSnippet(d));
}

export function selectFocalRangesWithinSpanCap(
	focalRanges: readonly OffsetRange[],
	getLineNumber: (offset: number) => number,
	maxSpanLines: number,
): readonly OffsetRange[] {
	if (focalRanges.length <= 1) {
		return focalRanges;
	}

	const selected: OffsetRange[] = [focalRanges[0]];
	let startLine = getLineNumber(focalRanges[0].start);
	let endLine = getLineNumber(Math.max(focalRanges[0].start, focalRanges[0].endExclusive - 1));

	for (let i = 1; i < focalRanges.length; i++) {
		const range = focalRanges[i];
		const rangeStartLine = getLineNumber(range.start);
		const rangeEndLine = getLineNumber(Math.max(range.start, range.endExclusive - 1));
		const candidateStart = Math.min(startLine, rangeStartLine);
		const candidateEnd = Math.max(endLine, rangeEndLine);
		if (candidateEnd - candidateStart > maxSpanLines) {
			break;
		}
		selected.push(range);
		startLine = candidateStart;
		endLine = candidateEnd;
	}

	return selected;
}

function historyEntryToCodeSnippet(d: IXtabHistoryEntry): RecentCodeSnippet {
	if (d.kind === 'edit') {
		const content = d.edit.edit.applyOnText(d.edit.base);
		return {
			id: d.docId,
			content,
			focalRanges: d.edit.edit.getNewRanges(),
			editEntryCount: 1,
		};
	}
	return {
		id: d.docId,
		content: d.documentContent,
		focalRanges: d.visibleRanges,
	};
}

export function historyEntriesToCodeSnippet(entries: IXtabHistoryEntry[]): RecentCodeSnippet {
	const mostRecent = entries[0];
	const content = mostRecent.kind === 'edit'
		? mostRecent.edit.edit.applyOnText(mostRecent.edit.base)
		: mostRecent.documentContent;

	const editEntries: IXtabHistoryEditEntry[] = [];
	for (const entry of entries) {
		if (entry.kind === 'edit') {
			editEntries.push(entry);
		}
	}

	const allFocalRanges: OffsetRange[] = [];
	for (let j = 0; j < editEntries.length; j++) {
		let ranges = editEntries[j].edit.edit.getNewRanges();
		for (let k = j - 1; k >= 0; k--) {
			ranges = ranges.map(r => editEntries[k].edit.edit.applyToOffsetRange(r));
		}
		allFocalRanges.push(...ranges);
	}

	return {
		id: mostRecent.docId,
		content,
		focalRanges: allFocalRanges.length > 0 ? allFocalRanges : undefined,
		editEntryCount: Math.max(editEntries.length, 1),
	};
}

export function appendLanguageContextSnippets(
	langCtx: LanguageContextResponse,
	snippets: string[],
	tokenBudget: number,
	computeTokens: (code: string) => number,
): number {
	const initialBudget = tokenBudget;
	for (const langCtxEntry of langCtx.items) {
		if (langCtxEntry.onTimeout) {
			continue;
		}

		const ctx = langCtxEntry.context;
		if (ctx.kind === ContextKind.Snippet) {
			const langCtxSnippet = ctx.value;
			const potentialBudget = tokenBudget - computeTokens(langCtxSnippet);
			if (potentialBudget < 0) {
				break;
			}
			const documentId = DocumentId.create(ctx.uri.toString());
			snippets.push(formatCodeSnippet(documentId, langCtxSnippet.split(/\r?\n/), {
				truncated: false,
				includeLineNumbers: xtabPromptOptions.IncludeLineNumbersOption.None,
				startLineOffset: 0,
			}));
			tokenBudget = potentialBudget;
		}
	}
	return initialBudget - tokenBudget;
}

export interface AppendNeighborFileSnippetsResult {
	readonly nComputed: number;
	readonly nIncluded: number;
	readonly includedIndices: readonly number[];
	readonly tokensConsumed: number;
}

export function appendNeighborFileSnippets(
	neighborSnippets: readonly INeighborFileSnippet[],
	snippets: string[],
	docsInPrompt: Set<DocumentId>,
	tokenBudget: number,
	computeTokens: (code: string) => number,
	includeLineNumbers: xtabPromptOptions.IncludeLineNumbersOption,
): AppendNeighborFileSnippetsResult {
	const initialBudget = tokenBudget;
	const selected: { snippet: INeighborFileSnippet; originalIndex: number }[] = [];
	for (let i = neighborSnippets.length - 1; i >= 0; i--) {
		const neighborSnippet = neighborSnippets[i];
		const documentId = DocumentId.create(neighborSnippet.uri);
		if (docsInPrompt.has(documentId)) {
			continue;
		}
		const potentialBudget = tokenBudget - computeTokens(neighborSnippet.snippet);
		if (potentialBudget < 0) {
			continue;
		}
		selected.push({ snippet: neighborSnippet, originalIndex: i });
		docsInPrompt.add(documentId);
		tokenBudget = potentialBudget;
	}
	for (let i = selected.length - 1; i >= 0; i--) {
		const neighborSnippet = selected[i].snippet;
		const snippetIncludeLineNumbers = neighborSnippet.isFromRelatedFile
			? xtabPromptOptions.IncludeLineNumbersOption.None
			: includeLineNumbers;
		snippets.push(formatCodeSnippet(
			DocumentId.create(neighborSnippet.uri),
			neighborSnippet.snippet.split(/\r?\n/),
			{ truncated: false, includeLineNumbers: snippetIncludeLineNumbers, startLineOffset: neighborSnippet.lineRange.startLine },
		));
	}
	const includedIndices = selected.map(s => s.originalIndex).sort((a, b) => a - b);
	return {
		nComputed: neighborSnippets.length,
		nIncluded: selected.length,
		includedIndices,
		tokensConsumed: initialBudget - tokenBudget,
	};
}

function clipFullDocument(
	document: { id: DocumentId; content: StringText },
	pages: Iterable<string[]>,
	totalLineCount: number,
	tokenBudget: number,
	computeTokens: (s: string) => number,
	includeLineNumbers: xtabPromptOptions.IncludeLineNumbersOption,
	result: { snippets: string[]; docsInPrompt: Set<DocumentId> },
): number {
	let allowedBudget = tokenBudget;
	const linesToKeep: string[] = [];

	for (const page of pages) {
		const allowedBudgetLeft = allowedBudget - countTokensForLines(page, computeTokens);
		if (allowedBudgetLeft < 0) {
			break;
		}
		linesToKeep.push(...page);
		allowedBudget = allowedBudgetLeft;
	}

	if (linesToKeep.length > 0) {
		const isTruncated = linesToKeep.length !== totalLineCount;
		result.docsInPrompt.add(document.id);
		result.snippets.push(formatCodeSnippet(document.id, linesToKeep, { truncated: isTruncated, includeLineNumbers, startLineOffset: 0 }));
	}

	return allowedBudget;
}

export function computeFocalPageCost(
	content: StringText,
	focalRanges: readonly OffsetRange[],
	pageSize: number,
	computeTokens: (s: string) => number,
): number | undefined {
	const contentTransform = content.getTransformer();
	const maxFocalSpanLines = pageSize * 3;
	const capped = selectFocalRangesWithinSpanCap(
		focalRanges,
		offset => contentTransform.getPosition(offset).lineNumber,
		maxFocalSpanLines,
	);

	if (capped.length === 0) {
		return undefined;
	}

	const startOffset = Math.min(...capped.map(r => r.start));
	const endOffset = Math.max(...capped.map(r => r.endExclusive - 1));
	const startLine = contentTransform.getPosition(startOffset).lineNumber;
	const endLine = contentTransform.getPosition(endOffset).lineNumber;

	const lines = content.getLines();
	const firstPageIdx = Math.floor((startLine - 1) / pageSize);
	const lastPageIdxIncl = Math.floor((endLine - 1) / pageSize);

	let cost = 0;
	for (let p = firstPageIdx; p <= lastPageIdxIncl; p++) {
		const start = p * pageSize;
		const end = Math.min(start + pageSize, lines.length);
		cost += countTokensForLines(lines.slice(start, end), computeTokens);
	}
	return cost;
}

function clipAroundFocalRanges(
	document: { id: DocumentId; content: StringText; focalRanges: readonly OffsetRange[] },
	pageSize: number,
	totalLineCount: number,
	tokenBudget: number,
	computeTokens: (s: string) => number,
	includeLineNumbers: xtabPromptOptions.IncludeLineNumbersOption,
	useLeftoverBudgetFromAbove: boolean,
	result: { snippets: string[]; docsInPrompt: Set<DocumentId> },
): number | undefined {
	if (tokenBudget <= 0) {
		return undefined;
	}

	const contentTransform = document.content.getTransformer();

	const maxFocalSpanLines = pageSize * 3;
	const focalRanges = selectFocalRangesWithinSpanCap(
		document.focalRanges,
		offset => contentTransform.getPosition(offset).lineNumber,
		maxFocalSpanLines,
	);

	if (focalRanges.length === 0) {
		return tokenBudget;
	}

	const startOffset = Math.min(...focalRanges.map(range => range.start));
	const endOffset = Math.max(...focalRanges.map(range => range.endExclusive - 1));
	const startPos = contentTransform.getPosition(startOffset);
	const endPos = contentTransform.getPosition(endOffset);

	const { firstPageIdx, lastPageIdxIncl, budgetLeft } = expandRangeToPageRange(
		document.content.getLines(),
		new OffsetRange(startPos.lineNumber - 1 , endPos.lineNumber),
		pageSize,
		tokenBudget,
		computeTokens,
		false,
		useLeftoverBudgetFromAbove
	);

	if (budgetLeft === tokenBudget) {
		return undefined;
	}

	if (budgetLeft < 0) {
		return undefined;
	}

	const startLineOffset = firstPageIdx * pageSize;
	const linesToKeep = document.content.getLines().slice(startLineOffset, (lastPageIdxIncl + 1) * pageSize);
	result.docsInPrompt.add(document.id);
	result.snippets.push(formatCodeSnippet(document.id, linesToKeep, { truncated: linesToKeep.length < totalLineCount, includeLineNumbers, startLineOffset }));
	return budgetLeft;
}

export function buildCodeSnippetsUsingPagedClipping(
	recentlyViewedCodeSnippets: RecentCodeSnippet[],
	computeTokens: (s: string) => number,
	opts: PromptOptions,
): { snippets: string[]; docsInPrompt: Set<DocumentId>; tokensConsumed: number } {

	const pageSize = opts.pagedClipping?.pageSize;
	if (pageSize === undefined) {
		throw illegalArgument('Page size must be defined');
	}

	const clippingStrategy = opts.recentlyViewedDocuments.clippingStrategy;

	if (clippingStrategy === RecentFileClippingStrategy.Proportional) {
		return buildCodeSnippetsWithProportionalBudget(recentlyViewedCodeSnippets, computeTokens, opts, pageSize);
	}

	return buildCodeSnippetsGreedy(recentlyViewedCodeSnippets, computeTokens, opts, pageSize);
}

function buildCodeSnippetsGreedy(
	recentlyViewedCodeSnippets: RecentCodeSnippet[],
	computeTokens: (s: string) => number,
	opts: PromptOptions,
	pageSize: number,
): { snippets: string[]; docsInPrompt: Set<DocumentId>; tokensConsumed: number } {

	const result: { snippets: string[]; docsInPrompt: Set<DocumentId> } = {
		snippets: [],
		docsInPrompt: new Set<DocumentId>(),
	};

	const initialBudget = opts.recentlyViewedDocuments.maxTokens;
	let maxTokenBudget = initialBudget;
	const includeLineNumbers = opts.recentlyViewedDocuments.includeLineNumbers;
	const useLeftoverBudgetFromAbove = opts.recentlyViewedDocuments.useLeftoverBudgetFromAbove;

	for (const file of recentlyViewedCodeSnippets) {
		const lines = file.content.getLines();

		if (file.focalRanges !== undefined) {
			const budgetLeft = clipAroundFocalRanges(
				file as { id: DocumentId; content: StringText; focalRanges: readonly OffsetRange[] },
				pageSize, lines.length, maxTokenBudget, computeTokens, includeLineNumbers, useLeftoverBudgetFromAbove, result
			);
			if (budgetLeft === undefined) {
				break;
			}
			maxTokenBudget = budgetLeft;
		} else {
			const pages = batchArrayElements(lines, pageSize);
			maxTokenBudget = clipFullDocument(file, pages, lines.length, maxTokenBudget, computeTokens, includeLineNumbers, result);
		}
	}

	return { snippets: result.snippets.reverse(), docsInPrompt: result.docsInPrompt, tokensConsumed: initialBudget - maxTokenBudget };
}

function buildCodeSnippetsWithProportionalBudget(
	recentlyViewedCodeSnippets: RecentCodeSnippet[],
	computeTokens: (s: string) => number,
	opts: PromptOptions,
	pageSize: number,
): { snippets: string[]; docsInPrompt: Set<DocumentId>; tokensConsumed: number } {

	const result: { snippets: string[]; docsInPrompt: Set<DocumentId> } = {
		snippets: [],
		docsInPrompt: new Set<DocumentId>(),
	};

	const totalBudget = opts.recentlyViewedDocuments.maxTokens;
	const includeLineNumbers = opts.recentlyViewedDocuments.includeLineNumbers;
	const useLeftoverBudgetFromAbove = opts.recentlyViewedDocuments.useLeftoverBudgetFromAbove;

	if (recentlyViewedCodeSnippets.length === 0) {
		return { snippets: [], docsInPrompt: new Set(), tokensConsumed: 0 };
	}

	const focalCosts = recentlyViewedCodeSnippets.map(file =>
		file.focalRanges !== undefined && file.focalRanges.length > 0
			? computeFocalPageCost(file.content, file.focalRanges, pageSize, computeTokens) ?? 0
			: 0
	);

	let includedCount = recentlyViewedCodeSnippets.length;
	let sumFocalCosts = focalCosts.reduce((a, b) => a + b, 0);
	while (includedCount > 0 && sumFocalCosts > totalBudget) {
		includedCount--;
		sumFocalCosts -= focalCosts[includedCount];
	}

	if (includedCount === 0) {
		return { snippets: [], docsInPrompt: new Set(), tokensConsumed: 0 };
	}

	const expansionBudget = totalBudget - sumFocalCosts;

	const weights = recentlyViewedCodeSnippets.slice(0, includedCount).map(f => f.editEntryCount ?? 1);
	const totalWeight = weights.reduce((sum, w) => sum + w, 0);

	const expansionShares = weights.map(w => Math.floor(expansionBudget * (w / totalWeight)));

	let unspentBudget = 0;

	for (let i = 0; i < includedCount; i++) {
		const file = recentlyViewedCodeSnippets[i];
		const lines = file.content.getLines();
		const effectiveBudget = focalCosts[i] + expansionShares[i] + unspentBudget;

		if (file.focalRanges !== undefined && file.focalRanges.length > 0) {
			const budgetLeft = clipAroundFocalRanges(
				file as { id: DocumentId; content: StringText; focalRanges: readonly OffsetRange[] },
				pageSize, lines.length, effectiveBudget, computeTokens, includeLineNumbers, useLeftoverBudgetFromAbove, result
			);
			unspentBudget = budgetLeft ?? effectiveBudget;
		} else {
			const pages = batchArrayElements(lines, pageSize);
			unspentBudget = clipFullDocument(file, pages, lines.length, effectiveBudget, computeTokens, includeLineNumbers, result);
		}
	}

	return { snippets: result.snippets.reverse(), docsInPrompt: result.docsInPrompt, tokensConsumed: totalBudget - unspentBudget };
}
