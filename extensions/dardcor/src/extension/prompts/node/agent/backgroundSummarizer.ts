/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../util/dardcor/base/common/cancellation';


export const enum BackgroundSummarizationState {
	Idle = 'Idle',
	InProgress = 'InProgress',
	Completed = 'Completed',
	Failed = 'Failed',
}

export interface IBackgroundSummarizationResult {
	readonly summary: string;
	readonly toolCallRoundId: string;
	readonly promptTokens?: number;
	readonly promptCacheTokens?: number;
	readonly outputTokens?: number;
	readonly durationMs?: number;
	readonly model?: string;
	readonly summarizationMode?: string;
	readonly numRounds?: number;
	readonly numRoundsSinceLastSummarization?: number;
}

export const BackgroundSummarizationThresholds = {
	warmJitterMin: 0.78,
	warmJitterSpan: 0.04,
	emergency: 0.90,
	applyMinRatio: 0.65,
} as const;

export function shouldKickOffBackgroundSummarization(
	postRenderRatio: number,
	cacheWarm: boolean,
	rng: () => number,
): boolean {
	const t = BackgroundSummarizationThresholds;
	if (!cacheWarm) {
		return postRenderRatio >= t.emergency;
	}
	const jittered = t.warmJitterMin + rng() * t.warmJitterSpan;
	return postRenderRatio >= jittered;
}

export interface ISummaryAnchorRound {
	readonly id: string;
}

export interface ISummaryAnchorTurn {
	readonly rounds: readonly ISummaryAnchorRound[];
}

export function resolveSummaryAnchorRoundId(
	rounds: readonly ISummaryAnchorRound[],
	history: readonly ISummaryAnchorTurn[],
): string | undefined {
	if (rounds.length >= 2) {
		return rounds[rounds.length - 2].id;
	} else if (rounds.length === 1) {
		return rounds[0].id;
	}
	for (let i = history.length - 1; i >= 0; i--) {
		const lastRound = history[i].rounds.at(-1);
		if (lastRound) {
			return lastRound.id;
		}
	}
	return undefined;
}

export class BackgroundSummarizer {

	private _state: BackgroundSummarizationState = BackgroundSummarizationState.Idle;
	private _result: IBackgroundSummarizationResult | undefined;
	private _error: unknown;
	private _promise: Promise<void> | undefined;
	private _cts: CancellationTokenSource | undefined;

	readonly modelMaxPromptTokens: number;

	readonly endpointId: string | undefined;

	get state(): BackgroundSummarizationState { return this._state; }
	get error(): unknown { return this._error; }

	get token() { return this._cts?.token; }

	constructor(modelMaxPromptTokens: number, endpointId?: string) {
		this.modelMaxPromptTokens = modelMaxPromptTokens;
		this.endpointId = endpointId;
	}

	start(work: (token: CancellationToken) => Promise<IBackgroundSummarizationResult>, parentToken?: CancellationToken): void {
		if (this._state !== BackgroundSummarizationState.Idle && this._state !== BackgroundSummarizationState.Failed) {
			return;
		}

		this._state = BackgroundSummarizationState.InProgress;
		this._error = undefined;
		this._cts = new CancellationTokenSource(parentToken);
		const token = this._cts.token;
		this._promise = work(token).then(
			result => {
				if (this._state !== BackgroundSummarizationState.InProgress) {
					return;
				}
				this._result = result;
				this._state = BackgroundSummarizationState.Completed;
			},
			err => {
				if (this._state !== BackgroundSummarizationState.InProgress) {
					return;
				}
				this._error = err;
				this._state = BackgroundSummarizationState.Failed;
			},
		);
	}

	async waitForCompletion(): Promise<void> {
		if (this._promise) {
			await this._promise;
		}
	}

	consumeAndReset(): IBackgroundSummarizationResult | undefined {
		if (this._state === BackgroundSummarizationState.InProgress) {
			return undefined;
		}
		const result = this._result;
		this._state = BackgroundSummarizationState.Idle;
		this._result = undefined;
		this._error = undefined;
		this._promise = undefined;
		this._cts?.dispose();
		this._cts = undefined;
		return result;
	}

	cancel(): void {
		this._cts?.cancel();
		this._cts?.dispose();
		this._cts = undefined;
		this._state = BackgroundSummarizationState.Idle;
		this._result = undefined;
		this._error = undefined;
		this._promise = undefined;
	}
}
