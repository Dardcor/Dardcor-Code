/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { appendEscapedMarkdownInlineCode, isPortableLinkTarget, isPortableMarkdownTarget } from '../../../../../base/common/htmlContent.js';
import * as marked from '../../../../../base/common/marked/marked.js';
import { IMarkdownEdit, markdownTokensToPlainText, rewriteMarkdownLinks } from '../../../../../base/common/markdownLinks.js';

function getLinkTarget(element: Element): string {
	return (element.getAttribute('data-href') || element.getAttribute('href') || '').trim();
}

function replaceWithLabel(element: Element, label: string): void {
	if (!label.trim()) {
		element.remove();
		return;
	}

	const code = $('code');
	code.textContent = label;
	element.replaceWith(code);
}

export function sanitizeChatClipboardFragment(fragment: DocumentFragment): boolean {
	let changed = false;

	// eslint-disable-next-line no-restricted-syntax -- operating on a detached fragment
	for (const anchor of Array.from(fragment.querySelectorAll('a'))) {
		const target = getLinkTarget(anchor);
		if (isPortableLinkTarget(target)) {
			anchor.setAttribute('href', target);
			anchor.removeAttribute('data-href');
			continue;
		}

		replaceWithLabel(anchor, anchor.textContent ?? '');
		changed = true;
	}

	// eslint-disable-next-line no-restricted-syntax -- operating on a detached fragment
	for (const image of Array.from(fragment.querySelectorAll('img'))) {
		if (!isPortableLinkTarget(image.getAttribute('src') ?? '')) {
			replaceWithLabel(image, image.getAttribute('alt') ?? '');
			changed = true;
		}
	}

	// eslint-disable-next-line no-restricted-syntax -- operating on a detached fragment
	for (const element of Array.from(fragment.querySelectorAll('[data-href]'))) {
		element.removeAttribute('data-href');
	}

	return changed;
}

function overlapsCode(start: number, end: number, codeRanges: readonly { readonly start: number; readonly end: number }[]): boolean {
	return codeRanges.some(range => start < range.end && end > range.start);
}

export function toPortableMarkdown(markdown: string): string {
	return rewriteMarkdownLinks(markdown, {
		rewriteLink(token) {
			const target = token.href ?? '';
			if (!isPortableMarkdownTarget(target)) {
				const label = markdownTokensToPlainText((token as marked.Tokens.Link).tokens ?? []).trim() || (token.text ?? '').trim();
				return label ? appendEscapedMarkdownInlineCode(label) : '';
			}

			if (!token.raw.includes(target)) {
				const title = token.title ? ` "${token.title}"` : '';
				return `${token.type === 'image' ? '!' : ''}[${token.text}](${target}${title})`;
			}
			return undefined;
		},

		additionalEdits(source, { codeRanges, definitionRanges, unlocatable }) {
			const edits: IMarkdownEdit[] = [];

			for (const token of unlocatable) {
				const target = token.href ?? '';
				if (isPortableMarkdownTarget(target)) {
					continue;
				}
				const needle = `](${target})`;
				for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1)) {
					if (!overlapsCode(at, at + needle.length, codeRanges)) {
						edits.push({ start: at, end: at + needle.length, replacement: ']()' });
					}
				}
			}

			edits.push(...definitionRanges.map(range => ({ ...range, replacement: '' })));
			return edits;
		},
	});
}
