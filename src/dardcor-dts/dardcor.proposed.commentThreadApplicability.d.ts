/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum CommentThreadApplicability {
		Current = 0,
		Outdated = 1
	}

	export interface CommentThread2 {
		state?: CommentThreadState | { resolved?: CommentThreadState; applicability?: CommentThreadApplicability };
		readonly uri: Uri;
		range: Range | undefined;
		comments: readonly Comment[];
		collapsibleState: CommentThreadCollapsibleState;
		canReply: boolean | CommentAuthorInformation;
		contextValue?: string;
		label?: string;
		dispose(): void;
	}
}
