/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from '../../../common/state/protocol/state.js';
import type { IClaudeAgentSdkService } from '../claudeAgentSdkService.js';
import { jsonSchemaToZodRawShape } from './claudeJsonSchemaToZod.js';

const TOOL_USE_ID_META_KEY = 'claudecode/toolUseId';

export async function buildClientToolMcpServer(
	snapshot: readonly ToolDefinition[],
	awaitResult: (toolUseId: string) => Promise<CallToolResult>,
	sdk: IClaudeAgentSdkService
): Promise<McpSdkServerConfigWithInstance> {
	const tools = await Promise.all(snapshot.map(def => sdk.tool(
		def.name,
		def.description ?? '',
		jsonSchemaToZodRawShape(def.inputSchema),
		async (_args, extra) => {
			const toolUseId = extractToolUseId(extra);
			if (toolUseId === undefined) {
				return {
					content: [{
						type: 'text',
						text: `Client tool "${def.name}" could not run: SDK omitted tool_use_id (expected at extra._meta["${TOOL_USE_ID_META_KEY}"]).`,
					}],
					isError: true,
				};
			}
			return awaitResult(toolUseId);
		}
	)));
	return sdk.createSdkMcpServer({ name: CLAUDE_CLIENT_MCP_SERVER_NAME, tools });
}

export function extractToolUseId(extra: unknown): string | undefined {
	if (!extra || typeof extra !== 'object') {
		return undefined;
	}
	const meta = (extra as { _meta?: unknown })._meta;
	if (!meta || typeof meta !== 'object') {
		return undefined;
	}
	const value = (meta as Record<string, unknown>)[TOOL_USE_ID_META_KEY];
	return typeof value === 'string' ? value : undefined;
}

export const CLAUDE_CLIENT_MCP_SERVER_NAME = 'client';

export function stripClientToolNamePrefix(toolName: string): string {
	const prefix = `mcp__${CLAUDE_CLIENT_MCP_SERVER_NAME}__`;
	return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
}

export function hasClientToolNamePrefix(toolName: string): boolean {
	return toolName.startsWith(`mcp__${CLAUDE_CLIENT_MCP_SERVER_NAME}__`);
}
