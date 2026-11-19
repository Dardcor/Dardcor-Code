/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';


export namespace CommentContextKeys {

	export const activeCursorHasCommentingRange = new RawContextKey<boolean>('activeCursorHasCommentingRange', false, {
		description: nls.localize('hasCommentingRange', "Whether the position at the active cursor has a commenting range"),
		type: 'boolean'
	});

	export const activeCursorHasComment = new RawContextKey<boolean>('activeCursorHasComment', false, {
		description: nls.localize('hasComment', "Whether the position at the active cursor has a comment"),
		type: 'boolean'
	});

	export const activeEditorHasCommentingRange = new RawContextKey<boolean>('activeEditorHasCommentingRange', false, {
		description: nls.localize('editorHasCommentingRange', "Whether the active editor has a commenting range"),
		type: 'boolean'
	});

	export const WorkspaceHasCommenting = new RawContextKey<boolean>('workspaceHasCommenting', false, {
		description: nls.localize('hasCommentingProvider', "Whether the open workspace has either comments or commenting ranges."),
		type: 'boolean'
	});

	export const commentThreadIsEmpty = new RawContextKey<boolean>('commentThreadIsEmpty', false, { type: 'boolean', description: nls.localize('commentThreadIsEmpty', "Set when the comment thread has no comments") });
	export const commentIsEmpty = new RawContextKey<boolean>('commentIsEmpty', false, { type: 'boolean', description: nls.localize('commentIsEmpty', "Set when the comment has no input") });
	export const commentContext = new RawContextKey<string>('comment', undefined, { type: 'string', description: nls.localize('comment', "The context value of the comment") });
	export const commentThreadContext = new RawContextKey<string>('commentThread', undefined, { type: 'string', description: nls.localize('commentThread', "The context value of the comment thread") });
	export const commentControllerContext = new RawContextKey<string>('commentController', undefined, { type: 'string', description: nls.localize('commentController', "The comment controller id associated with a comment thread") });

	export const commentFocused = new RawContextKey<boolean>('commentFocused', false, { type: 'boolean', description: nls.localize('commentFocused', "Set when the comment is focused") });

	export const commentWidgetVisible = new RawContextKey<boolean>('commentWidgetVisible', false, { type: 'boolean', description: nls.localize('commentWidgetVisible', "Set when a comment widget is visible in the editor") });

	export const commentingEnabled = new RawContextKey<boolean>('commentingEnabled', true, {
		description: nls.localize('commentingEnabled', "Whether commenting functionality is enabled"),
		type: 'boolean'
	});
}
