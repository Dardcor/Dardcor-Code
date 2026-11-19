/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as marked from './marked/marked.js';

export interface IMarkdownEdit {
	readonly start: number;
	readonly end: number;
	readonly replacement: string;
}

function isOpaque(token: marked.Token): boolean {
	switch (token.type) {
		case 'code':
		case 'codespan':
		case 'html':
		case 'link':
		case 'image':
		case 'def':
			return true;
		default:
			return false;
	}
}

function childrenOf(token: marked.Token): readonly marked.Token[] {
	const candidate = token as {
		tokens?: marked.Token[];
		items?: marked.Token[];
		header?: { tokens?: marked.Token[] }[];
		rows?: { tokens?: marked.Token[] }[][];
	};

	if (candidate.items?.length) {
		return candidate.items;
	}
	if (candidate.header || candidate.rows) {
		const cells = [...(candidate.header ?? []), ...(candidate.rows ?? []).flat()];
		return cells.flatMap(cell => cell.tokens ?? []);
	}
	return candidate.tokens ?? [];
}

export function markdownTokensToPlainText(tokens: readonly marked.Token[]): string {
	let text = '';
	for (const token of tokens) {
		const children = (token as { tokens?: marked.Token[] }).tokens;
		text += children?.length
			? markdownTokensToPlainText(children)
			: (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw ?? '';
	}
	return text;
}

export interface IMarkdownRewriteContext {
	readonly codeRanges: readonly { readonly start: number; readonly end: number }[];
	readonly definitionRanges: readonly { readonly start: number; readonly end: number }[];
	readonly unlocatable: readonly (marked.Tokens.Link | marked.Tokens.Image)[];
}

export interface IMarkdownRewriter {
	rewriteLink(token: marked.Tokens.Link | marked.Tokens.Image): string | undefined;
	additionalEdits?(markdown: string, context: IMarkdownRewriteContext): readonly IMarkdownEdit[];
}

function collectEdits(tokens: readonly marked.Token[], markdown: string, cursor: number, rewriter: IMarkdownRewriter, edits: IMarkdownEdit[], codeRanges: { start: number; end: number }[], unlocatable: (marked.Tokens.Link | marked.Tokens.Image)[]): number {
	for (const token of tokens) {
		if (!isOpaque(token)) {
			const children = childrenOf(token);
			if (children.length) {
				cursor = collectEdits(children, markdown, cursor, rewriter, edits, codeRanges, unlocatable);
				continue;
			}
		}

		const raw = (token as { raw?: string }).raw ?? '';
		if (!raw) {
			continue;
		}

		const start = markdown.indexOf(raw, cursor);
		if (start < 0) {
			if (token.type === 'link' || token.type === 'image') {
				unlocatable.push(token as marked.Tokens.Link | marked.Tokens.Image);
			}
			continue;
		}
		const end = start + raw.length;
		cursor = end;

		if (token.type === 'code' || token.type === 'codespan') {
			codeRanges.push({ start, end });
		} else if (token.type === 'link' || token.type === 'image') {
			const replacement = rewriter.rewriteLink(token as marked.Tokens.Link | marked.Tokens.Image);
			if (replacement !== undefined) {
				edits.push({ start, end, replacement });
			} else {
				collectEdits(childrenOf(token), markdown, start, rewriter, edits, codeRanges, unlocatable);
			}
		}
	}

	return cursor;
}

function findDefinitionRanges(tokens: readonly marked.Token[], markdown: string): { start: number; end: number }[] {
	const ranges: { start: number; end: number }[] = [];
	let cursor = 0;
	for (const token of tokens) {
		const raw = (token as { raw?: string }).raw ?? '';
		const start = raw ? markdown.indexOf(raw, cursor) : -1;
		if (start < 0) {
			return [];
		}
		if (start > cursor && markdown.substring(cursor, start).trim()) {
			ranges.push({ start: cursor, end: start });
		}
		cursor = start + raw.length;
	}

	if (markdown.substring(cursor).trim()) {
		ranges.push({ start: cursor, end: markdown.length });
	}
	return ranges;
}

export function rewriteMarkdownLinks(markdown: string, rewriter: IMarkdownRewriter): string {
	let tokens: marked.TokensList;
	try {
		tokens = marked.lexer(markdown);
	} catch {
		return markdown;
	}

	const edits: IMarkdownEdit[] = [];
	const codeRanges: { start: number; end: number }[] = [];
	const unlocatable: (marked.Tokens.Link | marked.Tokens.Image)[] = [];
	collectEdits(tokens, markdown, 0, rewriter, edits, codeRanges, unlocatable);
	edits.push(...(rewriter.additionalEdits?.(markdown, {
		codeRanges,
		definitionRanges: findDefinitionRanges(tokens, markdown),
		unlocatable,
	}) ?? []));
	if (!edits.length) {
		return markdown;
	}

	edits.sort((a, b) => a.start - b.start);

	let result = '';
	let position = 0;
	for (const edit of edits) {
		if (edit.start < position) {
			continue;
		}
		result += markdown.substring(position, edit.start) + edit.replacement;
		position = edit.end;
	}
	return result + markdown.substring(position);
}
