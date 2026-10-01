/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function estimateTokenCount(text: string): number {
	if (!text) {
		return 0;
	}
	// Heuristic estimation: ~4 chars per token for English/code, ~2 for unicode/multibyte
	return Math.ceil(text.length / 3.5);
}

export function estimateMessageTokens(message: { content?: string; role?: string; toolCalls?: any[] }): number {
	let tokens = 4; // Overhead per message
	if (message.content) {
		tokens += estimateTokenCount(message.content);
	}
	if (message.toolCalls && Array.isArray(message.toolCalls)) {
		for (const tc of message.toolCalls) {
			tokens += estimateTokenCount(tc.name || '');
			tokens += estimateTokenCount(typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}));
		}
	}
	return tokens;
}
