/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { ILogService } from '../../../log/common/log.js';
import type { IAgentHostClientTelemetryContext } from '../../common/agentHostTelemetry.js';

export interface IPendingSdkMessage {
	readonly sdkMessage: SDKUserMessage;
	readonly sdkUuid: string;
	readonly turnId: string;
	readonly clientContext?: IAgentHostClientTelemetryContext;
	readonly stopWatch: StopWatch;
	readonly deferred: DeferredPromise<void>;
	readonly steeringPendingId?: string;
}

export class ClaudePromptQueue extends Disposable {

	private _toYield: IPendingSdkMessage[] = [];
	private _yielded: IPendingSdkMessage[] = [];
	private _popped: IPendingSdkMessage[] = [];
	private _pendingPromptDeferred = new DeferredPromise<void>();

	readonly iterable: AsyncIterable<SDKUserMessage> = {
		[Symbol.asyncIterator]: () => ({
			next: async () => {
				while (true) {
					if (this._getAbortSignal().aborted) {
						return { done: true, value: undefined };
					}
					if (this._toYield.length > 0) {
						const entry = this._toYield.shift()!;
						this._yielded.push(entry);
						this._logService.info(`[Claude:${this._sessionId}] queue yielded sdkUuid=${entry.sdkUuid} turnId=${entry.turnId}${entry.steeringPendingId ? ` steeringPendingId=${entry.steeringPendingId}` : ''}`);
						if (entry.steeringPendingId) {
							this._onSteeringYielded(entry.steeringPendingId);
						}
						return { done: false, value: entry.sdkMessage };
					}
					await this._pendingPromptDeferred.p;
					this._pendingPromptDeferred = new DeferredPromise<void>();
				}
			},
		}),
	};

	constructor(
		private readonly _sessionId: string,
		private readonly _getAbortSignal: () => AbortSignal,
		private readonly _onSteeringYielded: (pendingId: string) => void,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	get isEmpty(): boolean {
		return this._toYield.length === 0 && this._yielded.length === 0;
	}
	push(entry: IPendingSdkMessage): Promise<void> {
		this._toYield.push(entry);
		this._pendingPromptDeferred.complete();
		return entry.deferred.p;
	}

	peekParent(): IPendingSdkMessage | undefined {
		return this._yielded[0] ?? this._toYield[this._toYield.length - 1];
	}

	settleHead(): IPendingSdkMessage | undefined {
		const completed = this._yielded.shift();
		if (!completed) {
			return undefined;
		}
		if (this.isEmpty) {
			completed.deferred.complete();
			for (const e of this._popped) {
				if (!e.deferred.isSettled) {
					e.deferred.complete();
				}
			}
			this._popped = [];
		} else {
			this._popped.push(completed);
		}
		return completed;
	}

	failAll(err: Error): void {
		const rejectAll = (list: IPendingSdkMessage[]) => {
			for (const entry of list) {
				if (!entry.deferred.isSettled) {
					entry.deferred.error(err);
				}
			}
		};
		rejectAll(this._toYield);
		rejectAll(this._yielded);
		rejectAll(this._popped);
		this._toYield = [];
		this._yielded = [];
		this._popped = [];
	}

	notifyAborted(): void {
		this._pendingPromptDeferred.complete();
	}

	resetForRebind(): void {
		this._pendingPromptDeferred = new DeferredPromise<void>();
	}
}
