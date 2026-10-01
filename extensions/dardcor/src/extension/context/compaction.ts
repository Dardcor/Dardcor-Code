/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { estimateMessageTokens, estimateTokenCount } from './tokenCounter';

export interface IConversationMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolName?: string;
	toolCallId?: string;
	attachments?: Array<{ type: string; uri: string; data?: any }>;
}

export interface ICompactionConfig {
	maxContextTokens: number;
	pruneThresholdTokens: number;
	preserveRecentTurns: number;
}

export const DEFAULT_COMPACTION_CONFIG: ICompactionConfig = {
	maxContextTokens: 64000,
	pruneThresholdTokens: 32000,
	preserveRecentTurns: 3,
};

export class ContextCompactor {
	public static countTokens(messages: IConversationMessage[]): number {
		return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
	}

	/**
	 * Tier 1: Deterministic Basic Compaction (zero LLM token cost)
	 * Prunes oversized tool outputs and old attachment buffers outside the recent protected turns.
	 */
	public static basicCompact(
		messages: IConversationMessage[],
		config: ICompactionConfig = DEFAULT_COMPACTION_CONFIG
	): { compacted: IConversationMessage[]; prunedCount: number } {
		const totalTokens = this.countTokens(messages);
		if (totalTokens <= config.pruneThresholdTokens) {
			return { compacted: [...messages], prunedCount: 0 };
		}

		let prunedCount = 0;
		const protectedStartIndex = Math.max(0, messages.length - config.preserveRecentTurns * 2);
		const compacted: IConversationMessage[] = [];

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];

			if (i < protectedStartIndex && msg.role === 'tool') {
				if (msg.content.length > 500) {
					const lines = msg.content.split('\n');
					const preview = lines.slice(0, 5).join('\n');
					const summary = `${preview}\n... [${lines.length - 5} lines pruned by ContextCompactor to save token context]`;
					compacted.push({
						...msg,
						content: summary,
					});
					prunedCount++;
					continue;
				}
			}

			if (i < protectedStartIndex && msg.attachments && msg.attachments.length > 0) {
				compacted.push({
					...msg,
					attachments: undefined,
					content: msg.content + '\n[Attachments pruned to preserve context]',
				});
				prunedCount++;
				continue;
			}

			compacted.push(msg);
		}

		return { compacted, prunedCount };
	}

	/**
	 * Tier 2: Agentic Structure Compaction
	 * Synthesizes older conversation turns into a structured summary tag while preserving recent turns.
	 */
	public static buildAgenticSummary(
		messages: IConversationMessage[],
		config: ICompactionConfig = DEFAULT_COMPACTION_CONFIG
	): IConversationMessage[] {
		const protectedStartIndex = Math.max(0, messages.length - config.preserveRecentTurns * 2);
		if (protectedStartIndex <= 1) {
			return [...messages];
		}

		const olderMessages = messages.slice(0, protectedStartIndex);
		const recentMessages = messages.slice(protectedStartIndex);

		const summaryItems: string[] = [];
		for (const msg of olderMessages) {
			if (msg.role === 'user') {
				summaryItems.push(`- User Request: "${msg.content.slice(0, 150).replace(/\n/g, ' ')}"`);
			} else if (msg.role === 'assistant' && msg.content) {
				summaryItems.push(`  - Assistant Action: "${msg.content.slice(0, 150).replace(/\n/g, ' ')}"`);
			} else if (msg.role === 'tool') {
				summaryItems.push(`  - Tool executed: ${msg.toolName || 'tool'}`);
			}
		}

		const summaryMessage: IConversationMessage = {
			role: 'system',
			content: `<CONVERSATION_SUMMARY>\nEarlier turns summarized:\n${summaryItems.join('\n')}\n</CONVERSATION_SUMMARY>`,
		};

		return [summaryMessage, ...recentMessages];
	}
}
