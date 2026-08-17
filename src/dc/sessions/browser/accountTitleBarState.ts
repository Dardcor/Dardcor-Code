/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../base/common/codicons.js';
import type { ThemeIcon } from '../../base/common/themables.js';
import type { ChatEntitlement, IChatSentiment, IQuotaSnapshot } from '../../workbench/services/chat/common/chatEntitlementService.js';
import { IDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';

export interface IResolvedAccountInfo {
	readonly accountName: string;
	readonly accountProviderId: string;
	readonly accountProviderLabel: string;
}

/**
 * Resolves the current account info by trying the default account service
 * first, then falling back to raw GitHub sessions from the authentication
 * service. The fallback covers the window between session creation and
 * {@link IDefaultAccountService} initialization.
 */
export async function resolveAccountInfo(
	defaultAccountService: IDefaultAccountService,
	authenticationService: IAuthenticationService,
): Promise<IResolvedAccountInfo | undefined> {
	const account = await defaultAccountService.getDefaultAccount();
	if (account) {
		return {
			accountName: account.accountName,
			accountProviderId: account.authenticationProvider.id,
			accountProviderLabel: account.authenticationProvider.name,
		};
	}

	try {
		const sessions = await authenticationService.getSessions('github');
		if (sessions.length > 0) {
			return {
				accountName: sessions[0].account.label,
				accountProviderId: 'github',
				accountProviderLabel: 'GitHub',
			};
		}
	} catch {
		// Provider not available yet
	}

	return undefined;
}

export type AccountTitleBarStateSource = 'account' | 'copilot';
export type AccountTitleBarStateKind = 'default' | 'accent' | 'warning' | 'prominent';

export interface IAccountTitleBarStateContext {
	readonly isAccountLoading: boolean;
	readonly accountName?: string;
	readonly accountProviderLabel?: string;
	readonly entitlement: ChatEntitlement;
	readonly sentiment: IChatSentiment;
	readonly quotas: {
		readonly chat?: IQuotaSnapshot;
		readonly completions?: IQuotaSnapshot;
	};
	/**
	 * Whether at least one registered session type is usable without GitHub
	 * right now (the conditional-auth opt-in is on and a usable type exists).
	 * When true, a signed-out account shows a calm opt-in sign-in instead of the
	 * alarming "Agents Signed Out". Defaults to `false`, so the opt-in being off
	 * keeps today's behavior.
	 */
	readonly usableWithoutGitHub: boolean;
}

export interface IAccountTitleBarState {
	readonly source: AccountTitleBarStateSource;
	readonly kind: AccountTitleBarStateKind;
	readonly icon: ThemeIcon;
	readonly label: string;
	readonly ariaLabel: string;
	readonly badge?: string;
	readonly dotBadge?: 'warning' | 'error';
	readonly revealLabelOnHover?: boolean;
}

export function getAccountProfileImageUrl(accountProviderId: string | undefined, accountName: string | undefined): string | undefined {
	if (accountProviderId !== 'github' || !accountName?.trim()) {
		return undefined;
	}

	return `https://github.com/${encodeURIComponent(accountName.trim())}.png?size=64`;
}

export function getAccountTitleBarBadgeKey(state: IAccountTitleBarState): string | undefined {
	if (!state.dotBadge) {
		return undefined;
	}

	return `${state.source}:${state.dotBadge}:${state.badge ?? ''}`;
}

export function getAccountTitleBarState(context: IAccountTitleBarStateContext): IAccountTitleBarState {
	return {
		source: 'account',
		kind: 'default',
		icon: Codicon.account,
		label: 'Dardcor',
		ariaLabel: 'Dardcor Code',
		revealLabelOnHover: true,
	};
}


