/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum CommentState {
		Published = 0,
		Draft = 1
	}

	export interface Comment {
		state?: CommentState;
	}
}
