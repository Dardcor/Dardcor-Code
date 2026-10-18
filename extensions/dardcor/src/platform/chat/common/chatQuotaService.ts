/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/dardcor/base/common/event';
import { IHeaders } from '../../networking/common/fetcherService';

export interface CopilotUserQuotaInfo {
	quota_reset_date?: string;
	quota_snapshots?: {
		chat: {
			quota_id: string;
			entitlement: number;
			remaining: number;
			unlimited: boolean;
			overage_count: number;
			overage_permitted: boolean;
			percent_remaining: number;
			has_quota?: boolean;
		};
		completions: {
			quota_id: string;
			entitlement: number;
			remaining: number;
			unlimited: boolean;
			overage_count: number;
			overage_permitted: boolean;
			percent_remaining: number;
			has_quota?: boolean;
		};
		premium_interactions: {
			quota_id: string;
			entitlement: number;
			remaining: number;
			unlimited: boolean;
			overage_count: number;
			overage_permitted: boolean;
			percent_remaining: number;
			has_quota?: boolean;
		};
	};
}

export interface IChatQuota {
	quota: number;
	percentRemaining: number;
	unlimited: boolean;
	hasQuota: boolean;
	additionalUsageUsed: number;
	additionalUsageEnabled: boolean;
	resetDate: Date;
}

export interface QuotaSnapshot {
	readonly entitlement: string;
	readonly percent_remaining: number;
	readonly overage_permitted: boolean;
	readonly overage_count: number;
	readonly has_quota?: boolean;
	readonly reset_date?: string;
}

export type QuotaSnapshots = Record<string, QuotaSnapshot>;

export interface IChatQuotaService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	readonly quotaInfo: IChatQuota | undefined;
	readonly rateLimitInfo: { readonly session: IChatQuota | undefined; readonly weekly: IChatQuota | undefined };
	quotaExhausted: boolean;
	additionalUsageEnabled: boolean;
	getCreditsForTurn(turnId: string): number | undefined;
	processQuotaHeaders(headers: IHeaders): void;
	processQuotaSnapshots(snapshots: QuotaSnapshots): void;
	setLastDardcorUsage(totalNanoAiu: number, turnId: string): void;
	resetTurnCredits(turnId: string): void;
	clearQuota(): void;
	refreshQuota(): Promise<void>;
}

export const IChatQuotaService = createServiceIdentifier<IChatQuotaService>('IChatQuotaService');
