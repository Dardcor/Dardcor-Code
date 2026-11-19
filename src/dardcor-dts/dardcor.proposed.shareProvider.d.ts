/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare module 'vscode' {

	export interface ShareableItem {
		resourceUri: Uri;

		selection?: Range;
	}

	export interface ShareProvider {

		readonly id: string;

		readonly label: string;

		readonly priority: number;

		provideShare(item: ShareableItem, token: CancellationToken): ProviderResult<Uri | string>;
	}

	export namespace window {

		export function registerShareProvider(selector: DocumentSelector, provider: ShareProvider): Disposable;
	}

	export interface TreeItem {

		shareableItem?: ShareableItem;
	}
}
