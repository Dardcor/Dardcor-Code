/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { IAgentServerToolDefinition, IAgentServerToolHost } from '../../common/agentServerTools.js';
import type { IClaudeAgentSdkService } from './claudeAgentSdkService.js';
import { jsonSchemaToZodRawShape } from './clientTools/claudeJsonSchemaToZod.js';

export const CLAUDE_SERVER_TOOL_MCP_SERVER_NAME = 'host';

export function serverToolAllowList(toolNames: readonly string[]): string[] {
	return toolNames.map(name => `mcp__${CLAUDE_SERVER_TOOL_MCP_SERVER_NAME}__${name}`);
}

export function extractServerToolName(toolName: string): string | undefined {
	const prefix = `mcp__${CLAUDE_SERVER_TOOL_MCP_SERVER_NAME}__`;
	return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : undefined;
}

export async function buildServerToolMcpServer(
	host: IAgentServerToolHost,
	chatUri: string,
	sdk: IClaudeAgentSdkService,
	definitions: readonly IAgentServerToolDefinition[] = host.definitions,
): Promise<McpSdkServerConfigWithInstance> {
	const tools = await Promise.all(definitions.map(def => sdk.tool(
		def.name,
		def.description ?? '',
		jsonSchemaToZodRawShape(def.inputSchema),
		async args => {
			try {
				const text = await host.executeTool(chatUri, def.name, args);
				return { content: [{ type: 'text' as const, text }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: 'text' as const, text: message }], isError: true };
			}
		}
	)));
	return sdk.createSdkMcpServer({ name: CLAUDE_SERVER_TOOL_MCP_SERVER_NAME, tools });
}
