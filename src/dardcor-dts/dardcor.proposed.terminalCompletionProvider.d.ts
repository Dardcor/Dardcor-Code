/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface TerminalCompletionProvider<T extends TerminalCompletionItem = TerminalCompletionItem> {
		provideTerminalCompletions(terminal: Terminal, context: TerminalCompletionContext, token: CancellationToken): ProviderResult<T[] | TerminalCompletionList<T>>;
	}

	export class TerminalCompletionItem {
		label: string | CompletionItemLabel;

		replacementRange: readonly [number, number];

		detail?: string;

		documentation?: string | MarkdownString;

		kind?: TerminalCompletionItemKind;

		constructor(
			label: string | CompletionItemLabel,
			replacementRange: readonly [number, number],
			kind?: TerminalCompletionItemKind
		);
	}

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
		ScmCommit = 10,
		ScmBranch = 11,
		ScmTag = 12,
		ScmStash = 13,
		ScmRemote = 14,
		PullRequest = 15,
		PullRequestDone = 16,
	}

	export interface TerminalCompletionContext {
		readonly commandLine: string;
		readonly cursorIndex: number;
	}

	export class TerminalCompletionList<T extends TerminalCompletionItem = TerminalCompletionItem> {

		resourceOptions?: TerminalCompletionResourceOptions;

		items: T[];

		constructor(items: T[], resourceOptions?: TerminalCompletionResourceOptions);
	}

	export interface TerminalCompletionResourceOptions {
		showFiles: boolean;
		showDirectories: boolean;
		globPattern?: string;
		cwd: Uri;
	}

	export namespace window {
		export function registerTerminalCompletionProvider<T extends TerminalCompletionItem>(provider: TerminalCompletionProvider<T>, ...triggerCharacters: string[]): Disposable;
	}
}

