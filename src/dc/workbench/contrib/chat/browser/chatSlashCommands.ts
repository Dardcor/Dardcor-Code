/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';






export class ChatSlashCommandsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.chatSlashCommands';

	constructor() {
		super();
	}
}

export class ChatSessionOptionSlashCommandsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.chatSessionOptionSlashCommands';

	constructor() {
		super();
	}
}
