/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';

export const autoModeTiers = ['efficiency', 'balance', 'intelligence'] as const;

export type AutoModeTier = typeof autoModeTiers[number];

export const defaultAutoModeTier: AutoModeTier = 'balance';

export function isAutoModeTier(value: unknown): value is AutoModeTier {
	return autoModeTiers.some(tier => tier === value);
}

export function normalizeAutoModeTier(value: unknown): unknown {
	switch (value) {
		case 'eco': return 'efficiency';
		case 'balanced': return 'balance';
		case 'max': return 'intelligence';
		default: return value;
	}
}

export function getAutoModeTierLabel(tier: string): string {
	switch (tier) {
		case 'efficiency': return localize('autoModeTier.efficiency', "Efficiency");
		case 'balance': return localize('autoModeTier.balance', "Balance");
		case 'intelligence': return localize('autoModeTier.intelligence', "Intelligence");
		default: return tier.charAt(0).toUpperCase() + tier.slice(1);
	}
}

export function getAutoModeTierDescription(tier: string): string | undefined {
	switch (tier) {
		case 'efficiency': return localize('autoModeTier.efficiencyDescription', "Cheaper models for everyday tasks");
		case 'balance': return localize('autoModeTier.balanceDescription', "Balances capability and cost");
		case 'intelligence': return localize('autoModeTier.intelligenceDescription', "Most capable models, higher cost");
		default: return undefined;
	}
}
