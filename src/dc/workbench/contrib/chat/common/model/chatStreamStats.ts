/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../../platform/log/common/log.js';

export interface IChatStreamStats {
	impliedWordLoadRate: number;
	lastWordCount: number;
}

export interface IChatStreamStatsInternal extends IChatStreamStats {
	totalTime: number;
	lastUpdateTime: number;
	firstMarkdownTime: number | undefined;
	bootstrapActive: boolean;
	wordCountAtBootstrapExit: number | undefined;
	updatesWithNewWords: number;
}

export interface IChatStreamUpdate {
	totalWordCount: number;
}

const MIN_BOOTSTRAP_TOTAL_TIME = 250;
const LARGE_BOOTSTRAP_MIN_TOTAL_TIME = 500;
const MAX_INTERVAL_TIME = 250;
const LARGE_UPDATE_MAX_INTERVAL_TIME = 1000;
const WORDS_FOR_LARGE_CHUNK = 10;
const MIN_UPDATES_FOR_STABLE_RATE = 2;

export class ChatStreamStatsTracker {
	private _data: IChatStreamStatsInternal;
	private _publicData: IChatStreamStats;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		const start = Date.now();
		this._data = {
			totalTime: 0,
			lastUpdateTime: start,
			impliedWordLoadRate: 0,
			lastWordCount: 0,
			firstMarkdownTime: undefined,
			bootstrapActive: true,
			wordCountAtBootstrapExit: undefined,
			updatesWithNewWords: 0
		};
		this._publicData = { impliedWordLoadRate: 0, lastWordCount: 0 };
	}

	get data(): IChatStreamStats {
		return this._publicData;
	}

	get internalData(): IChatStreamStatsInternal {
		return this._data;
	}

	update(totals: IChatStreamUpdate): IChatStreamStats | undefined {
		const { totalWordCount: wordCount } = totals;
		if (wordCount === this._data.lastWordCount) {
			this.trace('Update- no new words');
			return undefined;
		}

		const now = Date.now();
		const newWords = wordCount - this._data.lastWordCount;
		const hadNoWordsBeforeUpdate = this._data.lastWordCount === 0;
		let firstMarkdownTime = this._data.firstMarkdownTime;
		let wordCountAtBootstrapExit = this._data.wordCountAtBootstrapExit;
		if (typeof firstMarkdownTime !== 'number' && wordCount > 0) {
			firstMarkdownTime = now;
		}
		const updatesWithNewWords = this._data.updatesWithNewWords + 1;

		if (hadNoWordsBeforeUpdate) {
			this._data.lastUpdateTime = now;
		}

		const intervalCap = newWords > WORDS_FOR_LARGE_CHUNK ? LARGE_UPDATE_MAX_INTERVAL_TIME : MAX_INTERVAL_TIME;
		const timeDiff = Math.min(now - this._data.lastUpdateTime, intervalCap);
		let totalTime = this._data.totalTime + timeDiff;
		const minBootstrapTotalTime = hadNoWordsBeforeUpdate && wordCount > WORDS_FOR_LARGE_CHUNK ? LARGE_BOOTSTRAP_MIN_TOTAL_TIME : MIN_BOOTSTRAP_TOTAL_TIME;

		let bootstrapActive = this._data.bootstrapActive;
		if (bootstrapActive) {
			const stableStartTime = firstMarkdownTime;
			const hasStableData = typeof stableStartTime === 'number'
				&& updatesWithNewWords >= MIN_UPDATES_FOR_STABLE_RATE
				&& wordCount >= WORDS_FOR_LARGE_CHUNK;
			if (hasStableData) {
				bootstrapActive = false;
				totalTime = Math.max(now - stableStartTime, timeDiff);
				wordCountAtBootstrapExit = this._data.lastWordCount;
				this.trace('Has stable data');
			} else {
				totalTime = Math.max(totalTime, minBootstrapTotalTime);
			}
		}

		const wordsSinceBootstrap = typeof wordCountAtBootstrapExit === 'number' ? Math.max(wordCount - wordCountAtBootstrapExit, 0) : wordCount;
		const effectiveTime = totalTime;
		const effectiveWordCount = bootstrapActive ? wordCount : wordsSinceBootstrap;
		const impliedWordLoadRate = effectiveTime > 0 ? effectiveWordCount / (effectiveTime / 1000) : 0;
		this._data = {
			totalTime,
			lastUpdateTime: now,
			impliedWordLoadRate,
			lastWordCount: wordCount,
			firstMarkdownTime,
			bootstrapActive,
			wordCountAtBootstrapExit,
			updatesWithNewWords
		};
		this._publicData = {
			impliedWordLoadRate,
			lastWordCount: wordCount
		};

		const traceWords = bootstrapActive ? wordCount : wordsSinceBootstrap;
		this.trace(`Update- got ${traceWords} words over last ${totalTime}ms = ${impliedWordLoadRate} words/s`);
		return this._data;
	}

	private trace(message: string): void {
		this.logService.trace(`ChatStreamStatsTracker#update: ${message}`);
	}
}
