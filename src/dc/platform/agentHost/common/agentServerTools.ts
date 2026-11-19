/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ToolDefinition, URI } from './state/sessionState.js';

export interface IAgentServerToolDefinition extends ToolDefinition {
	readonly enabledForEphemeralSessions?: boolean;
}

export interface IAgentServerToolHost {
	readonly definitions: readonly IAgentServerToolDefinition[];
	getDefinitionsForSession(sessionUri: URI): readonly IAgentServerToolDefinition[];
	readonly toolNames: readonly string[];
	advertise(sessionUri: URI): void;
	canRequireConfirmation(toolName: string): boolean;
	requiresConfirmation(chatUri: URI, toolName: string): boolean;
	executeTool(chatUri: URI, toolName: string, rawArgs: unknown): string | Promise<string>;
}
