/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface TestController {
		relatedCodeProvider?: TestRelatedCodeProvider;
	}

	export interface TestRelatedCodeProvider {
		provideRelatedTests?(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<TestItem[]>;

		provideRelatedCode?(test: TestItem, token: CancellationToken): ProviderResult<Location[]>;
	}
}
