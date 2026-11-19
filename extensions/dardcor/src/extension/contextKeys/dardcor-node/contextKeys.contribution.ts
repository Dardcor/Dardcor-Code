/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { commands, extensions } from 'vscode';
import { IAuthenticationService, MinimalModeError } from '../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IEnvService } from '../../../platform/env/common/envService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { autorun } from '../../../util/dardcor/base/common/observableInternal';
import { GHPR_EXTENSION_ID } from '../../common/constants';

const inactiveAccountStatusContextKeys = [
	'github.dardcor.offline',
	'github.dardcor.interactiveSession.individual.disabled',
	'github.dardcor.interactiveSession.individual.expired',
	'github.dardcor.interactiveSession.contactSupport',
	'github.dardcor.interactiveSession.enterprise.disabled',
	'github.dardcor.interactiveSession.invalidToken',
	'github.dardcor.interactiveSession.rateLimited',
	'github.dardcor.interactiveSession.gitHubLoginFailed',
];

const chatQuotaExceededContextKey = 'github.dardcor.chat.quotaExceeded';

const showLogViewContextKey = `github.dardcor.chat.showLogView`;
const debugReportFeedbackContextKey = 'github.dardcor.debugReportFeedback';

const previewFeaturesDisabledContextKey = 'github.dardcor.previewFeaturesDisabled';
const blackbirdExternalIndexingDisabledContextKey = 'github.dardcor.blackbirdExternalIndexingDisabled';

const clientByokEnabledContextKey = 'github.dardcor.clientByokEnabled';

const debugContextKey = 'github.dardcor.chat.debug';

const missingPermissiveSessionContextKey = 'github.dardcor.auth.missingPermissiveSession';

export const prExtensionInstalledContextKey = 'github.dardcor.prExtensionInstalled';

const sessionSearchEnabledContextKey = 'github.dardcor.sessionSearch.enabled';

export class ContextKeysContribution extends Disposable {

	private _showLogView = false;

	constructor(
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IEnvService private readonly _envService: IEnvService,
		@IExperimentationService private readonly _expService: IExperimentationService
	) {
		super();

		void this._updatePermissiveSessionContext().catch(console.error);
		void commands.executeCommand('setContext', clientByokEnabledContextKey, true);
		for (const contextKey of inactiveAccountStatusContextKeys) {
			void commands.executeCommand('setContext', contextKey, false);
		}
		void commands.executeCommand('setContext', chatQuotaExceededContextKey, false);
		void commands.executeCommand('setContext', previewFeaturesDisabledContextKey, false);
		void commands.executeCommand('setContext', blackbirdExternalIndexingDisabledContextKey, false);
		this._register(_authenticationService.onDidAuthenticationChange(async () => await this._onAuthenticationChange()));
		this._register(commands.registerCommand('github.dardcor.debug.showChatLogView', async () => {
			this._showLogView = true;
			await commands.executeCommand('setContext', showLogViewContextKey, true);
			await commands.executeCommand('dardcor-chat.focus');
		}));
		this._updateShowLogViewContext();
		this._updateDebugContext();
		this._updatePrExtensionInstalledContext();

		const debugReportFeedback = this._configService.getConfigObservable(ConfigKey.TeamInternal.DebugReportFeedback);
		this._register(autorun(reader => {
			commands.executeCommand('setContext', debugReportFeedbackContextKey, debugReportFeedback.read(reader));
		}));

		const sessionSearchEnabled = this._configService.getExperimentBasedConfigObservable(ConfigKey.LocalIndexEnabled, this._expService);
		this._register(autorun(reader => {
			commands.executeCommand('setContext', sessionSearchEnabledContextKey, sessionSearchEnabled.read(reader));
		}));

		this._register(extensions.onDidChange(() => {
			this._updatePrExtensionInstalledContext();
		}));
	}

	private _updateShowLogViewContext() {
		if (this._showLogView) {
			return;
		}

		this._showLogView = !this._envService.isProduction();
		if (this._showLogView) {
			commands.executeCommand('setContext', showLogViewContextKey, this._showLogView);
		}
	}

	private _updateDebugContext() {
		commands.executeCommand('setContext', debugContextKey, !this._envService.isProduction());
	}

	private _updatePrExtensionInstalledContext() {
		const isPrExtensionInstalled = !!extensions.getExtension(GHPR_EXTENSION_ID);
		commands.executeCommand('setContext', prExtensionInstalledContextKey, isPrExtensionInstalled);
	}

	private async _onAuthenticationChange() {
		await this._updatePermissiveSessionContext();
	}

	private async _updatePermissiveSessionContext() {
		let hasPermissiveSession = false;
		let missingPermissiveSession = false;
		if (!this._authenticationService.isMinimalMode) {
			try {
				hasPermissiveSession = !!(await this._authenticationService.getGitHubSession('permissive', { silent: true }));
			} catch (error) {
				if (!(error instanceof MinimalModeError)) {
					this._logService.trace(`[context keys] Failed to resolve permissive session: ${error instanceof Error ? error.message : String(error)}`);
					hasPermissiveSession = !!this._authenticationService.permissiveGitHubSession;
				}
			}
			missingPermissiveSession = !hasPermissiveSession;
		}
		commands.executeCommand('setContext', missingPermissiveSessionContextKey, missingPermissiveSession);
	}
}
