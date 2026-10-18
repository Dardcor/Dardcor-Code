/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const autoModeTiers = ['eco', 'balanced', 'max', 'fast'] as const;

export type AutoModeTier = typeof autoModeTiers[number];

export const selectableAutoModeTiers: readonly AutoModeTier[] = ['eco', 'balanced', 'max'];

export const defaultAutoModeTier: AutoModeTier = 'balanced';

export const inlineChatAutoModeTier: AutoModeTier = 'fast';

export const AUTO_MODE_TIER_PROPERTY = 'tier';

export function isSelectableAutoModeTier(value: unknown): value is AutoModeTier {
	return typeof value === 'string' && (selectableAutoModeTiers as readonly string[]).includes(value);
}
