/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { isLocation } from '../../../../../editor/common/languages.js';
import { IChatProgressRenderableResponseContent, IChatProgressResponseContent, appendMarkdownString, canMergeMarkdownStrings } from '../model/chatModel.js';
import { IChatAgentVulnerabilityDetails } from '../chatService/chatService.js';

export const contentRefUrl = 'http://_vscodecontentref_';

export interface IAnnotatedChatContent {
	readonly content: IChatProgressRenderableResponseContent;
	readonly sourceIndexes: readonly number[];
}

export function annotateSpecialMarkdownContentWithSource(response: Iterable<IChatProgressResponseContent>): IAnnotatedChatContent[] {
	let refIdPool = 0;

	const result: IAnnotatedChatContent[] = [];
	let sourceIndex = 0;
	for (const item of response) {
		const currentSourceIndex = sourceIndex++;
		const previousItemIndex = result.findLastIndex(p => p.content.kind !== 'textEditGroup' && p.content.kind !== 'undoStop');
		const previousEntry = result[previousItemIndex];
		const previousItem = previousEntry?.content;
		if (item.kind === 'inlineReference') {
			let label: string | undefined = item.name;
			if (!label) {
				if (URI.isUri(item.inlineReference)) {
					label = basename(item.inlineReference);
				} else if (isLocation(item.inlineReference)) {
					label = basename(item.inlineReference.uri);
				} else {
					label = item.inlineReference.name;
				}
			}

			const previousText = previousItem?.kind === 'markdownContent' ? previousItem.content.value : '';
			if (isInsideCodeContext(previousText)) {
				if (previousItem?.kind === 'markdownContent') {
					const merged = appendMarkdownString(previousItem.content, new MarkdownString(label));
					result[previousItemIndex] = {
						content: { ...previousItem, content: merged },
						sourceIndexes: [...previousEntry.sourceIndexes, currentSourceIndex],
					};
				} else {
					result.push({
						content: { content: new MarkdownString(label), kind: 'markdownContent' },
						sourceIndexes: [currentSourceIndex],
					});
				}
			} else {
				const refId = refIdPool++;
				const printUri = URI.parse(contentRefUrl).with({ path: String(refId) });
				const markdownText = `[${label}](${printUri.toString()})`;

				const annotationMetadata = { [refId]: item };

				if (previousItem?.kind === 'markdownContent') {
					const merged = appendMarkdownString(previousItem.content, new MarkdownString(markdownText));
					result[previousItemIndex] = {
						content: { ...previousItem, content: merged, inlineReferences: { ...annotationMetadata, ...(previousItem.inlineReferences || {}) } },
						sourceIndexes: [...previousEntry.sourceIndexes, currentSourceIndex],
					};
				} else {
					result.push({
						content: { content: new MarkdownString(markdownText), inlineReferences: annotationMetadata, kind: 'markdownContent' },
						sourceIndexes: [currentSourceIndex],
					});
				}
			}
		} else if (item.kind === 'markdownContent' && previousItem?.kind === 'markdownContent') {
			if (canMergeMarkdownStrings(previousItem.content, item.content)) {
				const merged = appendMarkdownString(previousItem.content, item.content);
				result[previousItemIndex] = {
					content: { ...previousItem, content: merged },
					sourceIndexes: [...previousEntry.sourceIndexes, currentSourceIndex],
				};
			} else if (previousItem.inlineReferences && isContentRefOnly(previousItem.content.value)) {
				result[previousItemIndex] = {
					content: {
						...previousItem,
						content: {
							...item.content,
							value: previousItem.content.value + item.content.value,
						},
					},
					sourceIndexes: [...previousEntry.sourceIndexes, currentSourceIndex],
				};
			} else {
				result.push({ content: item, sourceIndexes: [currentSourceIndex] });
			}
		} else if (item.kind === 'markdownVuln') {
			const vulnText = encodeURIComponent(JSON.stringify(item.vulnerabilities));
			const markdownText = `<vscode_annotation details='${vulnText}'>${item.content.value}</vscode_annotation>`;
			if (previousItem?.kind === 'markdownContent') {
				const merged = appendMarkdownString(previousItem.content, new MarkdownString(markdownText));
				result[previousItemIndex] = {
					content: { ...previousItem, content: merged },
					sourceIndexes: [...previousEntry.sourceIndexes, currentSourceIndex],
				};
			} else {
				result.push({
					content: { content: new MarkdownString(markdownText), kind: 'markdownContent' },
					sourceIndexes: [currentSourceIndex],
				});
			}
		} else if (item.kind === 'codeblockUri') {
			if (previousItem?.kind === 'markdownContent') {
				const isEditText = item.isEdit ? ` isEdit` : '';
				const subAgentText = item.subAgentInvocationId ? ` subAgentInvocationId="${encodeURIComponent(item.subAgentInvocationId)}"` : '';
				const markdownText = `<vscode_codeblock_uri${isEditText}${subAgentText}>${item.uri.toString()}</vscode_codeblock_uri>`;
				const merged = appendMarkdownString(previousItem.content, new MarkdownString(markdownText));
				result.splice(previousItemIndex, 1);
				result.push({
					content: { ...previousItem, content: merged },
					sourceIndexes: [...previousEntry.sourceIndexes, currentSourceIndex],
				});
			}
		} else if (item.kind === 'voiceProgress') {
			continue;
		} else {
			result.push({ content: item, sourceIndexes: [currentSourceIndex] });
		}
	}

	return result;
}

export function annotateSpecialMarkdownContent(response: Iterable<IChatProgressResponseContent>): IChatProgressRenderableResponseContent[] {
	return annotateSpecialMarkdownContentWithSource(response).map(entry => entry.content);
}

const contentRefPattern = new RegExp(`^(\\[.*?\\]\\(${contentRefUrl}/\\d+\\))+$`);

function isContentRefOnly(text: string): boolean {
	return contentRefPattern.test(text);
}

export function isInsideCodeContext(text: string): boolean {
	const lines = text.split('\n');
	let inFencedBlock = false;
	let fenceChar = '';
	let fenceLength = 0;
	const unfencedLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trimStart();

		if (inFencedBlock) {
			const closeLength = countLeadingChar(trimmed, fenceChar);
			if (closeLength >= fenceLength && trimmed.substring(closeLength).trim() === '') {
				inFencedBlock = false;
				unfencedLines.length = 0;
			}
			continue;
		}

		const firstChar = trimmed[0];
		if (firstChar === '`' || firstChar === '~') {
			const openLength = countLeadingChar(trimmed, firstChar);
			if (openLength >= 3 && (firstChar === '~' || !trimmed.substring(openLength).includes('`'))) {
				inFencedBlock = true;
				fenceChar = firstChar;
				fenceLength = openLength;
				unfencedLines.length = 0;
				continue;
			}
		}

		unfencedLines.push(line);
	}

	return inFencedBlock || hasUnclosedInlineCode(unfencedLines.join('\n'));
}

function countLeadingChar(text: string, char: string): number {
	let count = 0;
	while (count < text.length && text[count] === char) {
		count++;
	}
	return count;
}

function hasUnclosedInlineCode(text: string): boolean {
	let i = 0;
	while (i < text.length) {
		if (text[i] !== '`') {
			i++;
			continue;
		}

		const openLen = countLeadingChar(text.substring(i), '`');
		i += openLen;

		let found = false;
		while (i < text.length) {
			if (text[i] !== '`') {
				i++;
				continue;
			}
			const closeLen = countLeadingChar(text.substring(i), '`');
			i += closeLen;
			if (closeLen === openLen) {
				found = true;
				break;
			}
		}

		if (!found) {
			return true;
		}
	}

	return false;
}

export interface IMarkdownVulnerability {
	readonly title: string;
	readonly description: string;
	readonly range: IRange;
}
export function extractCodeblockUrisFromText(text: string): { uri: URI; isEdit?: boolean; subAgentInvocationId?: string; textWithoutResult: string } | undefined {
	const match = /<vscode_codeblock_uri( isEdit)?( subAgentInvocationId="([^"]*)")?>([\s\S]*?)<\/vscode_codeblock_uri>/ms.exec(text);
	if (match) {
		const [all, isEdit, , encodedSubAgentId, uriString] = match;
		if (uriString) {
			let result: URI;
			try {
				result = URI.parse(uriString);
			} catch {
				return undefined;
			}
			const textWithoutResult = text.substring(0, match.index) + text.substring(match.index + all.length);
			let subAgentInvocationId: string | undefined;
			if (encodedSubAgentId) {
				try {
					subAgentInvocationId = decodeURIComponent(encodedSubAgentId);
				} catch {
					subAgentInvocationId = encodedSubAgentId;
				}
			}
			return { uri: result, textWithoutResult, isEdit: !!isEdit, subAgentInvocationId };
		}
	}
	return undefined;
}

export function extractSubAgentInvocationIdFromText(text: string): string | undefined {
	const match = /<vscode_codeblock_uri[^>]* subAgentInvocationId="([^"]*)"/ms.exec(text);
	if (match) {
		try {
			return decodeURIComponent(match[1]);
		} catch {
			return match[1];
		}
	}
	return undefined;
}

export function hasCodeblockUriTag(text: string): boolean {
	return text.includes('<vscode_codeblock_uri');
}

export function hasEditCodeblockUriTag(text: string): boolean {
	return text.includes('<vscode_codeblock_uri isEdit');
}

export function extractVulnerabilitiesFromText(text: string): { newText: string; vulnerabilities: IMarkdownVulnerability[] } {
	const vulnerabilities: IMarkdownVulnerability[] = [];
	let newText = text;
	let match: RegExpExecArray | null;
	while ((match = /<vscode_annotation details='(.*?)'>(.*?)<\/vscode_annotation>/ms.exec(newText)) !== null) {
		const [full, details, content] = match;
		const start = match.index;
		const textBefore = newText.substring(0, start);
		const linesBefore = textBefore.split('\n').length - 1;
		const linesInside = content.split('\n').length - 1;

		const previousNewlineIdx = textBefore.lastIndexOf('\n');
		const startColumn = start - (previousNewlineIdx + 1) + 1;
		const endPreviousNewlineIdx = (textBefore + content).lastIndexOf('\n');
		const endColumn = start + content.length - (endPreviousNewlineIdx + 1) + 1;

		try {
			const vulnDetails: IChatAgentVulnerabilityDetails[] = JSON.parse(decodeURIComponent(details));
			vulnDetails.forEach(({ title, description }) => vulnerabilities.push({
				title, description, range: { startLineNumber: linesBefore + 1, startColumn, endLineNumber: linesBefore + linesInside + 1, endColumn }
			}));
		} catch (err) {
		}
		newText = newText.substring(0, start) + content + newText.substring(start + full.length);
	}

	return { newText, vulnerabilities };
}
