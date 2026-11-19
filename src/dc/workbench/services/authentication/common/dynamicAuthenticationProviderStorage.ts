/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuthorizationTokenResponse } from '../../../../base/common/oauth.js';
import { Event } from '../../../../base/common/event.js';

export const IDynamicAuthenticationProviderStorageService = createDecorator<IDynamicAuthenticationProviderStorageService>('dynamicAuthenticationProviderStorageService');

export interface DynamicAuthenticationProviderInfo {
	readonly providerId: string;
	readonly label: string;
	readonly issuer?: string;
	readonly authorizationServer: string;
	readonly clientId: string;
}

export interface DynamicAuthenticationProviderTokensChangeEvent {
	readonly authProviderId: string;
	readonly clientId: string;
	readonly tokens: (IAuthorizationTokenResponse & { created_at: number })[] | undefined;
}

export interface IDynamicAuthenticationProviderStorageService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeTokens: Event<DynamicAuthenticationProviderTokensChangeEvent>;

	getClientRegistration(providerId: string): Promise<{ clientId?: string; clientSecret?: string } | undefined>;

	storeClientRegistration(providerId: string, authorizationServer: string, clientId: string, clientSecret?: string, label?: string): Promise<void>;

	getInteractedProviders(): ReadonlyArray<DynamicAuthenticationProviderInfo>;

	removeDynamicProvider(providerId: string): Promise<void>;

	getSessionsForDynamicAuthProvider(authProviderId: string, clientId: string): Promise<(IAuthorizationTokenResponse & { created_at: number })[] | undefined>;

	setSessionsForDynamicAuthProvider(authProviderId: string, clientId: string, sessions: (IAuthorizationTokenResponse & { created_at: number })[]): Promise<void>;
}
