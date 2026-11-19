/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk';

export type ClaudeTransportMode = 'proxy' | 'native';

export interface IClaudeTransportModeInputs {
	readonly allowSignedOutWhenUsable: boolean;
	readonly hasExistingSetup: boolean;
}































export function resolveClaudeTransportMode(inputs: IClaudeTransportModeInputs): ClaudeTransportMode {
	const { allowSignedOutWhenUsable, hasExistingSetup } = inputs;
	if (allowSignedOutWhenUsable && hasExistingSetup) {
		return 'native';
	}
	return 'proxy';
}

export function isClaudeAccountSetUp(account: AccountInfo | undefined): boolean {
	if (!account) {
		return false;
	}
	if (account.apiProvider !== undefined && account.apiProvider !== 'firstParty') {
		return true;
	}
	return (account.tokenSource !== undefined && account.tokenSource !== 'none')
		|| account.apiKeySource !== undefined;
}
