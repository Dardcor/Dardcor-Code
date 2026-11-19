/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { authentication, AuthenticationGetSessionOptions, AuthenticationSession, AuthenticationSessionsChangeEvent } from 'vscode';
import { mixin } from '../../../util/dardcor/base/common/objects';
import { URI } from '../../../util/dardcor/base/common/uri';
import { AuthPermissionMode, ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { authProviderId, GITHUB_SCOPE_ALIGNED, GITHUB_SCOPE_READ_USER, GITHUB_SCOPE_USER_EMAIL, MinimalModeError } from '../common/authentication';

export const SESSION_LOGIN_MESSAGE = 'You are not signed in to GitHub. Please sign in to use Copilot.';
type CopilotAuthenticationSessionAccountInformation = {
	label: string;
};

export type CopilotAuthenticationSession = {
	accessToken: string;
	account: CopilotAuthenticationSessionAccountInformation;
};

async function getAuthSession(providerId: string, defaultScopes: string[], getSilentSession: () => Promise<AuthenticationSession | undefined>, options: AuthenticationGetSessionOptions = {}) {
	const accounts = await authentication.getAccounts(providerId);
	if (!accounts.length) {
		return await authentication.getSession(providerId, defaultScopes, options);
	}

	if (options.forceNewSession) {
		const session = await authentication.getSession(providerId, defaultScopes, {
			...options,
			forceNewSession: mixin({ learnMore: URI.parse('https://aka.ms/dardcorRepoScope') }, options.forceNewSession),
			clearSessionPreference: true
		});
		return session;
	}

	const silentSession = await getSilentSession();
	if (silentSession) {
		return silentSession;
	}

	if (options.createIfNone) {
		const session = await authentication.getSession(providerId, defaultScopes, options);
		return session;
	}
	return await authentication.getSession(providerId, defaultScopes, options);
}

export function getAnyAuthSession(configurationService: IConfigurationService, options?: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined> {
	const providerId = authProviderId(configurationService);

	return getAuthSession(
		providerId,
		GITHUB_SCOPE_USER_EMAIL,
		async () => {
			if (configurationService.getConfig(ConfigKey.Shared.AuthPermissions) !== AuthPermissionMode.Minimal) {
				const permissive = await authentication.getSession(providerId, GITHUB_SCOPE_ALIGNED, { silent: true });
				if (permissive) {
					return permissive;
				}
			}
			const minimal = await authentication.getSession(providerId, GITHUB_SCOPE_USER_EMAIL, { silent: true });
			if (minimal) {
				return minimal;
			}
			const fallback = await authentication.getSession(providerId, GITHUB_SCOPE_READ_USER, { silent: true });
			if (fallback) {
				return fallback;
			}
			return undefined;
		},
		options
	);
}

export function getAlignedSession(configurationService: IConfigurationService, options: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined> {
	if (configurationService.getConfig(ConfigKey.Shared.AuthPermissions) === AuthPermissionMode.Minimal) {
		if (options.createIfNone || options.forceNewSession) {
			throw new MinimalModeError();
		}
		return Promise.resolve(undefined);
	}
	const providerId = authProviderId(configurationService);
	return getAuthSession(
		providerId,
		GITHUB_SCOPE_ALIGNED,
		async () => await authentication.getSession(providerId, GITHUB_SCOPE_ALIGNED, { silent: true }),
		options
	);
}

export function authChangeAffectsCopilot(event: AuthenticationSessionsChangeEvent, configurationService: IConfigurationService): boolean {
	const provider = event.provider;
	const providerId = authProviderId(configurationService);
	return provider.id === providerId;
}
