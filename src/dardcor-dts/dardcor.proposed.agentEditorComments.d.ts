/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface AgentEditorComment {
		readonly id: string;
		readonly range: Range;
		readonly body: string;
		readonly author?: string;
	}

	export interface AgentEditorCommentsProvider extends Disposable {
		readonly comments: readonly AgentEditorComment[];

		readonly acceptsComments: boolean;

		readonly onDidChange: Event<void>;

		readonly onDidRevealComment: Event<string>;

		// eslint-disable-next-line local/vscode-dts-provider-naming
		addComment(range: Range, body: string): void;

		// eslint-disable-next-line local/vscode-dts-provider-naming
		deleteComment(id: string): void;
	}

	export namespace window {
		export function createAgentEditorComments(uri: Uri): AgentEditorCommentsProvider;
	}

}
