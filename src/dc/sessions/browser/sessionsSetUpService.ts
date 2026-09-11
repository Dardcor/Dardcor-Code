/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../base/common/cancellation.js';
import { IObservable, runOnChange } from '../../base/common/observable.js';
import { DeferredPromise } from '../../base/common/async.js';
import { createDecorator, IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { IUserDataProfileStorageService } from '../../platform/userDataProfile/common/userDataProfileStorageService.js';
import { IUserDataProfilesService } from '../../platform/userDataProfile/common/userDataProfile.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { ChatEntitlementContext, IChatEntitlementService } from '../../workbench/services/chat/common/chatEntitlementService.js';
import { GitHubPaths, IDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { IWorkbenchLayoutService } from '../../workbench/services/layout/browser/layoutService.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
import { IHostService } from '../../workbench/services/host/browser/host.js';
import { IMarkdownRendererService } from '../../platform/markdown/browser/markdownRenderer.js';
import { WELCOME_COMPLETE_KEY } from '../common/welcome.js';
import { SessionsWelcomeVisibleContext } from '../common/contextkeys.js';
import { ConditionalAuthState, conditionalAuthState, observeAllowSignedOutWhenUsable, resolveSignedOutWindowGate, SignedOutWindowGate } from './sessionsAuthGate.js';

import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { Codicon } from '../../base/common/codicons.js';
import { $ } from '../../base/browser/dom.js';
import { Dialog, DialogContentsAlignment } from '../../base/browser/ui/dialog/dialog.js';
import { createWorkbenchDialogOptions } from '../../workbench/browser/parts/dialogs/dialog.js';
import { MarkdownString } from '../../base/common/htmlContent.js';
import { localize } from '../../nls.js';

import { ISessionsManagementService } from '../services/sessions/common/sessionsManagement.js';

const AIDisabledConfig = 'chat.disableAIFeatures';

export const ISessionsSetUpService = createDecorator<ISessionsSetUpService>('sessionsSetUpService');

export interface ISessionsSetUpService {
	readonly _serviceBrand: undefined;
	readonly initialSignInDialogShown: boolean;
	/**
	 * Resolves when the welcome/setup flow has completed (or immediately
	 * if it is not currently active). Use this to defer work until after
	 * the user has finished the initial sign-in or setup dialog.
	 */
	whenWelcomeDone(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal welcome widget — owns all the welcome UI logic.
// Receives service callbacks as constructor params to avoid circular injection.
// ---------------------------------------------------------------------------

export function shouldSkipSessionsWelcome(environmentService: IWorkbenchEnvironmentService): boolean {
	if (environmentService.enableSmokeTestDriver) {
		return true;
	}
	const envArgs = (environmentService as IWorkbenchEnvironmentService & { args?: Record<string, unknown> }).args;
	if (envArgs?.['skip-sessions-welcome']) {
		return true;
	}
	return typeof globalThis.location !== 'undefined' && new URLSearchParams(globalThis.location.search).has('skip-sessions-welcome');
}

class SessionsSetUpWidget extends Disposable {

	private readonly dialogRef = this._register(new MutableDisposable<DisposableStore>());
	private readonly watcherRef = this._register(new MutableDisposable());
	private readonly signInSetupCancellation = this._register(new MutableDisposable<CancellationTokenSource>());
	private _initialSetupFlow = true;
	/** True while the window is open for a signed-out user via the conditional-auth opt-in. */
	private _proceedingSignedOut = false;
	/**
	 * Set once the initial default-account resolution has completed. Until then
	 * the synchronous {@link IDefaultAccountService.currentDefaultAccount} snapshot
	 * is `null` even for a signed-in user, so a `null` reading means "not known
	 * yet", not "signed out". The conditional-auth reaction stays inert until this
	 * flips, otherwise it forces a sign-in modal on a signed-in user during the
	 * startup gap — one nothing can retire, since the account resolves silently.
	 */
	private _accountResolved = false;
	private _waitingForSessionTypes = false;
	/** Whether the window may proceed without GitHub sign-in. */
	private readonly _allowSignedOutWhenUsable: IObservable<boolean>;

	// Non-service params must come before @-decorated service params
	constructor(
		private readonly onCompleted: () => void,
		_serviceWhenSetupDone: () => Promise<boolean>,
		private readonly serviceMarkDone: () => void,
		_onInitialSignInDialogShown: () => void,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchEnvironmentService _environmentService: IWorkbenchEnvironmentService,
		@IAuthenticationService _authenticationService: IAuthenticationService,
		@ILogService private readonly logService: ILogService,
		@ICommandService _commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IHostService private readonly hostService: IHostService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IInstantiationService _instantiationService: IInstantiationService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
	) {
		super();
		void this._checkWebAuth;
		void this._watchWebAuth;
		void this._watchSignInState;
		void this._showSignInDialog;
		void this._showWelcomeDialog;
		this._allowSignedOutWhenUsable = observeAllowSignedOutWhenUsable(this.configurationService);
		this._register(runOnChange(this._allowSignedOutWhenUsable, () => this._onAllowSignedOutWhenUsableChanged()));
		this._register(this.sessionsManagementService.onDidChangeSessionTypes(() => this._onSessionTypesChanged()));
		this._start();
	}

	private _onSessionTypesChanged(): void {
		const signedIn = this.defaultAccountService.currentDefaultAccount !== null;
		if (conditionalAuthState(this._accountResolved, signedIn) === ConditionalAuthState.SignedOut) {
			this._reevaluateSignedOut();
		}
	}

	/**
	 * The opt-in was toggled while the window is open. Ignored until the account
	 * has resolved (see {@link _accountResolved}) and for signed-in users. For a
	 * signed-out user, turning it on retires an already-open sign-in modal (it was
	 * raised before the account resolved); turning it off falls back to demanding
	 * sign-in.
	 */
	private _onAllowSignedOutWhenUsableChanged(): void {
		// Only act once the account has resolved AND the user is signed out; while
		// unresolved or signed in, the sign-in watch owns the decision.
		const signedIn = this.defaultAccountService.currentDefaultAccount !== null;
		if (conditionalAuthState(this._accountResolved, signedIn) !== ConditionalAuthState.SignedOut) {
			return;
		}
		this._reevaluateSignedOut();
	}

	private _start(): void {
		this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.serviceMarkDone();
		void this._proceedWithoutGitHub();
	}

	private async _checkWebAuth(): Promise<void> {
		this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.onCompleted();
	}

	private _watchWebAuth(): void {
		// No sign-in dialog
	}

	private async _watchSignInState(): Promise<void> {
		this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.serviceMarkDone();
		await this._proceedWithoutGitHub();
	}

	private _watchActiveState(signedIn: boolean): IDisposable {
		const disposables = new DisposableStore();

		disposables.add(this.defaultAccountService.onDidChangeDefaultAccount(account => {
			const nowSignedIn = account !== null;
			if (signedIn && !nowSignedIn) {
				// Signed out: drop the completion marker and re-consult the gate.
				this.storageService.remove(WELCOME_COMPLETE_KEY, StorageScope.APPLICATION);
				this._reevaluateSignedOut();
			} else if (!signedIn && nowSignedIn) {
				// Signed in while running signed-out: the window is already open.
				this._proceedingSignedOut = false;
			}
			signedIn = nowSignedIn;
		}));

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AIDisabledConfig)) {
				if (this.configurationService.getValue<boolean>(AIDisabledConfig)) {
					this._showAIDisabledDialog();
				} else {
					// AI features re-enabled — dismiss any AI disabled dialog
					this.dialogRef.clear();
				}
			}
		}));

		return disposables;
	}

	/**
	 * Resolve the window-level signed-out gate from the opt-in and the live auth
	 * requirement of every advertised session type.
	 */
	private _signedOutWindowGate(): SignedOutWindowGate {
		return resolveSignedOutWindowGate(
			this._allowSignedOutWhenUsable.get(),
			this.sessionsManagementService.getAllProviderSessionTypes().map(({ sessionType }) => sessionType.authRequirement),
		);
	}

	/**
	 * Re-run the signed-out decision after an input change: force GitHub sign-in
	 * when the gate demands it, otherwise open the window without GitHub. A no-op
	 * while a dialog is up — that dialog owns the next transition.
	 */
	private _reevaluateSignedOut(): void {
		if (this._initialSetupFlow) {
			return;
		}
		if (this._proceedingSignedOut && this._allowSignedOutWhenUsable.get()) {
			return;
		}
		const gate = this._signedOutWindowGate();
		if (gate === SignedOutWindowGate.Unresolved) {
			this._waitingForSessionTypes = true;
			return;
		}
		if (this._waitingForSessionTypes) {
			this._waitingForSessionTypes = false;
			this.dialogRef.clear();
		}
		if (gate === SignedOutWindowGate.ForceGitHubSignIn) {
			if (this.dialogRef.value) {
				return;
			}
			this._proceedingSignedOut = false;
			void this._showWelcome(false);
		} else {
			this.signInSetupCancellation.value?.cancel();
			this.dialogRef.clear();
			void this._proceedWithoutGitHub();
		}
	}

	/**
	 * Open the Agents window for a signed-out user because the opt-in permits it.
	 * Mirrors the signed-in completion path and remains active until sign-in or the
	 * opt-in changes. Idempotent while already proceeding.
	 */
	private async _proceedWithoutGitHub(): Promise<void> {
		if (this._proceedingSignedOut) {
			return;
		}
		this._proceedingSignedOut = true;
		this.logService.info('[sessions welcome] Proceeding without GitHub sign-in; signed-out operation is enabled');
		await this._ensureAIFeaturesEnabled();
		if (this._store.isDisposed) {
			return;
		}
		this.onCompleted();
		this.watcherRef.value = this._watchActiveState(false);
	}

	private async _ensureAIFeaturesEnabled(): Promise<void> {
		if (this.configurationService.getValue<boolean>(AIDisabledConfig)) {
			this.logService.info('[sessions welcome] AI features disabled, enabling');
			await this.configurationService.updateValue(AIDisabledConfig, false);
		}
	}

	private async _showAIDisabledDialog(): Promise<void> {
		if (this.dialogRef.value) {
			return;
		}

		this.logService.info('[sessions welcome] AI features disabled, showing enable dialog');

		const disposables = new DisposableStore();
		this.dialogRef.value = disposables;

		const welcomeVisibleKey = SessionsWelcomeVisibleContext.bindTo(this.contextKeyService);
		welcomeVisibleKey.set(true);
		disposables.add(toDisposable(() => welcomeVisibleKey.reset()));

		const dialog = disposables.add(new Dialog(
			this.layoutService.activeContainer,
			'',
			[localize('sessions.aiDisabled.enable', "Enable AI Features")],
			createWorkbenchDialogOptions({
				type: 'none',
				extraClasses: ['chat-setup-dialog', 'sessions-welcome-dialog'],
				detail: localize('sessions.aiDisabled.detail', "Enable AI features to continue using Agents."),
				icon: Codicon.agent,
				alignment: DialogContentsAlignment.Vertical,
				cancelId: 1,
				disableCloseButton: true,
				disableCloseAction: true,
			}, this.keybindingService, this.layoutService, this.hostService)
		));

		const { button } = await dialog.show();
		disposables.dispose();
		this.dialogRef.clear();

		if (button === 0) {
			this.logService.info('[sessions welcome] User chose to enable AI features');
			await this.configurationService.updateValue(AIDisabledConfig, false);
		}
	}

	private async _showWelcome(_isFirstLaunch: boolean): Promise<void> {
		this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.serviceMarkDone();
		await this._proceedWithoutGitHub();
	}

	private async _showSignInDialog(_allowContinueWithoutSignIn = false): Promise<boolean> {
		return true;
	}

	private async _showWelcomeDialog(): Promise<void> {
		this.logService.info('[sessions welcome] Showing welcome dialog');

		const disposables = new DisposableStore();
		const productName = localize('walkthrough.productName', "{0} - Agents", this.productService.nameLong);

		const dialog = disposables.add(new Dialog(
			this.layoutService.activeContainer,
			localize('sessions.welcome.title', "Welcome to {0}", productName),
			[localize('sessions.welcome.getStarted', "Get Started")],
			createWorkbenchDialogOptions({
				type: 'none',
				extraClasses: ['chat-setup-dialog', 'sessions-welcome-dialog', 'sessions-main-welcome-dialog'],
				detail: localize('sessions.welcome.detail', "Your AI-powered coding experience where agents explore, build, and iterate with you."),
				icon: Codicon.agent,
				alignment: DialogContentsAlignment.Vertical,
				cancelId: 1,
				disableCloseButton: true,
				renderFooter: footer => footer.appendChild(this._createWelcomeFooter(disposables)),
			}, this.keybindingService, this.layoutService, this.hostService)
		));

		await dialog.show();
		disposables.dispose();

		this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.serviceMarkDone();
	}

	private _createWelcomeFooter(disposables: DisposableStore): HTMLElement {
		const element = $('.chat-setup-dialog-footer');
		const defaultChatAgent = this.productService.defaultChatAgent;
		const providerName = defaultChatAgent?.provider?.default?.name ?? 'GitHub';
		const termsUrl = defaultChatAgent?.termsStatementUrl ?? '';
		const privacyUrl = defaultChatAgent?.privacyStatementUrl ?? '';
		const publicCodeUrl = defaultChatAgent?.publicCodeMatchesUrl ?? '';
		const settingsUrl = this.defaultAccountService.resolveGitHubUrl(GitHubPaths.copilotSettings);

		const footer = localize(
			{ key: 'welcomeFooter', comment: ['{Locked="["}', '{Locked="]({1})"}', '{Locked="]({2})"}', '{Locked="]({4})"}', '{Locked="]({5})"}'] },
			"By continuing, you agree to {0}'s [Terms]({1}) and [Privacy Statement]({2}). {3} Copilot may show [public code]({4}) suggestions and use your data to improve the product. You can change these [settings]({5}) anytime.",
			providerName, termsUrl, privacyUrl, providerName, publicCodeUrl, settingsUrl
		);
		element.appendChild($('p', undefined, disposables.add(this.markdownRendererService.render(new MarkdownString(footer, { isTrusted: true }))).element));

		return element;
	}
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SessionsSetUpService extends Disposable implements ISessionsSetUpService {

	declare readonly _serviceBrand: undefined;

	private readonly _initPromise: Promise<void>;
	private readonly _welcomeDoneDeferred = new DeferredPromise<void>();
	private _initialSignInDialogShown = false;

	get initialSignInDialogShown(): boolean {
		return this._initialSignInDialogShown;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUserDataProfileStorageService private readonly userDataProfileStorageService: IUserDataProfileStorageService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._initPromise = this.initialize();

		this._register(this.instantiationService.createInstance(
			SessionsSetUpWidget,
			() => this._welcomeDoneDeferred.complete(),
			() => this.whenSetupDone(),
			() => this.markDone(),
			() => this._initialSignInDialogShown = true
		));
	}

	private async whenSetupDone(): Promise<boolean> {
		await this._initPromise;
		return this.chatEntitlementService.sentiment.completed === true;
	}

	private markDone(): void {
		this.chatEntitlementService.markSetupCompleted();
	}

	whenWelcomeDone(): Promise<void> {
		return this._welcomeDoneDeferred.p;
	}

	private async initialize(): Promise<void> {
		if (this.chatEntitlementService.sentiment.completed) {
			return;
		}

		try {
			const defaultProfile = this.userDataProfilesService.defaultProfile;
			await this.userDataProfileStorageService.withProfileScopedStorageService(defaultProfile, async storageService => {
				const defaultContext = this.instantiationService
					.createChild(new ServiceCollection([IStorageService, storageService]))
					.createInstance(ChatEntitlementContext);
				try {
					if (defaultContext.state.completed) {
						this.logService.info('[sessions welcome] Setup already completed in default profile, marking done locally');
						this.markDone();
					}
				} finally {
					defaultContext.dispose();
				}
			});
		} catch (error) {
			this.logService.error('[sessions welcome] Failed to read setup state from default profile:', error);
		}
	}
}
