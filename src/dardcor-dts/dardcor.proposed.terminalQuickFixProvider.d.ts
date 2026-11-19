/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export type SingleOrMany<T> = T[] | T;

	export interface TerminalQuickFixProvider {
		provideTerminalQuickFixes(commandMatchResult: TerminalCommandMatchResult, token: CancellationToken): ProviderResult<SingleOrMany<TerminalQuickFixTerminalCommand | TerminalQuickFixOpener | Command>>;
	}


	export interface TerminalCommandMatchResult {
		commandLine: string;
		commandLineMatch: RegExpMatchArray;
		outputMatch?: {
			regexMatch: RegExpMatchArray;
			outputLines: string[];
		};
	}

	export namespace window {
		export function registerTerminalQuickFixProvider(id: string, provider: TerminalQuickFixProvider): Disposable;
	}

	export class TerminalQuickFixTerminalCommand {
		terminalCommand: string;
		shouldExecute?: boolean;
		constructor(terminalCommand: string, shouldExecute?: boolean);
	}
	export class TerminalQuickFixOpener {
		uri: Uri;
		constructor(uri: Uri);
	}

	export interface TerminalOutputMatcher {
		lineMatcher: string | RegExp;
		anchor: TerminalOutputAnchor;
		offset: number;
		length: number;
	}

	export enum TerminalOutputAnchor {
		Top = 0,
		Bottom = 1
	}
}
