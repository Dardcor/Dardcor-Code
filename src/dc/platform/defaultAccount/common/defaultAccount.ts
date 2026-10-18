/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICopilotTokenInfo, IDefaultAccount, IDefaultAccountAuthenticationProvider, IPolicyData } from '../../../base/common/defaultAccount.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const GitHubPaths = {
	copilotSettings: 'settings/copilot/features',
	billingBudgets: 'settings/copilot/features?utm_source=vscode',
	copilotUpgrade: 'github-copilot/upgrade?utm_source=vscode',
} as const;

export const MANAGED_SETTINGS_FRESHNESS_NOT_REQUIRED = 'not_required';

export type ManagedSettingsFetchStatus = number | 'ok' | 'no-url' | 'no-response' | 'parse-error' | null;

export interface IDefaultAccountProvider {
	readonly defaultAccount: IDefaultAccount | null;
	readonly onDidChangeDefaultAccount: Event<IDefaultAccount | null>;
	readonly policyData: IPolicyData | null;
	readonly onDidChangePolicyData: Event<IPolicyData | null>;
	readonly copilotTokenInfo: ICopilotTokenInfo | null;
	readonly onDidChangeCopilotTokenInfo: Event<ICopilotTokenInfo | null>;
	readonly managedSettingsFetchStatus: ManagedSettingsFetchStatus;
	readonly managedSettingsFetchedAt: number | null;
	readonly managedSettingsRawResponse: unknown;
	getDefaultAccountAuthenticationProvider(): IDefaultAccountAuthenticationProvider;

	resolveGitHubUrl(path: string): string;

	refresh(options?: { forceRefresh?: boolean }): Promise<IDefaultAccount | null>;
	signIn(options?: { additionalScopes?: readonly string[];[key: string]: unknown }): Promise<IDefaultAccount | null>;
	signOut(): Promise<void>;
}

export const IDefaultAccountService = createDecorator<IDefaultAccountService>('defaultAccountService');

export interface IDefaultAccountService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeDefaultAccount: Event<IDefaultAccount | null>;
	readonly onDidChangePolicyData: Event<IPolicyData | null>;
	readonly policyData: IPolicyData | null;
	readonly currentDefaultAccount: IDefaultAccount | null;
	readonly copilotTokenInfo: ICopilotTokenInfo | null;
	readonly onDidChangeCopilotTokenInfo: Event<ICopilotTokenInfo | null>;
	readonly managedSettingsFetchStatus: ManagedSettingsFetchStatus;
	readonly managedSettingsFetchedAt: number | null;
	readonly managedSettingsRawResponse: unknown;
	getDefaultAccount(): Promise<IDefaultAccount | null>;
	getDefaultAccountAuthenticationProvider(): IDefaultAccountAuthenticationProvider;
	setDefaultAccountProvider(provider: IDefaultAccountProvider): void;
	refresh(options?: { forceRefresh?: boolean; retryManagedSettings?: boolean }): Promise<IDefaultAccount | null>;
	signIn(options?: { additionalScopes?: readonly string[];[key: string]: unknown }): Promise<IDefaultAccount | null>;
	signOut(): Promise<void>;

	resolveGitHubUrl(path: string): string;
}
