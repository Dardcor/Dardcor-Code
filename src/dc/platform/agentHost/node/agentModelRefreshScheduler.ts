/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntervalTimer } from '../../../base/common/async.js';
import type { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IObservable, autorun } from '../../../base/common/observable.js';
import { ILogService } from '../../log/common/log.js';
import { IAgent } from '../common/agent.js';

export const MODEL_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export class AgentModelRefreshScheduler extends Disposable {

	private readonly _timer = this._register(new IntervalTimer());
	private _agents: readonly IAgent[] = [];
	private _isTimerRunning = false;

	private readonly _activeSinceLastRefresh = new Set<string>();
	private readonly _lastRefreshAt = new Map<string, number>();

	constructor(
		agents: IObservable<readonly IAgent[]>,
		onDidStartTurn: Event<string>,
		private readonly _intervalMs: number,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(autorun(reader => {
			this._agents = agents.read(reader);
			if (this._agents.length === 0) {
				this._timer.cancel();
				this._isTimerRunning = false;
				return;
			}
			if (!this._isTimerRunning) {
				this._timer.cancelAndSet(() => this._refreshActive(this._agents), this._intervalMs);
				this._isTimerRunning = true;
			}
		}));

		this._register(onDidStartTurn(provider => this._handleTurnStarted(provider)));
	}

	private _handleTurnStarted(provider: string): void {
		const lastRefreshAt = this._lastRefreshAt.get(provider);
		if (lastRefreshAt !== undefined && Date.now() - lastRefreshAt < this._intervalMs) {
			this._activeSinceLastRefresh.add(provider);
			return;
		}
		const agent = this._agents.find(a => a.getDescriptor().provider === provider);
		if (!agent) {
			return;
		}
		this._activeSinceLastRefresh.delete(provider);
		this._refresh(agent, 'stale catalog on turn start');
	}

	private _refreshActive(agents: readonly IAgent[]): void {
		for (const agent of agents) {
			const provider = agent.getDescriptor().provider;
			if (!this._activeSinceLastRefresh.delete(provider)) {
				continue;
			}
			this._refresh(agent, 'periodic');
		}
	}

	private _refresh(agent: IAgent, reason: string): void {
		if (!agent.refreshModels) {
			return;
		}
		const provider = agent.getDescriptor().provider;
		this._lastRefreshAt.set(provider, Date.now());
		this._logService.trace(`[AgentHost] Model refresh for ${provider} (${reason})`);
		agent.refreshModels().catch(err => this._logService.error(err, `[AgentHost] Model refresh failed for ${provider}`));
	}
}
