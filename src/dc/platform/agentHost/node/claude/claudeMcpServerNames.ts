/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLAUDE_SERVER_TOOL_MCP_SERVER_NAME } from './claudeServerToolMcpServer.js';
import { CLAUDE_CLIENT_MCP_SERVER_NAME } from './clientTools/claudeClientToolMcpServer.js';

const HOST_INJECTED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
	CLAUDE_CLIENT_MCP_SERVER_NAME,
	CLAUDE_SERVER_TOOL_MCP_SERVER_NAME,
]);

export function isHostInjectedMcpServerName(name: string): boolean {
	return HOST_INJECTED_MCP_SERVER_NAMES.has(name);
}
