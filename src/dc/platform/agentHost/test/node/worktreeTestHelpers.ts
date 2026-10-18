/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NullAgentHostWorktreeIsolation, type IAgentHostWorktreeIsolation } from '../../node/shared/worktreeIsolation.js';

export function createNoopWorktreeIsolation(): IAgentHostWorktreeIsolation {
	return new NullAgentHostWorktreeIsolation();
}
