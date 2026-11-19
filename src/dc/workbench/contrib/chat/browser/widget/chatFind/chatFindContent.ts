/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderAsPlaintext } from '../../../../../../base/browser/markdownRenderer.js';
import { canceledName } from '../../../../../../base/common/errors.js';
import { isMarkdownString, MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { basename } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { isLocation, Location } from '../../../../../../editor/common/languages.js';
import { IWorkspaceSymbol } from '../../../../search/common/search.js';
import { IChatResponseViewModel } from '../../../common/model/chatViewModel.js';

export interface IChatFindTextPart {
	readonly partIndex: number;
	readonly text: string;
}

function inlineReferenceLabel(part: { inlineReference: URI | Location | IWorkspaceSymbol; name?: string }): string | undefined {
	const ref = part.inlineReference;
	if (URI.isUri(ref)) {
		return part.name || basename(ref);
	}
	if (isLocation(ref)) {
		return part.name || basename(ref.uri);
	}
	return ref.name;
}

function isErrorDetailsRendered(item: IChatResponseViewModel): boolean {
	const errorDetails = item.errorDetails;
	if (!errorDetails?.message || errorDetails.isQuotaExceeded || errorDetails.isRateLimited) {
		return false;
	}
	return item.model.response === item.model.entireResponse
		&& !item.isCanceled
		&& errorDetails.message !== canceledName;
}

const FIND_PLAINTEXT_OPTIONS = { includeCodeBlocksFences: false } as const;

function withSourceEdgeWhitespace(source: string, text: string): string {
	const edge = (whitespace: string | undefined) => whitespace ? (whitespace.includes('\n') ? '\n' : ' ') : '';
	return edge(/^\s+/.exec(source)?.[0]) + text + edge(/\s+$/.exec(source)?.[0]);
}

export function getChatFindTextParts(item: IChatResponseViewModel): IChatFindTextPart[] {
	const parts: IChatFindTextPart[] = [];

	if (isErrorDetailsRendered(item)) {
		parts.push({ partIndex: -1, text: renderAsPlaintext(new MarkdownString(item.errorDetails!.message), FIND_PLAINTEXT_OPTIONS) });
	}

	if (item.errorDetails?.responseIsFiltered) {
		return parts;
	}

	item.response.value.forEach((part, partIndex) => {
		switch (part.kind) {
			case 'markdownContent': {
				const text = renderAsPlaintext(part.content, FIND_PLAINTEXT_OPTIONS);
				if (text.trim()) {
					parts.push({ partIndex, text: withSourceEdgeWhitespace(part.content.value, text) });
				}
				break;
			}
			case 'inlineReference': {
				const label = inlineReferenceLabel(part);
				if (label?.trim()) {
					parts.push({ partIndex, text: label });
				}
				break;
			}
			case 'toolInvocation':
			case 'toolInvocationSerialized': {
				break;
			}
			case 'elicitation2':
			case 'elicitationSerialized': {
				const title = isMarkdownString(part.title) ? renderAsPlaintext(part.title, FIND_PLAINTEXT_OPTIONS) : part.title;
				const message = isMarkdownString(part.message) ? renderAsPlaintext(part.message, FIND_PLAINTEXT_OPTIONS) : part.message;
				const text = [title, message].filter(value => typeof value === 'string' && value.trim()).join('\n');
				if (text.trim()) {
					parts.push({ partIndex, text });
				}
				break;
			}
		}
	});

	return parts;
}
