/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResponseFormat } from '../../src/platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { assertNever } from '../../src/util/dardcor/base/common/assert';
import { splitLines } from '../../src/util/dardcor/base/common/strings';
import { StringText } from '../../src/util/dardcor/editor/common/core/text/abstractText';

export interface IGeneratedResponse {
	readonly assistant: string;
	readonly droppedEditCount?: number;
}

export type ResponseLogger = (message: string) => void;

export function applyEditsToContent(
	content: string,
	edits: readonly (readonly [start: number, endEx: number, text: string])[],
): string {
	const sorted = [...edits].sort((a, b) => b[0] - a[0]);
	let result = content;
	for (const [start, endEx, text] of sorted) {
		result = result.substring(0, start) + text + result.substring(endEx);
	}
	return result;
}

export function formatAsCustomDiffPatch(
	oracleEdits: readonly (readonly [start: number, endEx: number, text: string])[],
	docContent: string,
	filePath: string,
): string {
	const modifiedContent = applyEditsToContent(docContent, oracleEdits);

	const oldLines = splitLines(docContent);
	const newLines = splitLines(modifiedContent);

	const patches: string[] = [];
	const maxLen = Math.max(oldLines.length, newLines.length);

	let i = 0;
	while (i < maxLen) {
		const oldLine = i < oldLines.length ? oldLines[i] : undefined;
		const newLine = i < newLines.length ? newLines[i] : undefined;

		if (oldLine === newLine) {
			i++;
			continue;
		}

		const startLine = i;
		const removedLines: string[] = [];
		const addedLines: string[] = [];

		while (i < maxLen) {
			const ol = i < oldLines.length ? oldLines[i] : undefined;
			const nl = i < newLines.length ? newLines[i] : undefined;

			if (ol === nl) {
				break;
			}

			if (ol !== undefined) {
				removedLines.push(ol);
			}
			if (nl !== undefined) {
				addedLines.push(nl);
			}
			i++;
		}

		if (removedLines.length > 0 && addedLines.length > 0) {
			patches.push([
				`${filePath}:${startLine}`,
				...removedLines.map(l => `-${l}`),
				...addedLines.map(l => `+${l}`),
			].join('\n'));
		} else if (removedLines.length > 0) {
			patches.push([
				`${filePath}:${startLine}`,
				...removedLines.map(l => `-${l}`),
				`+`,
			].join('\n'));
		} else if (addedLines.length > 0) {
			const anchorLine = startLine > 0 ? oldLines[startLine - 1] : '';
			patches.push([
				`${filePath}:${Math.max(0, startLine - 1)}`,
				`-${anchorLine}`,
				`+${anchorLine}`,
				...addedLines.map(l => `+${l}`),
			].join('\n'));
		}
	}

	return patches.join('\n');
}

export function parseEditWindowFromPrompt(userPrompt: string): {
	lines: string[];
	lineCount: number;
} | undefined {
	const startTag = '<|code_to_edit|>';
	const endTag = '<|/code_to_edit|>';

	const startIdx = userPrompt.indexOf(startTag);
	const endIdx = userPrompt.indexOf(endTag);

	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return undefined;
	}

	const windowContent = userPrompt.substring(startIdx + startTag.length, endIdx);
	const lines = windowContent.split('\n');

	while (lines.length > 0 && lines[0].trim() === '') {
		lines.shift();
	}
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}

	return { lines, lineCount: lines.length };
}

function getEditLineRange(
	transformer: ReturnType<StringText['getTransformer']>,
	edit: readonly [start: number, endEx: number, text: string],
): [startLine: number, endLine: number] {
	const [start, endEx] = edit;
	return [
		transformer.getPosition(start).lineNumber - 1,
		transformer.getPosition(endEx).lineNumber - 1,
	];
}

function countNewlines(s: string, start: number, endEx: number): number {
	let n = 0;
	for (let i = start; i < endEx; i++) {
		if (s.charCodeAt(i) === 10 ) {
			n++;
		}
	}
	return n;
}

export function filterEditsInsideEditWindow(
	oracleEdits: readonly (readonly [start: number, endEx: number, text: string])[],
	docContent: string,
	windowStart: number,
	windowEnd: number,
): {
	kept: readonly (readonly [start: number, endEx: number, text: string])[];
	droppedCount: number;
} {
	const transformer = new StringText(docContent).getTransformer();
	const kept: (readonly [start: number, endEx: number, text: string])[] = [];
	let droppedCount = 0;
	for (const edit of oracleEdits) {
		const [editStartLine, editEndLine] = getEditLineRange(transformer, edit);
		const fullyInside = editStartLine >= windowStart && editEndLine < windowEnd;
		if (fullyInside) {
			kept.push(edit);
		} else {
			droppedCount++;
		}
	}
	return { kept, droppedCount };
}

export function formatAsEditWindowOnly(
	oracleEdits: readonly (readonly [start: number, endEx: number, text: string])[],
	docContent: string,
	editWindowStartLine: number,
	editWindowLineCount: number,
): { assistant: string; droppedCount: number } {
	const windowStart = editWindowStartLine;
	const windowEnd = editWindowStartLine + editWindowLineCount;

	const { kept, droppedCount } = filterEditsInsideEditWindow(
		oracleEdits, docContent, windowStart, windowEnd,
	);

	const modifiedContent = applyEditsToContent(docContent, kept);
	const modifiedLines = splitLines(modifiedContent);

	let netLineChange = 0;
	for (const [start, endEx, text] of kept) {
		const oldNewlines = countNewlines(docContent, start, endEx);
		const newNewlines = countNewlines(text, 0, text.length);
		netLineChange += newNewlines - oldNewlines;
	}

	const newEndLine = Math.min(windowEnd + netLineChange, modifiedLines.length);
	const windowLines = modifiedLines.slice(windowStart, newEndLine);

	return { assistant: windowLines.join('\n'), droppedCount };
}

export function findEditWindowStartLine(
	docContent: string,
	editWindowLines: string[],
): number {
	if (editWindowLines.length === 0) {
		return 0;
	}

	const docLines = splitLines(docContent);

	const cleanedWindowLines = editWindowLines.map(stripLineNumber);
	const cursorTag = '<|cursor|>';
	const matchLines = cleanedWindowLines.map(l => l.replace(cursorTag, ''));

	const firstWindowLine = matchLines[0];
	for (let i = 0; i <= docLines.length - matchLines.length; i++) {
		if (docLines[i] === firstWindowLine) {
			let allMatch = true;
			for (let j = 1; j < matchLines.length; j++) {
				if (docLines[i + j] !== matchLines[j]) {
					allMatch = false;
					break;
				}
			}
			if (allMatch) {
				return i;
			}
		}
	}

	const lineNumMatch = editWindowLines[0].match(/^(\d+)\|\s?/);
	if (lineNumMatch) {
		return parseInt(lineNumMatch[1], 10) - 1;
	}

	return 0;
}

function stripLineNumber(line: string): string {
	const match = line.match(/^\d+\|\s?/);
	if (match) {
		return line.substring(match[0].length);
	}
	return line;
}

export function generateResponse(
	responseFormat: ResponseFormat,
	edits: readonly (readonly [start: number, endEx: number, text: string])[] | undefined,
	docContent: string,
	filePath: string,
	userPrompt: string,
	log?: ResponseLogger,
): IGeneratedResponse | { error: string } {
	if (!edits || edits.length === 0) {
		return { error: `No edits available (file: ${filePath})` };
	}

	switch (responseFormat) {
		case ResponseFormat.CustomDiffPatch:
			return generateCustomDiffPatchResponse(edits, docContent, filePath);
		case ResponseFormat.EditWindowOnly:
			return generateEditWindowOnlyResponse(edits, docContent, filePath, userPrompt, log);
		case ResponseFormat.UnifiedWithXml:
		case ResponseFormat.CodeBlock:
		case ResponseFormat.EditWindowWithEditIntent:
		case ResponseFormat.EditWindowWithEditIntentShort:
			return { error: `Unsupported response format: ${responseFormat}` };
		default:
			assertNever(responseFormat);
	}
}

function generateCustomDiffPatchResponse(
	edits: readonly (readonly [start: number, endEx: number, text: string])[],
	docContent: string,
	filePath: string,
): IGeneratedResponse | { error: string } {
	const assistant = formatAsCustomDiffPatch(edits, docContent, filePath);
	if (!assistant) {
		return { error: `formatAsCustomDiffPatch produced empty result (file: ${filePath}, ${edits.length} edits)` };
	}
	return { assistant };
}

function generateEditWindowOnlyResponse(
	edits: readonly (readonly [start: number, endEx: number, text: string])[],
	docContent: string,
	filePath: string,
	userPrompt: string,
	log?: ResponseLogger,
): IGeneratedResponse | { error: string } {
	const editWindow = parseEditWindowFromPrompt(userPrompt);

	let startLine: number;
	let lineCount: number;

	if (editWindow) {
		startLine = findEditWindowStartLine(docContent, editWindow.lines);
		lineCount = editWindow.lineCount;
	} else {
		const transformer = new StringText(docContent).getTransformer();
		const editStartLine = transformer.getPosition(edits[0][0]).lineNumber - 1;
		const lastEdit = edits[edits.length - 1];
		const editEndLine = transformer.getPosition(lastEdit[1]).lineNumber - 1;
		const editSpan = editEndLine - editStartLine + 1;
		const padding = Math.max(10, Math.floor(editSpan * 0.5));
		const docLines = splitLines(docContent);
		startLine = Math.max(0, editStartLine - padding);
		lineCount = Math.min(editSpan + padding * 2, docLines.length - startLine);
	}

	const { assistant, droppedCount } = formatAsEditWindowOnly(edits, docContent, startLine, lineCount);

	if (droppedCount > 0) {
		log?.(`[${filePath}] dropped ${droppedCount}/${edits.length} oracle edit(s) outside edit window [${startLine}, ${startLine + lineCount})`);
	}

	if (!assistant || !assistant.trim()) {
		return { error: `formatAsEditWindowOnly produced empty result (file: ${filePath}, ${edits.length} edits, ${droppedCount} dropped, window: ${startLine}+${lineCount})` };
	}
	return { assistant, droppedEditCount: droppedCount };
}

export interface IResponseGenerationInput {
	readonly index: number;
	readonly oracleEdits: readonly (readonly [start: number, endEx: number, text: string])[] | undefined;
	readonly docContent: string;
	readonly filePath: string;
	readonly userPrompt: string;
}

export function generateAllResponses(
	responseFormat: ResponseFormat,
	inputs: readonly IResponseGenerationInput[],
	log?: ResponseLogger,
): {
	responses: { index: number; response: IGeneratedResponse }[];
	errors: { index: number; error: string }[];
} {
	const responses: { index: number; response: IGeneratedResponse }[] = [];
	const errors: { index: number; error: string }[] = [];

	for (const input of inputs) {
		const result = generateResponse(
			responseFormat,
			input.oracleEdits, input.docContent, input.filePath,
			input.userPrompt,
			log,
		);
		if ('error' in result) {
			errors.push({ index: input.index, error: result.error });
		} else {
			responses.push({ index: input.index, response: result });
		}
	}

	return { responses, errors };
}
