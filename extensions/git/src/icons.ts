/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from 'vscode';

export const Icons = {
	account: new ThemeIcon('account'),
	branch: new ThemeIcon('git-branch'),
	chatWorktree: new ThemeIcon('chat-sparkle'),
	head: new ThemeIcon('target'),
	remoteBranch: new ThemeIcon('cloud'),
	repository: new ThemeIcon('repo'),
	stash: new ThemeIcon('git-stash'),
	tag: new ThemeIcon('tag'),
	worktree: new ThemeIcon('worktree'),
} as const;
