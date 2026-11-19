/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { basename } from '../../../../../base/common/path.js';
import { CompletionItem, CompletionItemKind, CompletionItemProvider } from '../../../../../editor/common/languages.js';
import { ISimpleCompletion, SimpleCompletionItem } from '../../../../services/suggest/browser/simpleCompletionItem.js';

export enum TerminalCompletionItemKind {
	File = 0,
	Folder = 1,
	Method = 2,
	Alias = 3,
	Argument = 4,
	Option = 5,
	OptionValue = 6,
	Flag = 7,
	SymbolicLinkFile = 8,
	SymbolicLinkFolder = 9,
	Commit = 10,
	Branch = 11,
	Tag = 12,
	Stash = 13,
	Remote = 14,
	PullRequest = 15,
	PullRequestDone = 16,

	InlineSuggestion = 100,
	InlineSuggestionAlwaysOnTop = 101,
}

export function mapLspKindToTerminalKind(lspKind: CompletionItemKind): TerminalCompletionItemKind {

	switch (lspKind) {
		case CompletionItemKind.File:
			return TerminalCompletionItemKind.File;
		case CompletionItemKind.Folder:
			return TerminalCompletionItemKind.Folder;
		case CompletionItemKind.Method:
			return TerminalCompletionItemKind.Method;
		case CompletionItemKind.Text:
			return TerminalCompletionItemKind.Argument;
		case CompletionItemKind.Variable:
			return TerminalCompletionItemKind.Argument;
		case CompletionItemKind.EnumMember:
			return TerminalCompletionItemKind.OptionValue;
		case CompletionItemKind.Keyword:
			return TerminalCompletionItemKind.Alias;
		default:
			return TerminalCompletionItemKind.Method;
	}
}

export interface ITerminalCompletion extends ISimpleCompletion {
	inputData?: string;

	kind?: TerminalCompletionItemKind;

	isFileOverride?: boolean;

	isKeyword?: boolean;

	_unresolvedItem?: CompletionItem;

	_resolveProvider?: CompletionItemProvider;

}

export class TerminalCompletionItem extends SimpleCompletionItem {
	labelLowExcludeFileExt: string;

	labelLowNormalizedPath: string;

	fileExtLow: string = '';

	punctuationPenalty: 0 | 1 = 0;

	resolveCache?: Promise<void>;

	constructor(
		override readonly completion: ITerminalCompletion,
		pathSeparator?: string
	) {
		super(completion);

		const detectedSeparator = pathSeparator ?? (this.labelLow.includes('\\') ? '\\' : undefined);
		const useWindowsStylePath = detectedSeparator === '\\';

		this.labelLowExcludeFileExt = this.labelLow;
		this.labelLowNormalizedPath = this.labelLow;

		if (isFile(completion) || completion.kind === TerminalCompletionItemKind.Branch) {
			if (useWindowsStylePath) {
				this.labelLow = this.labelLow.replaceAll('/', '\\');
			}
		}

		if (isFile(completion)) {
			const extIndex = this.labelLow.lastIndexOf('.');
			if (extIndex > 0) {
				this.labelLowExcludeFileExt = this.labelLow.substring(0, extIndex);
				this.fileExtLow = this.labelLow.substring(extIndex + 1);
			}
		}

		if (isFile(completion) || completion.kind === TerminalCompletionItemKind.Folder) {
			if (useWindowsStylePath) {
				this.labelLowNormalizedPath = this.labelLow.replaceAll('\\', '/');
			}
			if (completion.kind === TerminalCompletionItemKind.Folder) {
				this.labelLowNormalizedPath = this.labelLowNormalizedPath.replace(/\/$/, '');
			}
		}

		this.punctuationPenalty = shouldPenalizeForPunctuation(this.labelLowExcludeFileExt) ? 1 : 0;
	}

	async resolve(token: CancellationToken): Promise<void> {

		if (this.resolveCache) {
			return this.resolveCache;
		}

		const unresolvedItem = this.completion._unresolvedItem;
		const provider = this.completion._resolveProvider;

		if (!unresolvedItem || !provider || !provider.resolveCompletionItem) {
			return;
		}

		this.resolveCache = (async () => {
			try {
				const resolved = await provider.resolveCompletionItem!(unresolvedItem, token);
				if (resolved) {
					if (resolved.detail) {
						this.completion.detail = resolved.detail;
					}
					if (resolved.documentation) {
						this.completion.documentation = resolved.documentation;
					}
				}
			} catch (error) {
				return;
			}
		})();

		return this.resolveCache;
	}

}

function isFile(completion: ITerminalCompletion): boolean {
	return !!(completion.kind === TerminalCompletionItemKind.File || completion.isFileOverride);
}

function shouldPenalizeForPunctuation(label: string): boolean {
	return basename(label).startsWith('_') || /^[\[\]\{\}\(\)\.,;:!?\/\\\-_@#~*%^=$]+$/.test(label);
}
