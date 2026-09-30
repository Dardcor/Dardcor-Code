/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';

/**
 * Built-in slash commands contribution.
 * Default slash commands have been removed so the `/` menu exclusively
 * discovers and suggests user-downloaded global agent skills.
 */
export class ChatSlashCommandsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.chatSlashCommands';

	constructor() {
		super();
	}
}

/**
 * Session option slash commands contribution.
 * Disabled so session options do not register slash commands into the `/` menu.
 */
export class ChatSessionOptionSlashCommandsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.chatSessionOptionSlashCommands';

	constructor() {
		super();
	}
}
