/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum CommentThreadFocus {
		Reply = 1,
		Comment = 2
	}

	export interface CommentThreadRevealOptions {

		focus?: CommentThreadFocus;
	}

	export interface CommentThread2 {
		reveal(comment?: Comment, options?: CommentThreadRevealOptions): Thenable<void>;

		hide(): Thenable<void>;
	}

}
