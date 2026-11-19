/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export class MultiDocumentHighlight {

		uri: Uri;

		highlights: DocumentHighlight[];

		constructor(uri: Uri, highlights: DocumentHighlight[]);
	}

	export interface MultiDocumentHighlightProvider {

		provideMultiDocumentHighlights(document: TextDocument, position: Position, otherDocuments: TextDocument[], token: CancellationToken): ProviderResult<MultiDocumentHighlight[]>;
	}

	namespace languages {

		export function registerMultiDocumentHighlightProvider(selector: DocumentSelector, provider: MultiDocumentHighlightProvider): Disposable;
	}

}
