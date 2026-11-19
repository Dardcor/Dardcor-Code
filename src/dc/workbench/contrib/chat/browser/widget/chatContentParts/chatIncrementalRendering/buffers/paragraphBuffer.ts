/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IIncrementalRenderingBuffer } from './buffer.js';

const MAX_BUFFERED_CHARS = 4000;

export function lastBlockBoundary(text: string): number {
	let lastValid = -1;
	let inFence = false;

	for (let i = 0; i < text.length; i++) {
		if ((i === 0 || text[i - 1] === '\n') &&
			((text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') ||
				(text[i] === '~' && text[i + 1] === '~' && text[i + 2] === '~'))) {
			inFence = !inFence;
			i += 2;
			continue;
		}
		if (!inFence && text[i] === '\n' && text[i + 1] === '\n') {
			lastValid = i;
		}
	}

	return lastValid;
}

export class ParagraphBuffer implements IIncrementalRenderingBuffer {
	readonly handlesFlush = false;

	getRenderable(fullMarkdown: string, _lastRendered: string): string {
		const lastBlock = lastBlockBoundary(fullMarkdown);
		let renderable = lastBlock === -1
			? fullMarkdown
			: fullMarkdown.slice(0, lastBlock + 2);

		if (fullMarkdown.length - renderable.length > MAX_BUFFERED_CHARS) {
			renderable = fullMarkdown;
		}

		return renderable;
	}
}
