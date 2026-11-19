/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IAuthenticationChallenge, IAuthorizationProtectedResourceMetadata, IAuthorizationServerMetadata } from '../../../../base/common/oauth.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const INTERNAL_AUTH_PROVIDER_PREFIX = '__';

export const ACCOUNTS_AVATAR_SETTING = 'accounts.avatar';

export interface AuthenticationSessionAccount {
	label: string;
	id: string;
	icon?: URI | { light: URI; dark: URI } | ThemeIcon;
}

export interface AuthenticationSession {
	id: string;
	accessToken: string;
	account: AuthenticationSessionAccount;
	scopes: ReadonlyArray<string>;
	idToken?: string;
}

export interface AuthenticationSessionsChangeEvent {
	added: ReadonlyArray<AuthenticationSession> | undefined;
	removed: ReadonlyArray<AuthenticationSession> | undefined;
	changed: ReadonlyArray<AuthenticationSession> | undefined;
}

export interface AuthenticationProviderInformation {
	id: string;
	label: string;
	authorizationServerGlobs?: ReadonlyArray<string>;
}

export interface IAuthenticationCreateSessionOptions {
	activateImmediate?: boolean;
	account?: AuthenticationSessionAccount;
	authorizationServer?: URI;
	resource?: string;
	audience?: string;
	[key: string]: any;
}

export interface IAuthenticationWwwAuthenticateRequest {
	readonly wwwAuthenticate: string;

	readonly fallbackScopes?: readonly string[];
}

export function isAuthenticationWwwAuthenticateRequest(obj: unknown): obj is IAuthenticationWwwAuthenticateRequest {
	return typeof obj === 'object'
		&& obj !== null
		&& 'wwwAuthenticate' in obj
		&& (typeof obj.wwwAuthenticate === 'string');
}

export interface IAuthenticationConstraint {
	readonly challenges: readonly IAuthenticationChallenge[];

	readonly fallbackScopes?: readonly string[];
}

export interface IAuthenticationGetSessionsOptions {
	silent?: boolean;
	account?: AuthenticationSessionAccount;
	authorizationServer?: URI;
	resource?: string;
	audience?: string;
	[key: string]: any;
}

export interface AllowedExtension {
	id: string;
	name: string;
	allowed?: boolean;
	lastUsed?: number;
	trusted?: boolean;
}

export interface IAuthenticationProviderHostDelegate {
	readonly priority: number;
	create(authorizationServer: URI, serverMetadata: IAuthorizationServerMetadata, resource: IAuthorizationProtectedResourceMetadata | undefined, clientId?: string, clientSecret?: string): Promise<string>;
	createXaa?(issuer: URI): Promise<string>;
}

export function getDynamicAuthenticationProviderId(authorizationServer: URI, resource: IAuthorizationProtectedResourceMetadata | undefined): string {
	return resource ? `${authorizationServer.toString(true)} ${resource.resource}` : authorizationServer.toString(true);
}

export const IAuthenticationService = createDecorator<IAuthenticationService>('IAuthenticationService');

export interface IAuthenticationService {
	readonly _serviceBrand: undefined;

	readonly onDidRegisterAuthenticationProvider: Event<AuthenticationProviderInformation>;
	readonly onDidUnregisterAuthenticationProvider: Event<AuthenticationProviderInformation>;

	readonly onDidChangeSessions: Event<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>;

	readonly onDidChangeDeclaredProviders: Event<void>;

	readonly declaredProviders: AuthenticationProviderInformation[];

	registerDeclaredAuthenticationProvider(provider: AuthenticationProviderInformation): void;

	unregisterDeclaredAuthenticationProvider(id: string): void;

	isAuthenticationProviderRegistered(id: string): boolean;

	isDynamicAuthenticationProvider(id: string): boolean;

	registerAuthenticationProvider(id: string, provider: IAuthenticationProvider): void;

	unregisterAuthenticationProvider(id: string): void;

	getProviderIds(): string[];

	getProvider(id: string): IAuthenticationProvider;

	getAccounts(id: string): Promise<ReadonlyArray<AuthenticationSessionAccount>>;

	getSessions(id: string, scopeListOrRequest?: ReadonlyArray<string> | IAuthenticationWwwAuthenticateRequest, options?: IAuthenticationGetSessionsOptions, activateImmediate?: boolean): Promise<ReadonlyArray<AuthenticationSession>>;

	createSession(providerId: string, scopeListOrRequest: ReadonlyArray<string> | IAuthenticationWwwAuthenticateRequest, options?: IAuthenticationCreateSessionOptions): Promise<AuthenticationSession>;

	removeSession(providerId: string, sessionId: string): Promise<void>;

	getOrActivateProviderIdForServer(authorizationServer: URI, resourceServer?: URI): Promise<string | undefined>;

	registerAuthenticationProviderHostDelegate(delegate: IAuthenticationProviderHostDelegate): IDisposable;

	createDynamicAuthenticationProvider(authorizationServer: URI, serverMetadata: IAuthorizationServerMetadata, resourceMetadata: IAuthorizationProtectedResourceMetadata | undefined, clientId?: string, clientSecret?: string): Promise<IAuthenticationProvider | undefined>;

	createOrGetXaaProvider(issuer: URI): Promise<string | undefined>;
}

export function isAuthenticationSession(thing: unknown): thing is AuthenticationSession {
	if (typeof thing !== 'object' || !thing) {
		return false;
	}
	const maybe = thing as AuthenticationSession;
	if (typeof maybe.id !== 'string') {
		return false;
	}
	if (typeof maybe.accessToken !== 'string') {
		return false;
	}
	if (typeof maybe.account !== 'object' || !maybe.account) {
		return false;
	}
	if (typeof maybe.account.label !== 'string') {
		return false;
	}
	if (typeof maybe.account.id !== 'string') {
		return false;
	}
	if (!Array.isArray(maybe.scopes)) {
		return false;
	}
	if (maybe.idToken && typeof maybe.idToken !== 'string') {
		return false;
	}
	return true;
}

export const IAuthenticationExtensionsService = createDecorator<IAuthenticationExtensionsService>('IAuthenticationExtensionsService');
export interface IAuthenticationExtensionsService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeAccountPreference: Event<{ extensionIds: string[]; providerId: string }>;
	getAccountPreference(extensionId: string, providerId: string): string | undefined;
	updateAccountPreference(extensionId: string, providerId: string, account: AuthenticationSessionAccount): void;
	removeAccountPreference(extensionId: string, providerId: string): void;
	updateSessionPreference(providerId: string, extensionId: string, session: AuthenticationSession): void;
	getSessionPreference(providerId: string, extensionId: string, scopes: string[]): string | undefined;
	removeSessionPreference(providerId: string, extensionId: string, scopes: string[]): void;
	selectSession(providerId: string, extensionId: string, extensionName: string, scopeListOrRequest: ReadonlyArray<string> | IAuthenticationWwwAuthenticateRequest, possibleSessions: readonly AuthenticationSession[]): Promise<AuthenticationSession>;
	requestSessionAccess(providerId: string, extensionId: string, extensionName: string, scopeListOrRequest: ReadonlyArray<string> | IAuthenticationWwwAuthenticateRequest, possibleSessions: readonly AuthenticationSession[]): void;
	requestNewSession(providerId: string, scopeListOrRequest: ReadonlyArray<string> | IAuthenticationWwwAuthenticateRequest, extensionId: string, extensionName: string): Promise<void>;
	updateNewSessionRequests(providerId: string, addedSessions: readonly AuthenticationSession[]): void;
}

export interface IAuthenticationProviderSessionOptions {
	silent?: boolean;
	account?: AuthenticationSessionAccount;
	authorizationServer?: URI;
	resource?: string;
	audience?: string;
	[key: string]: any;
}

export interface IAuthenticationProvider {
	readonly id: string;

	readonly label: string;

	readonly resourceServer?: URI;

	readonly authorizationServers?: ReadonlyArray<URI>;

	readonly supportsMultipleAccounts: boolean;

	readonly confirmation?: (extensionName: string, recreatingSession: boolean) => string | undefined;

	readonly onDidChangeSessions: Event<AuthenticationSessionsChangeEvent>;

	getSessions(scopes: string[] | undefined, options: IAuthenticationProviderSessionOptions): Promise<readonly AuthenticationSession[]>;

	createSession(scopes: string[], options: IAuthenticationProviderSessionOptions): Promise<AuthenticationSession>;

	getSessionsFromChallenges?(constraint: IAuthenticationConstraint, options: IAuthenticationProviderSessionOptions): Promise<readonly AuthenticationSession[]>;

	createSessionFromChallenges?(constraint: IAuthenticationConstraint, options: IAuthenticationProviderSessionOptions): Promise<AuthenticationSession>;

	removeSession(sessionId: string): Promise<void>;
}
