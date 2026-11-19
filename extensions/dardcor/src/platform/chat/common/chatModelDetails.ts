/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

export interface ModelDetailsInfo {
	readonly name: string;
	readonly multiplier: number | undefined;
}

export function formatModelDetails(modelName: string, multiplier: number | undefined, creditsUsed: number | undefined): string {
	if (creditsUsed !== undefined) {
		return formatModelDetailsWithCredits(modelName, creditsUsed);
	}
	return formatModelDetailsWithMultiplier(modelName, multiplier);
}

export function formatModelDetailsWithCredits(modelName: string, creditsUsed: number): string {
	const formatted = creditsUsed % 1 === 0 ? creditsUsed.toString() : creditsUsed.toFixed(1);
	return creditsUsed === 1
		? l10n.t('{0} \u2022 {1} credit', modelName, formatted)
		: l10n.t('{0} \u2022 {1} credits', modelName, formatted);
}

export function formatModelDetailsWithMultiplier(modelName: string, multiplier: number | undefined): string {
	return multiplier !== undefined ? l10n.t('{0} \u2022 {1}x', modelName, multiplier) : modelName;
}

export function formatAutoModeDetails(creditsUsed: number | undefined, multiplier: number | undefined): string {
	return formatModelDetails(l10n.t('Auto'), multiplier, creditsUsed);
}
