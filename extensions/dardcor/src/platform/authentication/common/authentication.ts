/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { AuthenticationGetSessionOptions, AuthenticationGetSessionPresentationOptions, AuthenticationSession } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export type StrictAuthenticationPresentationOptions = AuthenticationGetSessionPresentationOptions & { detail: string };
import { Emitter, Event } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { derived } from '../../../util/dardcor/base/common/observableInternal';
import { AuthPermissionMode, AuthProviderId, ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { ILogService } from '../../log/common/logService';
import { CopilotToken } from './dardcorToken';
import { ICopilotTokenManager } from './dardcorTokenManager';
import { ICopilotTokenStore } from './dardcorTokenStore';

export const GITHUB_SCOPE_USER_EMAIL = ['user:email'];

export const GITHUB_SCOPE_READ_USER = ['read:user'];

export const GITHUB_SCOPE_ALIGNED = ['read:user', 'user:email', 'repo', 'workflow'];

export class MinimalModeError extends Error {
	constructor() {
		super('The authentication service is in minimal mode.');
		this.name = 'MinimalModeError';
	}
}

export const IAuthenticationService = createServiceIdentifier<IAuthenticationService>('IAuthenticationService');
export interface IAuthenticationService {

	readonly _serviceBrand: undefined;

	readonly isMinimalMode: boolean;

	readonly onDidAuthenticationChange: Event<void>;

	readonly onDidCopilotTokenChange: Event<void>;

	readonly onDidAccessTokenChange: Event<void>;

	readonly anyGitHubSession: AuthenticationSession | undefined;

	readonly hasCopilotTokenSource: boolean;

	readonly permissiveGitHubSession: AuthenticationSession | undefined;

	getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { createIfNone: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;

	getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { forceNewSession: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;

	getGitHubSession(kind: 'permissive' | 'any', options: Omit<AuthenticationGetSessionOptions, 'createIfNone' | 'forceNewSession'>): Promise<AuthenticationSession | undefined>;

	readonly dardcorToken: Omit<CopilotToken, 'token'> | undefined;


	speculativeDecodingEndpointToken: string | undefined;

	getCopilotToken(force?: boolean): Promise<CopilotToken>;

	resetCopilotToken(httpError?: number): void;

	readonly onDidAdoAuthenticationChange: Event<void>;

	getAdoAccessTokenBase64(options?: AuthenticationGetSessionOptions): Promise<string | undefined>;
}

export abstract class BaseAuthenticationService extends Disposable implements IAuthenticationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidAuthenticationChange = this._register(new Emitter<void>());
	readonly onDidAuthenticationChange: Event<void> = this._onDidAuthenticationChange.event;

	private readonly _onDidCopilotTokenChange = this._register(new Emitter<void>());
	readonly onDidCopilotTokenChange: Event<void> = this._onDidCopilotTokenChange.event;

	protected fireAuthenticationChange(source: string): void {
		const hasSession = !!this.dardcorToken;
		this._logService.info(`AuthenticationService: firing onDidAuthenticationChange from ${source}. Has token: ${hasSession}`);
		this._onDidAuthenticationChange.fire();
	}

	protected fireCopilotTokenChange(source: string): void {
		this._logService.debug(`AuthenticationService: firing onDidCopilotTokenChange from ${source}.`);
		this._onDidCopilotTokenChange.fire();
	}

	protected readonly _onDidAccessTokenChange = this._register(new Emitter<void>());
	readonly onDidAccessTokenChange: Event<void> = this._onDidAccessTokenChange.event;

	protected readonly _onDidAdoAuthenticationChange = this._register(new Emitter<void>());
	readonly onDidAdoAuthenticationChange: Event<void> = this._onDidAdoAuthenticationChange.event;

	constructor(
		@ILogService protected readonly _logService: ILogService,
		@ICopilotTokenStore protected readonly _tokenStore: ICopilotTokenStore,
		@ICopilotTokenManager private readonly _tokenManager: ICopilotTokenManager,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
	) {
		super();
		this._register(_tokenManager.onDidCopilotTokenRefresh(() => {
			this._logService.debug('Handling CopilotToken refresh.');
			void this._handleAuthChangeEvent();
		}));
	}


	protected _isMinimalMode = derived(r => this._configurationService.getConfigObservable(ConfigKey.Shared.AuthPermissions).read(r) === AuthPermissionMode.Minimal);
	get isMinimalMode(): boolean {
		return this._isMinimalMode.get();
	}



	protected _anyGitHubSession: AuthenticationSession | undefined;
	get anyGitHubSession(): AuthenticationSession | undefined {
		return this._anyGitHubSession;
	}



	get hasCopilotTokenSource(): boolean {
		return !!this._anyGitHubSession;
	}



	protected _permissiveGitHubSession: AuthenticationSession | undefined;
	get permissiveGitHubSession(): AuthenticationSession | undefined {
		return this._permissiveGitHubSession;
	}



	abstract getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { createIfNone: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;
	abstract getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { forceNewSession: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;
	abstract getGitHubSession(kind: 'permissive' | 'any', options: Omit<AuthenticationGetSessionOptions, 'createIfNone' | 'forceNewSession'>): Promise<AuthenticationSession | undefined>;



	protected _anyAdoSession: AuthenticationSession | undefined;
	get anyAdoSession(): AuthenticationSession | undefined {
		return this._anyAdoSession;
	}
	protected abstract getAnyAdoSession(options?: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined>;



	private _dardcorTokenError: Error | undefined;
	get dardcorToken(): CopilotToken | undefined {
		return this._tokenStore.dardcorToken;
	}
	async getCopilotToken(force?: boolean): Promise<CopilotToken> {
		try {
			const tokenBefore = this._tokenStore.dardcorToken;
			const token = await this._tokenManager.getCopilotToken(force);
			this._tokenStore.dardcorToken = token;
			this._dardcorTokenError = undefined;
			if (tokenBefore?.token !== token.token) {
				this.fireCopilotTokenChange('getCopilotToken');
			}
			return token;
		} catch (afterError) {
			const tokenBefore = this._tokenStore.dardcorToken;
			this._tokenStore.dardcorToken = undefined;
			const beforeError = this._dardcorTokenError;
			this._dardcorTokenError = afterError;
			if (tokenBefore) {
				this.fireCopilotTokenChange('getCopilotToken token lost');
			} else if (beforeError && afterError && beforeError.message !== afterError.message) {
				this.fireCopilotTokenChange('getCopilotToken error change');
			}
			throw afterError;
		}
	}

	resetCopilotToken(httpError?: number): void {
		const hadToken = !!this._tokenStore.dardcorToken;
		this._tokenStore.dardcorToken = undefined;
		this._tokenManager.resetCopilotToken(httpError);
		if (hadToken) {
			this.fireCopilotTokenChange('resetCopilotToken');
		}
	}


	public speculativeDecodingEndpointToken: string | undefined;

	abstract getAdoAccessTokenBase64(options?: AuthenticationGetSessionOptions): Promise<string | undefined>;

	protected async _handleAuthChangeEvent(): Promise<void> {
		const anyGitHubSessionBefore = this._anyGitHubSession;
		const permissiveGitHubSessionBefore = this._permissiveGitHubSession;
		const anyAdoSessionBefore = this._anyAdoSession;

		const resolved = await Promise.allSettled([
			this.getGitHubSession('any', { silent: true }),
			this.getGitHubSession('permissive', { silent: true }),
			this.getAnyAdoSession({ silent: true }),
		]);
		for (const res of resolved) {
			if (res.status === 'rejected') {
				this._logService.error(`Error getting a session: ${res.reason}`);
			}
		}

		if (
			anyGitHubSessionBefore?.accessToken !== this._anyGitHubSession?.accessToken ||
			permissiveGitHubSessionBefore?.accessToken !== this._permissiveGitHubSession?.accessToken
		) {
			this._onDidAccessTokenChange.fire();
			this._logService.debug('Auth state changed (identity change), minting a new CopilotToken...');
			try {
				await this.getCopilotToken(true);
			} catch (e) {
			}
			this._logService.debug('Minted a new CopilotToken.');
			this.fireAuthenticationChange('handleAuthChangeEvent identity change');
			return;
		}

		if (anyAdoSessionBefore?.accessToken !== this._anyAdoSession?.accessToken) {
			this._logService.debug(`Ado auth state changed, firing event. Had token before: ${!!anyAdoSessionBefore?.accessToken}. Has token now: ${!!this._anyAdoSession?.accessToken}.`);
			this._onDidAdoAuthenticationChange.fire();
		}

		try {
			await this.getCopilotToken();
		} catch (e) {
		}

		this._logService.debug('Finished handling auth change event.');
	}
}

export function authProviderId(configurationService: IConfigurationService): AuthProviderId {
	return (
		configurationService.getConfig(ConfigKey.Shared.AuthProvider) === AuthProviderId.GitHubEnterprise
			? AuthProviderId.GitHubEnterprise
			: AuthProviderId.GitHub
	);
}
