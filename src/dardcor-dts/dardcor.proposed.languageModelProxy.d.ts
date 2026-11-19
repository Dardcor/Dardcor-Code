/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface LanguageModelProxy extends Disposable {
		readonly uri: Uri;
		readonly key: string;
	}

	export namespace lm {
		export const isModelProxyAvailable: boolean;

		export const onDidChangeModelProxyAvailability: Event<void>;

		export function getModelProxy(): Thenable<LanguageModelProxy>;
	}
}
