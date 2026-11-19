/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sum } from '../../../../../base/common/arrays.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../common/model.js';
import { IModelContentChangedEvent } from '../../../../common/textModelEvents.js';

interface TypingSession {
	startTime: number;
	endTime: number;
	characterCount: number;
}

interface TypingIntervalResult {
	averageInterval: number;
	characterCount: number;
}

export class TypingInterval extends Disposable {

	private readonly _typingSessions: TypingSession[] = [];
	private _currentSession: TypingSession | null = null;
	private _lastChangeTime = 0;
	private _cachedTypingIntervalResult: TypingIntervalResult | null = null;
	private _cacheInvalidated = true;

	private static readonly MAX_SESSION_GAP_MS = 3_000;
	private static readonly MIN_SESSION_DURATION_MS = 1_000;
	private static readonly SESSION_HISTORY_LIMIT = 50;
	private static readonly TYPING_SPEED_WINDOW_MS = 300_000;
	private static readonly MIN_CHARS_FOR_RELIABLE_SPEED = 20;

	public getTypingInterval(): TypingIntervalResult {
		if (this._cacheInvalidated || this._cachedTypingIntervalResult === null) {
			this._cachedTypingIntervalResult = this._calculateTypingInterval();
			this._cacheInvalidated = false;
		}
		return this._cachedTypingIntervalResult;
	}

	constructor(private readonly _textModel: ITextModel) {
		super();

		this._register(this._textModel.onDidChangeContent(e => this._updateTypingSpeed(e)));
	}

	private _updateTypingSpeed(change: IModelContentChangedEvent): void {
		const now = Date.now();

		if (!this._isUserTyping(change)) {
			this._finalizeCurrentSession();
			return;
		}

		if (this._currentSession && (now - this._lastChangeTime) > TypingInterval.MAX_SESSION_GAP_MS) {
			this._finalizeCurrentSession();
		}

		if (!this._currentSession) {
			this._currentSession = {
				startTime: now,
				endTime: now,
				characterCount: 0
			};
		}

		this._currentSession.endTime = now;
		this._currentSession.characterCount += this._getActualCharacterCount(change);

		this._lastChangeTime = now;
		this._cacheInvalidated = true;
	}

	private _getActualCharacterCount(change: IModelContentChangedEvent): number {
		let totalChars = 0;
		for (const c of change.changes) {
			totalChars += Math.max(c.text.length, c.rangeLength);
		}
		return totalChars;
	}

	private _isUserTyping(change: IModelContentChangedEvent): boolean {
		if (!change.detailedReasons || change.detailedReasons.length === 0) {
			return false;
		}

		for (const reason of change.detailedReasons) {
			if (this._isUserTypingReason(reason)) {
				return true;
			}
		}

		return false;
	}

	private _isUserTypingReason(reason: any): boolean {
		if (reason.metadata.isUndoing || reason.metadata.isRedoing) {
			return false;
		}

		switch (reason.metadata.source) {
			case 'cursor': {
				const kind = reason.metadata.kind;
				return kind === 'type' || kind === 'compositionType' || kind === 'compositionEnd';
			}

			default:
				return false;
		}
	}

	private _finalizeCurrentSession(): void {
		if (!this._currentSession) {
			return;
		}

		const sessionDuration = this._currentSession.endTime - this._currentSession.startTime;

		if (sessionDuration >= TypingInterval.MIN_SESSION_DURATION_MS && this._currentSession.characterCount > 0) {
			this._typingSessions.push(this._currentSession);

			if (this._typingSessions.length > TypingInterval.SESSION_HISTORY_LIMIT) {
				this._typingSessions.shift();
			}
		}

		this._currentSession = null;
	}

	private _calculateTypingInterval(): TypingIntervalResult {
		if (this._currentSession) {
			const tempSession = { ...this._currentSession };
			const sessionDuration = tempSession.endTime - tempSession.startTime;
			if (sessionDuration >= TypingInterval.MIN_SESSION_DURATION_MS && tempSession.characterCount > 0) {
				const allSessions = [...this._typingSessions, tempSession];
				return this._calculateSpeedFromSessions(allSessions);
			}
		}

		return this._calculateSpeedFromSessions(this._typingSessions);
	}

	private _calculateSpeedFromSessions(sessions: TypingSession[]): TypingIntervalResult {
		if (sessions.length === 0) {
			return { averageInterval: 0, characterCount: 0 };
		}

		const sortedSessions = [...sessions].sort((a, b) => b.endTime - a.endTime);

		const cutoffTime = Date.now() - TypingInterval.TYPING_SPEED_WINDOW_MS;
		const recentSessions = sortedSessions.filter(session => session.endTime > cutoffTime);
		const olderSessions = sortedSessions.splice(recentSessions.length);

		let totalChars = sum(recentSessions.map(session => session.characterCount));

		for (let i = 0; i < olderSessions.length && totalChars < TypingInterval.MIN_CHARS_FOR_RELIABLE_SPEED; i++) {
			recentSessions.push(olderSessions[i]);
			totalChars += olderSessions[i].characterCount;
		}

		const totalTime = sum(recentSessions.map(session => session.endTime - session.startTime));
		if (totalTime === 0 || totalChars <= 1) {
			return { averageInterval: 0, characterCount: totalChars };
		}

		const keystrokeIntervals = Math.max(1, totalChars - 1);
		const avgMsBetweenKeystrokes = totalTime / keystrokeIntervals;

		return {
			averageInterval: Math.round(avgMsBetweenKeystrokes),
			characterCount: totalChars
		};
	}

	public reset(): void {
		this._typingSessions.length = 0;
		this._currentSession = null;
		this._lastChangeTime = 0;
		this._cachedTypingIntervalResult = null;
		this._cacheInvalidated = true;
	}

	public override dispose(): void {
		this._finalizeCurrentSession();
		super.dispose();
	}
}
