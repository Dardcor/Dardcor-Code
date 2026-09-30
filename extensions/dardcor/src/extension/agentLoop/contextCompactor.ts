/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TruncationResult {
	readonly text: string;
	readonly truncated: boolean;
	readonly originalLength: number;
}

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_MAX_LINES = 100;

export class ContextCompactor {
	static truncateToolOutput(
		content: string,
		maxChars = DEFAULT_MAX_CHARS,
		maxLines = DEFAULT_MAX_LINES
	): TruncationResult {
		if (!content || content.length <= maxChars) {
			const lines = content ? content.split('\n') : [];
			if (lines.length <= maxLines) {
				return { text: content, truncated: false, originalLength: content ? content.length : 0 };
			}
			const truncatedLines = lines.slice(0, maxLines).join('\n');
			const notice = `\n\n[... Truncated: showing first ${maxLines} of ${lines.length} lines. Full output omitted to preserve context window. ...]`;
			return {
				text: truncatedLines + notice,
				truncated: true,
				originalLength: content.length,
			};
		}

		// Truncate at character boundary without splitting high surrogates
		let sliceIndex = maxChars;
		const charCode = content.charCodeAt(sliceIndex - 1);
		if (charCode >= 0xd800 && charCode <= 0xdbff) {
			sliceIndex--;
		}

		const truncatedText = content.slice(0, sliceIndex);
		const notice = `\n\n[... Truncated: showing first ${sliceIndex} of ${content.length} characters. Full output omitted to preserve context window. ...]`;
		return {
			text: truncatedText + notice,
			truncated: true,
			originalLength: content.length,
		};
	}

	static shouldCompact(currentTokenCount: number, maxTokens: number, thresholdRatio = 0.8): boolean {
		if (maxTokens <= 0) {
			return false;
		}
		return currentTokenCount / maxTokens >= thresholdRatio;
	}
}
