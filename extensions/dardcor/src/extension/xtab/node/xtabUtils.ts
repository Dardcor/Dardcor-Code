/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { toTextParts } from '../../../platform/chat/common/globalStringUtils';
import { OffsetRange } from '../../../util/dardcor/editor/common/core/ranges/offsetRange';


export async function* linesWithBackticksRemoved(linesStream: AsyncIterable<string>): AsyncIterable<string> {
	let lineN = -1;

	let bufferedBacktickLine: string | undefined;

	for await (const line of linesStream) {
		++lineN;

		if (bufferedBacktickLine) {
			yield bufferedBacktickLine;
			bufferedBacktickLine = undefined;
		}

		if (line.match(/^```[a-z]*$/)) {
			if (lineN === 0) {
				continue;
			} else {
				bufferedBacktickLine = line;
			}
		} else {
			yield line;
		}
	}

}

export function constructMessages({ systemMsg, userMsg }: { systemMsg: string; userMsg: string }): Raw.ChatMessage[] {
	return [
		{
			role: Raw.ChatRole.System,
			content: toTextParts(systemMsg)
		},
		{
			role: Raw.ChatRole.User,
			content: toTextParts(userMsg)
		}
	] satisfies Raw.ChatMessage[];
}

export function charCount(messages: Raw.ChatMessage[]): number {
	const promptCharCount = messages.reduce((total, msg) => total + msg.content.reduce((subtotal, part) => subtotal + (part.type === Raw.ChatCompletionContentPartKind.Text ? part.text.length : 0), 0), 0);
	return promptCharCount;
}

export function findMergeConflictMarkersRange(lines: string[], editWindowRange: OffsetRange, maxMergeConflictLines: number): OffsetRange | undefined {
	for (let i = editWindowRange.start; i < Math.min(lines.length, editWindowRange.endExclusive); ++i) {
		if (!lines[i].startsWith('<<<<<<<')) {
			continue;
		}

		for (let j = i + 1; j < lines.length && (j - i) < maxMergeConflictLines; ++j) {
			if (lines[j].startsWith('>>>>>>>')) {
				return new OffsetRange(i, j + 1 );
			}
		}
	}
	return undefined;
}
