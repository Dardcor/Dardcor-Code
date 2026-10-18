/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare module 'vscode' {

	export enum NewSymbolNameTag {
		AIGenerated = 1
	}

	export enum NewSymbolNameTriggerKind {
		Invoke = 0,
		Automatic = 1,
	}

	export class NewSymbolName {
		readonly newSymbolName: string;
		readonly tags?: readonly NewSymbolNameTag[];

		constructor(newSymbolName: string, tags?: readonly NewSymbolNameTag[]);
	}

	export interface NewSymbolNamesProvider {

		readonly supportsAutomaticTriggerKind?: Thenable<boolean>;

		provideNewSymbolNames(document: TextDocument, range: Range, triggerKind: NewSymbolNameTriggerKind, token: CancellationToken): ProviderResult<NewSymbolName[]>;
	}

	export namespace languages {
		export function registerNewSymbolNamesProvider(selector: DocumentSelector, provider: NewSymbolNamesProvider): Disposable;
	}
}
