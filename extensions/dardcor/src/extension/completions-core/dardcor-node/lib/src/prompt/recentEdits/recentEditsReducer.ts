/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RecentEditsConfig } from './recentEditsProvider';

export interface DiffHunk {
	file: string;
	pre: number;
	post: number;
	before: string[];
	removed: string[];
	added: string[];
	after: string[];
}

export interface RecentEdit {
	file: string;
	startLine: number;
	endLine: number;
	diff: DiffHunk;
	timestamp: number;
}

export type RecentEditMap = Record<string, { originalContent: string; currentContent: string; edits: RecentEdit[] }>;

export function getAllRecentEditsByTimestamp(map: RecentEditMap): RecentEdit[] {
	return Object.values(map)
		.flatMap(fileEntry => fileEntry.edits)
		.sort((a, b) => a.timestamp - b.timestamp);
}

export function findChangeSpan(
	prevLines: string[],
	newLines: string[]
): { start: number; endPrev: number; endNew: number } | null {
	let start = 0;
	while (start < prevLines.length && start < newLines.length && prevLines[start] === newLines[start]) {
		start++;
	}

	let endPrev = prevLines.length - 1;
	let endNew = newLines.length - 1;
	while (endPrev >= start && endNew >= start && prevLines[endPrev] === newLines[endNew]) {
		endPrev--;
		endNew--;
	}

	if (start > endPrev && start > endNew) { return null; }

	return { start, endPrev, endNew };
}

export function getDiff(
	file: string,
	prevLines: string[],
	newLines: string[],
	start: number,
	endPrev: number,
	endNew: number,
	context: number
): DiffHunk {
	const pre = Math.max(0, start - context);
	const post = Math.min(newLines.length, endNew + context + 1);

	return {
		file,
		pre,
		post,
		before: prevLines.slice(pre, start),
		removed: prevLines.slice(start, endPrev + 1),
		added: newLines.slice(start, endNew + 1),
		after: newLines.slice(endNew + 1, post),
	};
}

function measureDiffSize(hunk: DiffHunk): number {
	const allLines = [...hunk.before, ...hunk.removed, ...hunk.added, ...hunk.after];
	return allLines.reduce((acc, line) => acc + line.length + 1, 0);
}

export function unifiedDiff(
	hunk: DiffHunk,
	removeDeletedLines: boolean = false,
	insertionsBeforeDeletions: boolean = false,
	appendNoReplyMarker: boolean = false
): string {
	const out: string[] = [];

	out.push(`--- a/${hunk.file}`);
	out.push(`+++ b/${hunk.file}`);
	const oldLen = hunk.before.length + hunk.removed.length + hunk.after.length;
	const newLen = hunk.before.length + hunk.added.length + hunk.after.length;
	out.push(`@@ -${hunk.pre + 1},${oldLen} +${hunk.pre + 1},${newLen} @@`);

	for (const line of hunk.before) { out.push(' ' + line); }
	if (insertionsBeforeDeletions) {
		for (const line of hunk.added) { out.push('+' + line); }
	}
	if (!removeDeletedLines) {
		const deletedLinesSpecialText = appendNoReplyMarker ? ' --- IGNORE ---' : '';
		for (const line of hunk.removed) { out.push('-' + line + deletedLinesSpecialText); }
	}
	if (!insertionsBeforeDeletions) {
		for (const line of hunk.added) { out.push('+' + line); }
	}
	for (const line of hunk.after) { out.push(' ' + line); }

	return out.join('\n') + '\n';
}

function aidersDiff(hunk: DiffHunk, removeDeletedLines = false): string {
	const { before, removed, added, after } = hunk;
	const res: string[] = [];

	res.push('>>>>>>> SEARCH');
	res.push(...before);
	if (removeDeletedLines) {
		res.push('...');
	} else {
		res.push(...removed);
	}
	res.push(...after);

	res.push('=======');

	res.push(...before);
	res.push(...added);
	res.push(...after);

	res.push('<<<<<<<<< REPLACE');
	return res.join('\n');
}

export function findReplaceDiff(hunk: DiffHunk, removeDeletedLines = false): string {
	const { before, removed, added, after } = hunk;
	const removedWithWarning = removeDeletedLines
		? ['...']
		: removed.map(line => `${line} --- DO NOT REPLY WITH CODE FROM THIS LINE ---`);

	const beforeSection = [...before, ...removedWithWarning, ...after];
	const afterSection = [...before, ...added, ...after];

	const res: string[] = [];
	res.push('--- User edited code: ---');
	res.push(...beforeSection);

	if (removedWithWarning.length === 0) {
		res.push(`--- and added ${added.length} line${added.length === 1 ? '' : 's'} to make: ---`);
	} else if (added.length === 0) {
		res.push(
			`--- and deleted ${removedWithWarning.length} line${removedWithWarning.length === 1 ? '' : 's'} to make: ---`
		);
	} else {
		res.push('--- and replaced it with: ---');
	}

	res.push(...afterSection);
	res.push('--- End of edit ---');
	return res.join('\n');
}

function applyEditsToLines(lines: string[], edits: RecentEdit[]): string[] {
	for (const e of edits) {
		const before = lines.slice(0, e.startLine);
		const after = lines.slice(e.endLine + 1);
		const insert = e.diff.added ? e.diff.added : [];
		lines = [...before, ...insert, ...after];
	}
	return lines;
}

export function editsOverlap(incoming: RecentEdit, last: RecentEdit, editMergeLineDistance: number): boolean {
	const { added } = last.diff;
	const lastStart = last.startLine;
	const lastEnd = last.startLine + added.length;
	const incStart = incoming.startLine;
	const incEnd = incoming.endLine + 1;

	return incStart <= lastEnd + editMergeLineDistance && incEnd >= lastStart - editMergeLineDistance;
}

export function updateEdits(
	originalContent: string,
	existing: RecentEdit[],
	incoming: RecentEdit,
	currentFileLines: string[],
	config: RecentEditsConfig
): { originalContent: string; edits: RecentEdit[] } {
	let edits = [...existing];

	if (edits.length > 0) {
		const last = edits[edits.length - 1];
		const overlaps = editsOverlap(incoming, last, config.editMergeLineDistance);

		if (overlaps) {
			const prevLines = applyEditsToLines(originalContent.split('\n'), edits.slice(0, -1));

			const span = findChangeSpan(prevLines, currentFileLines);
			if (span) {
				incoming = buildIncomingEdit(incoming.file, prevLines, currentFileLines, span, config);
				edits = [...edits.slice(0, -1), incoming];
			}
		} else {
			edits.push(incoming);
		}
	} else {
		edits.push(incoming);
	}

	if (edits.length > config.maxEdits) {
		const staleEdits = edits.slice(0, edits.length - config.maxEdits);
		edits = edits.slice(edits.length - config.maxEdits, edits.length);
		const allLines = applyEditsToLines(originalContent.split('\n'), staleEdits);
		originalContent = allLines.join('\n');
	}

	return { originalContent, edits };
}

export function buildIncomingEdit(
	file: string,
	prevLines: string[],
	nextLines: string[],
	span: { start: number; endPrev: number; endNew: number },
	config: RecentEditsConfig
): RecentEdit {
	const { start, endPrev, endNew } = span;
	if (!config || typeof config.diffContextLines !== 'number') {
		throw new Error('Invalid configuration passed to buildIncomingEdit');
	}
	const diff = getDiff(file, prevLines, nextLines, start, endPrev, endNew, config.diffContextLines);

	return {
		file,
		startLine: start,
		endLine: endPrev,
		diff,
		timestamp: performance.now(),
	};
}

export function trimOldFilesFromState(state: RecentEditMap, maxFiles: number): RecentEditMap {
	const newState = { ...state };

	const modifiedFilesInOrder = Object.entries(state)
		.filter(([fileName]) => state[fileName].edits.length)
		.sort(
			([aFile, a], [bFile, b]) => a.edits[a.edits.length - 1].timestamp - b.edits[b.edits.length - 1].timestamp
		);

	const filesToTrim = Math.max(0, modifiedFilesInOrder.length - maxFiles);
	if (filesToTrim) {
		for (let i = 0; i < filesToTrim; i++) {
			const fileName = modifiedFilesInOrder[i][0];
			delete newState[fileName];
		}
	}

	return newState;
}

export function recentEditsReducer(
	state: RecentEditMap = {},
	file: string,
	newContents: string,
	config: RecentEditsConfig
): RecentEditMap {
	if (newContents.length > 2 * 1024 * 1024) {
		return state;
	}

	const prev = state[file];

	if (!prev) {
		return {
			...state,
			[file]: {
				originalContent: newContents,
				currentContent: newContents,
				edits: [],
			},
		};
	}

	if (prev.currentContent === newContents) {
		return state;
	}

	const prevLines = prev.currentContent.split('\n');
	const newLines = newContents.split('\n');

	const span = findChangeSpan(prevLines, newLines);
	if (!span) {
		return {
			...state,
			[file]: { ...prev, currentContent: newContents },
		};
	}

	const incoming = buildIncomingEdit(file, prevLines, newLines, span, config);
	if (measureDiffSize(incoming.diff) > config.maxCharsPerEdit) {
		return {
			...state,
			[file]: {
				originalContent: newContents,
				currentContent: newContents,
				edits: [],
			},
		};
	}

	const { originalContent: updatedOriginal, edits: updatedEdits } = updateEdits(
		prev.originalContent,
		prev.edits,
		incoming,
		newLines,
		config
	);

	const stateWithLatestEdit = {
		...state,
		[file]: {
			originalContent: updatedOriginal,
			currentContent: newContents,
			edits: updatedEdits,
		},
	};

	return trimOldFilesFromState(stateWithLatestEdit, config.maxFiles);
}

export function summarizeEdit(edit: RecentEdit, config: RecentEditsConfig): string | null {
	const oldNonEmptyLines: string[] = edit.diff.removed.filter(x => x.trim().length > 0);
	const newNonEmptyLines: string[] = edit.diff.added.filter(x => x.trim().length > 0);

	let result: string | null;
	if (config.removeDeletedLines && newNonEmptyLines.length === 0) {
		result = null;
	} else if (oldNonEmptyLines.length === 0 && newNonEmptyLines.length === 0) {
		result = null;
	} else if (oldNonEmptyLines.join('').trim() === newNonEmptyLines.join('').trim()) {
		result = null;
	} else if (edit.diff.added.length > config.maxLinesPerEdit || edit.diff.removed.length > config.maxLinesPerEdit) {
		result = null;
	} else if (config.summarizationFormat === 'aiders-diff') {
		result = aidersDiff(edit.diff);
	} else if (config.summarizationFormat === 'diff') {
		result = unifiedDiff(
			edit.diff,
			config.removeDeletedLines,
			config.insertionsBeforeDeletions,
			config.appendNoReplyMarker
		);
	} else if (config.summarizationFormat === 'find-replace') {
		result = findReplaceDiff(edit.diff);
	} else {
		throw new Error(`Unknown summarization format: ${config.summarizationFormat}`);
	}

	return result;
}
