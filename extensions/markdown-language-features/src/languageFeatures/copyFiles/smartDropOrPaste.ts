/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IMdParser } from '../../markdownEngine';
import { ITextDocument } from '../../types/textDocument';
import { Schemes } from '../../util/schemes';

const smartPasteLineRegexes = [
	{ regex: /(\[[^\[\]]*](?:\([^\(\)]*\)|\[[^\[\]]*]))/g },
	{ regex: /\$\$[\s\S]*?\$\$/gm },
	{ regex: /`[^`]*`/g },
	{ regex: /\$[^$]*\$/g },
	{ regex: /<[^<>\s]*>/g },
	{ regex: /^[ ]{0,3}\[\w+\]:\s.*$/g, isWholeLine: true },
];

export async function shouldInsertMarkdownLinkByDefault(
	parser: IMdParser,
	document: ITextDocument,
	pasteUrlSetting: InsertMarkdownLink,
	ranges: readonly vscode.Range[],
	token: vscode.CancellationToken
): Promise<boolean> {
	switch (pasteUrlSetting) {
		case InsertMarkdownLink.Always: {
			return true;
		}
		case InsertMarkdownLink.Smart: {
			return checkSmart();
		}
		case InsertMarkdownLink.SmartWithSelection: {
			if (!ranges.some(range => document.getText(range).trim().length > 0)) {
				return false;
			}
			return checkSmart();
		}
		default: {
			return false;
		}
	}

	async function checkSmart(): Promise<boolean> {
		return (await Promise.all(ranges.map(range => shouldSmartPasteForSelection(parser, document, range, token)))).every(x => x);
	}
}

const textTokenTypes = new Set([
	'paragraph_open',
	'inline',
	'heading_open',
	'ordered_list_open',
	'bullet_list_open',
	'list_item_open',
	'blockquote_open',
]);

async function shouldSmartPasteForSelection(
	parser: IMdParser,
	document: ITextDocument,
	selectedRange: vscode.Range,
	token: vscode.CancellationToken
): Promise<boolean> {
	if (selectedRange.start.line !== selectedRange.end.line) {
		return false;
	}

	const rangeText = document.getText(selectedRange);
	if (findValidUriInText(rangeText)) {
		return false;
	}

	if (/\[.*\]\(.*\)/.test(rangeText) || /!\[.*\]\(.*\)/.test(rangeText)) {
		return false;
	}

	const tokens = await parser.tokenize(document);
	if (token.isCancellationRequested) {
		return false;
	}

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token.map) {
			continue;
		}
		if (token.map[0] <= selectedRange.start.line && token.map[1] > selectedRange.start.line) {
			if (!textTokenTypes.has(token.type)) {
				return false;
			}
		}

		if (token.type === 'html_block' && token.map[1] === selectedRange.start.line) {
			const nextToken = tokens.at(i + 1);
			if (nextToken?.map?.[0] === selectedRange.end.line + 1) {
				return false;
			}
		}
	}

	const line = document.getText(new vscode.Range(selectedRange.start.line, 0, selectedRange.start.line, Number.MAX_SAFE_INTEGER));
	for (const regex of smartPasteLineRegexes) {
		for (const match of line.matchAll(regex.regex)) {
			if (match.index === undefined) {
				continue;
			}

			if (regex.isWholeLine) {
				return false;
			}

			if (selectedRange.start.character > match.index && selectedRange.start.character < match.index + match[0].length) {
				return false;
			}
		}
	}

	return true;
}

const externalUriSchemes: ReadonlySet<string> = new Set([
	Schemes.http,
	Schemes.https,
	Schemes.mailto,
	Schemes.file,
]);

export function findValidUriInText(text: string): string | undefined {
	const trimmedUrlList = text.trim();

	if (!/^\S+$/.test(trimmedUrlList)
		|| !trimmedUrlList.includes(':')
	) {
		return;
	}

	let uri: vscode.Uri;
	try {
		uri = vscode.Uri.parse(trimmedUrlList);
	} catch {
		return;
	}

	if (!trimmedUrlList.toLowerCase().startsWith(uri.scheme.toLowerCase() + ':')) {
		return;
	}

	if (!externalUriSchemes.has(uri.scheme.toLowerCase())) {
		return;
	}

	if (!uri.authority && uri.path.length < 2 && !uri.query && !uri.fragment) {
		return;
	}

	return trimmedUrlList;
}

export enum InsertMarkdownLink {
	Always = 'always',
	SmartWithSelection = 'smartWithSelection',
	Smart = 'smart',
	Never = 'never'
}

