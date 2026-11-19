/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { IHeaders } from '../../networking/common/fetcherService';
import { IChatQuota, IChatQuotaService, QuotaSnapshots } from './chatQuotaService';

export class ChatQuotaService extends Disposable implements IChatQuotaService {
	declare readonly _serviceBrand: undefined;

	private _quotaInfo: IChatQuota | undefined;
	private _rateLimitInfo: { session: IChatQuota | undefined; weekly: IChatQuota | undefined };
	private readonly _turnCredits = new Map<string, number>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor() {
		super();
		this._rateLimitInfo = { session: undefined, weekly: undefined };
	}

	get quotaInfo(): IChatQuota | undefined {
		return this._quotaInfo;
	}

	get rateLimitInfo(): { readonly session: IChatQuota | undefined; readonly weekly: IChatQuota | undefined } {
		return this._rateLimitInfo;
	}

	get quotaExhausted(): boolean {
		return false;
	}

	get additionalUsageEnabled(): boolean {
		return false;
	}

	getCreditsForTurn(turnId: string): number | undefined {
		return this._turnCredits.get(turnId);
	}

	setLastDardcorUsage(totalNanoAiu: number, turnId: string): void {
		const aic = totalNanoAiu / 1_000_000_000;
		if (aic >= 0) {
			this._turnCredits.set(turnId, (this._turnCredits.get(turnId) ?? 0) + aic);
		}
	}

	resetTurnCredits(turnId: string): void {
		this._turnCredits.delete(turnId);
	}

	clearQuota(): void {
		this._quotaInfo = undefined;
	}

	processQuotaHeaders(_headers: IHeaders): void {
	}

	processQuotaSnapshots(_snapshots: QuotaSnapshots): void {
	}

	async refreshQuota(): Promise<void> {
	}
}
