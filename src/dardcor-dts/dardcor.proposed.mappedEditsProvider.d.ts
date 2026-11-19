/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface DocumentContextItem {
		readonly uri: Uri;
		readonly version: number;
		readonly ranges: Range[];
	}

	export interface ConversationRequest {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		readonly type: 'request';
		readonly message: string;
	}

	export interface ConversationResponse {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		readonly type: 'response';
		readonly message: string;
		readonly result?: ChatResult;
		readonly references?: DocumentContextItem[];
	}

	export interface MappedEditsContext {
		readonly documents: DocumentContextItem[][];
		readonly conversation?: Array<ConversationRequest | ConversationResponse>;
	}

	export interface MappedEditsProvider {
		provideMappedEdits(
			document: TextDocument,
			codeBlocks: string[],
			context: MappedEditsContext,
			token: CancellationToken
		): ProviderResult<WorkspaceEdit | null>;
	}

	export interface MappedEditsRequest {
		readonly codeBlocks: { code: string; resource: Uri; markdownBeforeBlock?: string }[];
		readonly location?: string;
		readonly chatRequestId?: string;
		readonly chatRequestModel?: string;
		readonly chatSessionId?: string;
	}

	export interface MappedEditsResponseStream {
		textEdit(target: Uri, edits: TextEdit | TextEdit[]): void;
		notebookEdit(target: Uri, edits: NotebookEdit | NotebookEdit[]): void;
	}

	export interface MappedEditsResult {
		readonly errorMessage?: string;
	}

	export interface MappedEditsProvider2 {
		provideMappedEdits(
			request: MappedEditsRequest,
			result: MappedEditsResponseStream,
			token: CancellationToken
		): ProviderResult<MappedEditsResult>;
	}

	namespace chat {
		export function registerMappedEditsProvider(documentSelector: DocumentSelector, provider: MappedEditsProvider): Disposable;

		export function registerMappedEditsProvider2(provider: MappedEditsProvider2): Disposable;
	}
}
