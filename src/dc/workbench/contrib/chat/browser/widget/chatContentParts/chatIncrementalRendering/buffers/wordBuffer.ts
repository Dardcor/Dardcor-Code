/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNWords } from '../../../../../common/model/chatWordCounter.js';
import { IIncrementalRenderingBuffer } from './buffer.js';

const MIN_RATE = 40;

const MAX_RATE = 2000;

const MIN_RATE_AFTER_COMPLETE = 80;

const DEFAULT_RATE = 8;

export class WordBuffer implements IIncrementalRenderingBuffer {
	readonly handlesFlush = true;

	private _fullMarkdown: string = '';

	private _revealedWordCount: number = 0;

	private _lastCommittedMarkdown: string = '';

	private _needsNextFrame: boolean = false;

	private _lastCommitTime: number = 0;

	private _rate: number = DEFAULT_RATE;

	get needsNextFrame(): boolean {
		return this._needsNextFrame;
	}

	setRate(rate: number | undefined, isComplete: boolean): void {
		if (isComplete) {
			this._rate = typeof rate === 'number'
				? Math.max(rate, MIN_RATE_AFTER_COMPLETE)
				: MIN_RATE_AFTER_COMPLETE;
		} else {
			this._rate = typeof rate === 'number'
				? Math.min(Math.max(rate, MIN_RATE), MAX_RATE)
				: DEFAULT_RATE;
		}
	}

	getRenderable(fullMarkdown: string, _lastRendered: string): string {
		this._fullMarkdown = fullMarkdown;
		return fullMarkdown;
	}

	filterFlush(markdown: string): string | undefined {
		this._fullMarkdown = markdown;

		const now = Date.now();
		if (this._lastCommitTime === 0) {
			this._lastCommitTime = now;
			this._revealedWordCount = 1;
		} else {
			const elapsed = now - this._lastCommitTime;
			const newWords = Math.floor(elapsed / 1000 * this._rate);
			if (newWords > 0) {
				this._revealedWordCount += newWords;
				this._lastCommitTime = now;
			}
		}

		const result = getNWords(this._fullMarkdown, this._revealedWordCount);

		if (result.isFullString) {
			this._needsNextFrame = false;
			this._revealedWordCount = result.returnedWordCount;
			this._lastCommittedMarkdown = this._fullMarkdown;
			return this._fullMarkdown;
		}

		this._needsNextFrame = true;

		if (result.value.length <= this._lastCommittedMarkdown.length) {
			return undefined;
		}

		this._lastCommittedMarkdown = result.value;
		return result.value;
	}
}
