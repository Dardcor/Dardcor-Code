/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolResultContentType, type ToolCallResult, type ToolResultContent, type ToolResultEmbeddedResourceContent } from '../../../common/state/protocol/channels-chat/state.js';

const CLAUDE_CLIENT_RESOURCE_SCHEME = 'claude-client';

export function convertToolCallResult(result: ToolCallResult, toolUseId: string): CallToolResult {
	const blocks = result.content ?? [];
	const content = blocks.map((block, index) => convertBlock(block, toolUseId, index));
	const out: CallToolResult = { content };
	if (result.structuredContent !== undefined) {
		out.structuredContent = result.structuredContent;
	}
	if (!result.success || result.error) {
		out.isError = true;
	}
	return out;
}

function convertBlock(block: ToolResultContent, toolUseId: string, index: number): CallToolResult['content'][number] {
	switch (block.type) {
		case ToolResultContentType.Text:
			return { type: 'text', text: block.text };
		case ToolResultContentType.EmbeddedResource:
			return convertEmbeddedResource(block, toolUseId, index);
		default: {
			console.warn(`[Claude] convertToolCallResult: unsupported tool-result block kind '${(block as ToolResultContent).type}'; degrading to text`);
			let text: string;
			try {
				text = JSON.stringify(block);
			} catch {
				text = `[unserializable ${(block as ToolResultContent).type} block]`;
			}
			return { type: 'text', text };
		}
	}
}

function convertEmbeddedResource(
	block: ToolResultEmbeddedResourceContent,
	toolUseId: string,
	index: number
): CallToolResult['content'][number] {
	if (block.contentType.startsWith('image/')) {
		return { type: 'image', data: block.data, mimeType: block.contentType };
	}
	const uri = `${CLAUDE_CLIENT_RESOURCE_SCHEME}://${encodeURIComponent(toolUseId)}/${index}`;
	return {
		type: 'resource',
		resource: { uri, mimeType: block.contentType, blob: block.data },
	};
}
