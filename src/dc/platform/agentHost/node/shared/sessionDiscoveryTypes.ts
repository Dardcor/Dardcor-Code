/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from '../../../../base/common/uri.js';

export const enum DiscoveredType {
	Agent = 'agent',
	Skill = 'skill',
	Instruction = 'instruction',
	Hook = 'hook',
	AgentInstruction = 'agentInstruction',
}

export interface IDiscoveredFile {
	readonly uri: URI;
	readonly etag: string;
}

export interface IDiscoveredDirectory {
	readonly uri: URI;
	readonly type: DiscoveredType;
	readonly name: string;
	readonly writable: boolean;
	readonly files: readonly IDiscoveredFile[];
}
