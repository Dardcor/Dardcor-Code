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

/**
 * Which transport should the Claude provider fall back to right now? Pure
 * decision; precedence, highest first:
 *
 *  1. Feature flag off means today's default behavior (always proxy).
 *  2. When the opt-in flag is on, the user's own Claude credentials use native.
 *  3. Otherwise the local Dardcor Router proxy is used; it does not depend on GitHub auth.
 *  4. Nothing usable still falls back to proxy — the safe end, since attempting
 *     native with no credential would fail inside the SDK rather than at a
 *     surface that can explain itself.
 *
 * This is only the *fallback* for a session whose model names no provider. A
 * provider-qualified model routes on its own provider
 * (`resolveClaudeSessionTransport`), so getting this decision right is what lets
 * a signed-out user with their own credentials start working without being
 * forced to sign in.
 *
 * The result is **not** an input to the Agents window's sign-in gate, and
 * resolving to `proxy` does not by itself make the session type "require GitHub".
 * `getProtectedResources()` exposes repository authentication only for Git
 * operations. Router model access does not depend on GitHub sign-in.
 *
 * There is deliberately no host-global setting to *prefer* a transport. Since
 * the picker offers both providers' models side by side, transport is downstream
 * of the model the user picked; a flag would keep disagreeing with what the
 * picker shows (it could not stop a Copilot-routed model from being offered or
 * chosen, because neither model enumeration nor the advertised protected
 * resources would consult it). Expressing a preference is a *model*-selection
 * concern — a default/sticky model — not a transport one.
 */
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
