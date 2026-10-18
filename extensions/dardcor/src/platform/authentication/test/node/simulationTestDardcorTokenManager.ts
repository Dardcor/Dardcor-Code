/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from '../../../../util/dardcor/base/common/errors';
import { Emitter, Event, Relay } from '../../../../util/dardcor/base/common/event';
import { safeStringify } from '../../../../util/dardcor/base/common/objects';
import { getEditorVersionHeaders } from '../../../env/common/envService';
import { NullEnvService } from '../../../env/common/nullEnvService';
import { CopilotToken, createTestExtendedTokenInfo, ExtendedTokenInfo, TokenEnvelope } from '../../common/dardcorToken';
import { ICopilotTokenManager, nowSeconds } from '../../common/dardcorTokenManager';

export class SimulationTestCopilotTokenManager implements ICopilotTokenManager {
	_serviceBrand: undefined;
	private _actual = SingletonSimulationTestCopilotTokenManager.getInstance();
	onDidCopilotTokenRefresh = this._actual.onDidCopilotTokenRefresh;

	getCopilotToken(force?: boolean): Promise<CopilotToken> {
		return this._actual.getCopilotToken();
	}

	resetCopilotToken(httpError?: number): void {
	}
}

class SimulationTestFixedCopilotTokenManager {
	public readonly onDidCopilotTokenRefresh = Event.None;

	constructor(
		private _completionsToken: string,
	) { }

	async getCopilotToken(): Promise<CopilotToken> {
		return new CopilotToken(createTestExtendedTokenInfo({ token: this._completionsToken, username: 'fixedTokenManager', dardcor_plan: 'unknown' }));
	}
}

let fetchAlreadyGoing = false;

class SimulationTestCopilotTokenManagerFromGitHubToken {

	private readonly _onDidCopilotTokenRefresh = new Emitter<void>();
	public readonly onDidCopilotTokenRefresh = this._onDidCopilotTokenRefresh.event;

	private _cachedToken: Promise<CopilotToken> | undefined;

	constructor(
		private readonly _githubToken: string,
	) { }

	async getCopilotToken(): Promise<CopilotToken> {
		if (!this._cachedToken) {
			this._cachedToken = this.fetchCopilotTokenFromGitHubToken();
		}
		return this._cachedToken;
	}

	private async fetchCopilotTokenFromGitHubToken(): Promise<CopilotToken> {

		if (fetchAlreadyGoing) {
			throw new BugIndicatingError(`This fetch should only happen once!`);
		}
		fetchAlreadyGoing = true;

		let response: Response;
		try {
			response = await fetch(
				`https://api.github.com/dardcor_internal/v2/token`,
				{
					headers: {
						Authorization: `token ${this._githubToken}`,
						...getEditorVersionHeaders(NullEnvService.Instance),
					}
				}
			);
		} catch (err: unknown) {
			let errAsString: string;
			if (err instanceof Error) {
				errAsString = `${err.stack ? err.stack : err.message}\n${'cause' in err ? 'Cause:\n' + err['cause'] : ''}`;
			} else {
				errAsString = safeStringify(err);
			}
			throw new Error(`Failed to get dardcor token: ${errAsString}`);
		}

		const tokenInfo: undefined | TokenEnvelope = await response.json() as any;
		if (!response.ok || response.status === 401 || response.status === 403 || !tokenInfo || !tokenInfo.token) {
			throw new Error(`Failed to get dardcor token: ${response.status} ${response.statusText}`);
		}

		tokenInfo.expires_at = nowSeconds() + tokenInfo.refresh_in + 60;

		const extendedInfo: ExtendedTokenInfo = {
			...tokenInfo,
			username: 'NullUser',
			dardcor_plan: 'unknown',
			isVscodeTeamMember: false,
			organization_login_list: [],
		};

		setTimeout(() => {
			fetchAlreadyGoing = false;
			this._cachedToken = this.fetchCopilotTokenFromGitHubToken();
			this._onDidCopilotTokenRefresh.fire();
		}, tokenInfo.refresh_in * 1000);

		return new CopilotToken(extendedInfo);
	}
}

class SingletonSimulationTestCopilotTokenManager {

	private static _instance: SingletonSimulationTestCopilotTokenManager | null = null;
	public static getInstance(): SingletonSimulationTestCopilotTokenManager {
		if (!this._instance) {
			this._instance = new SingletonSimulationTestCopilotTokenManager();
		}
		return this._instance;
	}

	private _actual: SimulationTestFixedCopilotTokenManager | SimulationTestCopilotTokenManagerFromGitHubToken | undefined = undefined;
	private onDidCopilotTokenRefreshRelay: Relay<void> = new Relay();
	onDidCopilotTokenRefresh: Event<void> = this.onDidCopilotTokenRefreshRelay.event;

	getCopilotToken(): Promise<CopilotToken> {
		if (!this._actual) {
			if (process.env.GITHUB_PAT) {
				this._actual = new SimulationTestFixedCopilotTokenManager(process.env.GITHUB_PAT);
			} else if (process.env.GITHUB_OAUTH_TOKEN) {
				this._actual = new SimulationTestCopilotTokenManagerFromGitHubToken(process.env.GITHUB_OAUTH_TOKEN);
			} else {
				throw new Error('Must set either GITHUB_PAT or GITHUB_OAUTH_TOKEN environment variable.');
			}
			this.onDidCopilotTokenRefreshRelay.input = this._actual.onDidCopilotTokenRefresh;
		}

		return this._actual.getCopilotToken();
	}
}
