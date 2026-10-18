/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export class VerboseHover extends Hover {

		canIncreaseVerbosity?: boolean;

		canDecreaseVerbosity?: boolean;

		constructor(contents: MarkdownString | MarkedString | Array<MarkdownString | MarkedString>, range?: Range, canIncreaseVerbosity?: boolean, canDecreaseVerbosity?: boolean);
	}

	export interface HoverContext {

		readonly verbosityDelta?: number;

		readonly previousHover?: Hover;
	}

	export enum HoverVerbosityAction {
		Increase = 0,
		Decrease = 1
	}

	export interface HoverProvider {

		provideHover(document: TextDocument, position: Position, token: CancellationToken, context?: HoverContext): ProviderResult<VerboseHover>;
	}
}
