/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { safeIntl } from '../../../../base/common/date.js';
import { createMarkdownCommandLink, MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchAssignmentService } from '../../../services/assignment/common/assignmentService.js';
import { ChatEntitlement, IChatEntitlementService, IQuotaSnapshot, IRateLimitSnapshot } from '../../../services/chat/common/chatEntitlementService.js';
import { getSelectedModelIdentifier, getSelectedModelMetadata, isSelectedModelDardcor, SELECTED_MODEL_STORAGE_KEY_PREFIX, SELECTED_MODEL_STORAGE_SCOPE } from '../common/chatSelectedModel.js';
import { ILanguageModelsService, isAutoLanguageModel } from '../common/languageModels.js';
import { ChatInputNotificationActionKind, ChatInputNotificationSeverity, IChatInputNotification, IChatInputNotificationService } from './widget/input/chatInputNotificationService.js';

const QUOTA_NOTIFICATION_ID = 'dardcor.quotaStatus';
const THRESHOLDS = [50, 75, 90, 95];
const SWITCH_TO_AUTO_TREATMENT_NAME = 'config.chatQuotaWarningSwitchToAuto';
const TRAJECTORY_NUDGE_SPEC = {
	treatmentName: 'config.chatQuotaTrajectoryNudge',
	shownStorageKey: 'chat.quotaTrajectory.shownPeriod',
	averageDailyUsageThreshold: 4.5,
	minimumPercentUsed: 10,
	maximumPercentUsed: 35,
	msPerDay: 24 * 60 * 60 * 1000,
	learnMoreUrl: 'https://aka.ms/token-usage-tips',
	learnMoreCommandId: 'workbench.action.chat.learnMoreAboutCreditUsage',
} as const;

type ChatQuotaTrajectoryNudgeLinkClickedClassification = {
	owner: 'rfeltis';
	comment: 'Tracks when users click the chat quota trajectory nudge learn more link.';
};

type ChatQuotaTrajectoryNudgeEnrollmentEvent = {
	treatment: boolean;
	entitlement: string;
	averageDailyUsage: number;
	percentUsed: number;
};

type ChatQuotaTrajectoryNudgeEnrollmentClassification = {
	owner: 'rfeltis';
	comment: 'Tracks when a user is assigned to a flight for the chat quota trajectory nudge experiment, to measure experiment exposure.';
	treatment: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The treatment value assigned by the experiment service (true for the treatment arm, false for control).' };
	entitlement: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The user entitlement when the user was assigned to the experiment flight.' };
	averageDailyUsage: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The average daily monthly quota usage percentage when the user was assigned to the experiment flight.' };
	percentUsed: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The monthly quota percentage used when the user was assigned to the experiment flight.' };
};

const QUOTA_EXHAUSTED_DISMISSED_STORAGE_KEY = 'chat.quotaNotification.exhaustedDismissed';

export class ChatQuotaNotificationContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatQuotaNotification';

	private _showingExhausted = false;

	private _prevQuotaPercentUsed: number | undefined;
	private _prevAdditionalUsageEnabled: boolean | undefined;
	private _prevSessionPercentUsed: number | undefined;
	private _prevWeeklyPercentUsed: number | undefined;
	private _switchToAutoTreatment: boolean | undefined;
	private _switchToAutoAssignmentRequested = false;
	private _activeQuotaWarning: { percentUsed: number; threshold: number } | undefined;
	private _trajectoryTreatment: boolean | undefined;
	private _trajectoryAssignmentRequested = false;

	constructor(
		@IChatEntitlementService private readonly _chatEntitlementService: IChatEntitlementService,
		@IChatInputNotificationService private readonly _chatInputNotificationService: IChatInputNotificationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkbenchAssignmentService private readonly _assignmentService: IWorkbenchAssignmentService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._chatEntitlementService.onDidChangeQuotaRemaining(() => this._update()));
		this._register(this._chatEntitlementService.onDidChangeQuotaExceeded(() => this._update()));
		this._register(this._chatEntitlementService.onDidChangeEntitlement(() => this._update()));
		this._register(this._languageModelsService.onDidChangeLanguageModels(() => this._refreshActiveQuotaApproachingWarning()));
		this._register(CommandsRegistry.registerCommand(TRAJECTORY_NUDGE_SPEC.learnMoreCommandId, (accessor: ServicesAccessor) => this._handleCreditEfficiencyLearnMoreCommand(accessor)));

		const storageListener = this._register(new DisposableStore());
		this._register(this._storageService.onDidChangeValue(SELECTED_MODEL_STORAGE_SCOPE, undefined, storageListener)(e => {
			if (e.key.startsWith(SELECTED_MODEL_STORAGE_KEY_PREFIX)) {
				this._refreshActiveQuotaApproachingWarning();
				this._update();
			}
		}));

		this._register(this._chatInputNotificationService.onDidDismiss(id => {
			if (id === QUOTA_NOTIFICATION_ID && this._showingExhausted) {
				this._setExhaustedDismissed();
			}
		}));

		this._update();
	}

	private async _resolveSwitchToAutoTreatment(): Promise<void> {
		const treatment = await this._assignmentService.getTreatment<boolean>(SWITCH_TO_AUTO_TREATMENT_NAME);
		this._switchToAutoTreatment = treatment;
		if (treatment === true) {
			this._refreshActiveQuotaApproachingWarning();
		}
	}

	private _requestSwitchToAutoTreatment(): void {
		if (!this._switchToAutoAssignmentRequested) {
			this._switchToAutoAssignmentRequested = true;
			void this._resolveSwitchToAutoTreatment().catch(error => {
				this._logService.error(`Failed to resolve ${SWITCH_TO_AUTO_TREATMENT_NAME}`, error);
				this._switchToAutoAssignmentRequested = false;
			});
		}
	}

	private async _resolveTrajectoryTreatment(warning: { averageDailyUsage: number; percentUsed: number }): Promise<void> {
		const treatment = await this._assignmentService.getTreatment<boolean>(TRAJECTORY_NUDGE_SPEC.treatmentName);
		this._trajectoryTreatment = treatment;
		if (treatment !== undefined) {
			this._logQuotaTrajectoryNudgeEnrolled(treatment, warning);
		}
		if (treatment === true) {
			this._update();
		}
	}

	private _requestTrajectoryTreatment(warning: { averageDailyUsage: number; percentUsed: number }): void {
		if (!this._trajectoryAssignmentRequested) {
			this._trajectoryAssignmentRequested = true;
			void this._resolveTrajectoryTreatment(warning).catch(error => {
				this._logService.error(`Failed to resolve ${TRAJECTORY_NUDGE_SPEC.treatmentName}`, error);
				this._trajectoryAssignmentRequested = false;
			});
		}
	}

	private _getRelevantSnapshot(): IQuotaSnapshot | undefined {
		const quotas = this._chatEntitlementService.quotas;
		const entitlement = this._chatEntitlementService.entitlement;
		if (entitlement === ChatEntitlement.Unknown || entitlement === ChatEntitlement.Free) {
			return quotas.chat ?? quotas.premiumChat;
		}
		return quotas.premiumChat;
	}

	private _isQuotaUsedUp(): boolean {
		const snapshot = this._getRelevantSnapshot();
		if (!snapshot) {
			return false;
		}
		if (snapshot.unlimited) {
			return snapshot.hasQuota === false;
		}
		return snapshot.percentRemaining <= 0;
	}

	private _isUBBEligible(): boolean {
		return this._chatEntitlementService.quotas.usageBasedBilling === true;
	}

	private _update(): void {
		const entitlement = this._chatEntitlementService.entitlement;
		const isDardcorModel = this._isDardcorModelSelected();

		if (this._isQuotaKnownAvailable()) {
			this._clearExhaustedDismissed();
		}

		if (!isDardcorModel) {
			return;
		}

		const isQuotaNotificationEligible = entitlement === ChatEntitlement.Unknown || this._isUBBEligible();

		if (this._isManagedPlan(entitlement) && this._isManagedPlanBlocked()) {
			if (!this._isExhaustedDismissed()) {
				this._showManagedPlanBlockedNotification();
			}
			return;
		}

		if (isQuotaNotificationEligible && this._isQuotaUsedUp()) {
			const quotas = this._chatEntitlementService.quotas;
			const additionalUsageEnabled = quotas.additionalUsageEnabled ?? false;
			const wasAdditionalUsageEnabled = this._prevAdditionalUsageEnabled;
			this._prevAdditionalUsageEnabled = additionalUsageEnabled;

			if (!this._isExhaustedDismissed()) {
				if (additionalUsageEnabled) {
					if (this._prevQuotaPercentUsed !== undefined || wasAdditionalUsageEnabled === false) {
						this._showOverageActivationNotification();
					}
				} else {
					this._showExhaustedNotification();
				}
			}

			const exhaustedSnapshot = this._getRelevantSnapshot();
			if (exhaustedSnapshot && !exhaustedSnapshot.unlimited) {
				this._prevQuotaPercentUsed = 100 - exhaustedSnapshot.percentRemaining;
			}

			return;
		}

		if (isQuotaNotificationEligible) {
			const trajectoryWarning = this._computeQuotaTrajectoryWarning();
			if (trajectoryWarning) {
				this._showQuotaTrajectoryWarning(trajectoryWarning);
				return;
			}

			const quotaWarning = this._computeQuotaWarning();
			if (quotaWarning) {
				this._showQuotaApproachingWarning(quotaWarning);
				return;
			}
		}

		const rateLimitWarning = this._computeRateLimitWarning();
		if (rateLimitWarning) {
			this._showRateLimitWarning(rateLimitWarning);
			return;
		}

		if (this._showingExhausted && !this._isQuotaUsedUp()) {
			this._hideNotification();
		}
	}


	private _computeQuotaWarning(): { percentUsed: number; threshold: number } | undefined {
		const snapshot = this._getRelevantSnapshot();
		if (!snapshot || snapshot.unlimited) {
			this._prevQuotaPercentUsed = undefined;
			return undefined;
		}
		const percentUsed = 100 - snapshot.percentRemaining;
		const crossed = this._findCrossedThreshold(percentUsed, this._prevQuotaPercentUsed);
		this._prevQuotaPercentUsed = percentUsed;
		if (crossed !== undefined) {
			return { percentUsed: Math.floor(percentUsed), threshold: crossed };
		}
		return undefined;
	}

	private _computeQuotaTrajectoryWarning(): { averageDailyUsage: number; percentUsed: number } | undefined {
		if (this._isTrajectoryShownInCurrentPeriod()) {
			return undefined;
		}

		const snapshot = this._getRelevantSnapshot();
		if (!snapshot || snapshot.unlimited || snapshot.percentRemaining <= 0) {
			return undefined;
		}

		const resetDate = this._chatEntitlementService.quotas.resetDate;
		if (!resetDate) {
			return undefined;
		}

		const reset = new Date(resetDate);
		const resetTime = reset.getTime();
		if (!Number.isFinite(resetTime)) {
			return undefined;
		}

		const periodStart = new Date(resetTime);
		periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);
		const periodStartTime = periodStart.getTime();
		const elapsedDays = (Date.now() - periodStartTime) / TRAJECTORY_NUDGE_SPEC.msPerDay;
		if (elapsedDays < 0) {
			return undefined;
		}

		const percentUsed = 100 - snapshot.percentRemaining;
		if (percentUsed < TRAJECTORY_NUDGE_SPEC.minimumPercentUsed || percentUsed > TRAJECTORY_NUDGE_SPEC.maximumPercentUsed) {
			return undefined;
		}

		const averageDailyUsage = percentUsed / Math.max(1, elapsedDays);
		if (averageDailyUsage < TRAJECTORY_NUDGE_SPEC.averageDailyUsageThreshold) {
			return undefined;
		}

		this._requestTrajectoryTreatment({ averageDailyUsage, percentUsed });
		return this._trajectoryTreatment === true ? { averageDailyUsage, percentUsed } : undefined;
	}

	private _showQuotaTrajectoryWarning(warning: { averageDailyUsage: number; percentUsed: number }): void {
		this._showingExhausted = false;
		this._storeTrajectoryShown();
		const learnMoreLink = createMarkdownCommandLink({
			text: localize('quota.trajectory.learnMoreStandalone', "Learn about optimizing usage"),
			id: TRAJECTORY_NUDGE_SPEC.learnMoreCommandId,
			tooltip: localize('quota.trajectory.learnMoreTooltip', "Learn about optimizing usage"),
		});
		const message = localize({ key: 'quota.trajectory.message', comment: ['{Locked="["}', '{Locked="]({0})"}'] }, "You're likely to exhaust your AI credits before your billing period. {0}.", learnMoreLink);

		this._setNotification({
			id: QUOTA_NOTIFICATION_ID,
			telemetryId: 'quotaTrajectoryNudge',
			severity: ChatInputNotificationSeverity.Info,
			message: new MarkdownString(message, { isTrusted: { enabledCommands: [TRAJECTORY_NUDGE_SPEC.learnMoreCommandId] } }),
			description: undefined,
			actions: [],
			dismissible: true,
			autoDismissOnMessage: false,
		});
	}

	private async _handleCreditEfficiencyLearnMoreCommand(accessor: ServicesAccessor): Promise<void> {
		this._telemetryService.publicLog2<{}, ChatQuotaTrajectoryNudgeLinkClickedClassification>('chatQuotaTrajectoryNudgeLinkClicked');
		queueMicrotask(() => this._hideNotification());
		await accessor.get(IOpenerService).open(URI.parse(TRAJECTORY_NUDGE_SPEC.learnMoreUrl));
	}

	private _logQuotaTrajectoryNudgeEnrolled(treatment: boolean, warning: { averageDailyUsage: number; percentUsed: number }): void {
		this._telemetryService.publicLog2<ChatQuotaTrajectoryNudgeEnrollmentEvent, ChatQuotaTrajectoryNudgeEnrollmentClassification>('chatQuotaTrajectoryNudgeEnrolled', {
			treatment,
			entitlement: ChatEntitlement[this._chatEntitlementService.entitlement],
			averageDailyUsage: Math.round(warning.averageDailyUsage * 100) / 100,
			percentUsed: Math.round(warning.percentUsed * 100) / 100,
		});
	}

	private _findCrossedThreshold(current: number, previous: number | undefined): number | undefined {
		if (previous === undefined) {
			return undefined;
		}
		for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
			const threshold = THRESHOLDS[i];
			if (previous < threshold && current >= threshold) {
				return threshold;
			}
		}
		return undefined;
	}


	private _showExhaustedNotification(): void {
		this._showingExhausted = true;

		const entitlement = this._chatEntitlementService.entitlement;
		const quotas = this._chatEntitlementService.quotas;
		const hadOverage = (quotas.additionalUsageCount ?? 0) > 0;

		let description: string;
		let actions: IChatInputNotification['actions'];

		if (entitlement === ChatEntitlement.Unknown) {
			description = localize('quota.exhausted.anonymous', "Sign in to keep going.");
			actions = [{ kind: ChatInputNotificationActionKind.Command, label: localize('signIn', "Sign In"), commandId: 'workbench.action.chat.triggerSetup' }];
		} else if (entitlement === ChatEntitlement.Free) {
			description = localize('quota.exhausted.free', "Upgrade to keep going.");
			actions = [{ kind: ChatInputNotificationActionKind.Command, label: localize('upgrade', "Upgrade"), commandId: 'workbench.action.chat.upgradePlan' }];
		} else if (this._isManagedPlan(entitlement)) {
			description = localize('quota.exhausted.managed', "Contact your admin to increase your limits.");
			actions = [];
		} else if (hadOverage) {
			description = localize('quota.exhausted.hadOverage', "Increase your budget to keep building.");
			actions = [{ kind: ChatInputNotificationActionKind.Command, label: localize('manageBudget', "Manage Budget"), commandId: 'workbench.action.chat.manageAdditionalSpend' }];
		} else {
			description = localize('quota.exhausted.default', "Manage your budget to keep building.");
			actions = [{ kind: ChatInputNotificationActionKind.Command, label: localize('manageBudget2', "Manage Budget"), commandId: 'workbench.action.chat.manageAdditionalSpend' }];
		}

		this._setNotification({
			id: QUOTA_NOTIFICATION_ID,
			telemetryId: 'quotaExhausted',
			severity: ChatInputNotificationSeverity.Info,
			message: localize('quota.exhausted.title', "Credit Limit Reached"),
			description,
			actions,
			dismissible: true,
			autoDismissOnMessage: true,
		});
	}


	private _showOverageActivationNotification(): void {
		this._showingExhausted = true;

		this._setNotification({
			id: QUOTA_NOTIFICATION_ID,
			telemetryId: 'overageActivation',
			severity: ChatInputNotificationSeverity.Info,
			message: localize('quota.overage.title', "Credit Limit Reached"),
			description: localize('quota.overage.desc', "Additional budget is now covering extra usage."),
			actions: [],
			dismissible: true,
			autoDismissOnMessage: true,
		});
	}


	private _showQuotaApproachingWarning(warning: { percentUsed: number; threshold: number }): void {
		this._showingExhausted = false;
		this._activeQuotaWarning = warning;

		const entitlement = this._chatEntitlementService.entitlement;
		const quotas = this._chatEntitlementService.quotas;

		let description: string;
		let actions: IChatInputNotification['actions'];

		if (entitlement === ChatEntitlement.Unknown || entitlement === ChatEntitlement.Free) {
			description = localize('quota.approaching.free', "Upgrade to continue past the limit.");
			actions = [{ kind: ChatInputNotificationActionKind.Command, label: localize('upgrade2', "Upgrade"), commandId: 'workbench.action.chat.upgradePlan' }];
		} else if (this._isManagedPlan(entitlement)) {
			description = localize('quota.approaching.managed', "Contact your admin to increase your limits.");
			actions = [];
		} else if (quotas.additionalUsageEnabled) {
			description = localize('quota.approaching.overageEnabled', "Additional budget is enabled to cover extra usage.");
			actions = [];
		} else {
			const autoModelIdentifier = this._getAutoModelIdentifier();
			const canSwitchToAuto = !!autoModelIdentifier && !this._isAutoModelSelected(autoModelIdentifier);
			if (canSwitchToAuto) {
				this._requestSwitchToAutoTreatment();
			}
			if (this._switchToAutoTreatment === true && canSwitchToAuto) {
				description = localize('quota.approaching.switchToAuto', "Switch to Auto to reduce credit usage.");
				actions = [{ kind: ChatInputNotificationActionKind.SwitchToModel, label: localize('switchToAuto', "Switch to Auto"), matchesModel: m => m.identifier === autoModelIdentifier }];
			} else {
				description = localize('quota.approaching.default', "Set additional budget to cover extra usage.");
				actions = [{ kind: ChatInputNotificationActionKind.Command, label: localize('manageBudget3', "Manage Budget"), commandId: 'workbench.action.chat.manageAdditionalSpend' }];
			}
		}

		this._setNotification({
			id: QUOTA_NOTIFICATION_ID,
			telemetryId: `quotaApproaching${warning.threshold}`,
			severity: ChatInputNotificationSeverity.Info,
			message: localize('quota.approaching.title', "Credits at {0}%", warning.percentUsed),
			description,
			actions,
			dismissible: true,
			autoDismissOnMessage: true,
		});
	}


	private _computeRateLimitWarning(): { percentUsed: number; type: 'session' | 'weekly'; resetDate: string | undefined } | undefined {
		const quotas = this._chatEntitlementService.quotas;

		const sessionResult = this._checkRateLimitCrossing(quotas.sessionRateLimit, this._prevSessionPercentUsed);
		this._prevSessionPercentUsed = sessionResult.newPrev;

		const weeklyResult = this._checkRateLimitCrossing(quotas.weeklyRateLimit, this._prevWeeklyPercentUsed);
		this._prevWeeklyPercentUsed = weeklyResult.newPrev;

		if (sessionResult.warning) {
			return { ...sessionResult.warning, type: 'session' };
		}
		if (weeklyResult.warning) {
			return { ...weeklyResult.warning, type: 'weekly' };
		}
		return undefined;
	}

	private _checkRateLimitCrossing(
		snapshot: IRateLimitSnapshot | undefined,
		prevPercentUsed: number | undefined,
	): { newPrev: number | undefined; warning?: { percentUsed: number; resetDate: string | undefined } } {
		if (!snapshot || snapshot.unlimited) {
			return { newPrev: undefined };
		}
		const percentUsed = 100 - snapshot.percentRemaining;
		const crossed = this._findCrossedThreshold(percentUsed, prevPercentUsed);
		return {
			newPrev: percentUsed,
			warning: crossed !== undefined
				? { percentUsed: Math.floor(percentUsed), resetDate: snapshot.resetDate }
				: undefined,
		};
	}

	private _showRateLimitWarning(warning: { percentUsed: number; type: 'session' | 'weekly'; resetDate: string | undefined }): void {
		this._showingExhausted = false;

		const message = warning.type === 'session'
			? localize('rateLimit.session', "You've used {0}% of your session rate limit.", warning.percentUsed)
			: localize('rateLimit.weekly', "You've used {0}% of your weekly rate limit.", warning.percentUsed);

		const description = warning.resetDate
			? localize('rateLimit.resets', "Resets on {0}.", this._formatResetDate(warning.resetDate))
			: undefined;

		this._setNotification({
			id: QUOTA_NOTIFICATION_ID,
			telemetryId: warning.type === 'session' ? 'sessionRateLimitWarning' : 'weeklyRateLimitWarning',
			severity: ChatInputNotificationSeverity.Info,
			message,
			description,
			actions: [],
			dismissible: true,
			autoDismissOnMessage: true,
		});
	}


	private _isDardcorModelSelected(): boolean {
		return isSelectedModelDardcor(this._contextKeyService, this._storageService, this._languageModelsService);
	}

	private _getAutoModelIdentifier(): string | undefined {
		for (const identifier of this._languageModelsService.getLanguageModelIds()) {
			const metadata = this._languageModelsService.lookupLanguageModel(identifier);
			if (metadata && isAutoLanguageModel({ identifier, metadata })) {
				return identifier;
			}
		}
		return undefined;
	}

	private _isAutoModelSelected(autoModelIdentifier: string): boolean {
		const identifier = getSelectedModelIdentifier(this._contextKeyService, this._storageService);
		const autoModel = this._languageModelsService.lookupLanguageModel(autoModelIdentifier);
		if (identifier === autoModelIdentifier || identifier === autoModel?.id) {
			return true;
		}
		const metadata = getSelectedModelMetadata(this._contextKeyService, this._storageService, this._languageModelsService);
		return !!metadata && isAutoLanguageModel({ identifier: identifier ?? '', metadata });
	}

	private _refreshActiveQuotaApproachingWarning(): void {
		const warning = this._activeQuotaWarning;
		if (!warning || !this._isDardcorModelSelected()) {
			return;
		}
		const notification = this._chatInputNotificationService.getActiveNotification(candidate => candidate.id === QUOTA_NOTIFICATION_ID);
		if (notification?.telemetryId === `quotaApproaching${warning.threshold}`) {
			this._showQuotaApproachingWarning(warning);
		}
	}

	private _isManagedPlan(entitlement: ChatEntitlement): boolean {
		return entitlement === ChatEntitlement.Business || entitlement === ChatEntitlement.Enterprise;
	}

	private _isManagedPlanBlocked(): boolean {
		const snapshot = this._chatEntitlementService.quotas.premiumChat;
		return !!snapshot && snapshot.hasQuota === false;
	}

	private _showManagedPlanBlockedNotification(): void {
		this._showingExhausted = true;

		this._setNotification({
			id: QUOTA_NOTIFICATION_ID,
			telemetryId: 'managedPlanBlocked',
			severity: ChatInputNotificationSeverity.Info,
			message: localize('quota.blocked.managed.title', "Usage Blocked"),
			description: localize('quota.blocked.managed', "Your organization or enterprise has exceeded its Dardcor budget. Contact your admin to resume usage."),
			actions: [],
			dismissible: true,
			autoDismissOnMessage: true,
		});
	}

	private _formatResetDate(isoDate: string): string {
		const resetDate = new Date(isoDate);
		const now = new Date();
		const includeYear = resetDate.getFullYear() !== now.getFullYear();
		return safeIntl.DateTimeFormat(undefined, includeYear
			? { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
			: { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }
		).value.format(resetDate);
	}

	private _getTrajectoryPeriodKey(): string | undefined {
		const resetDate = this._chatEntitlementService.quotas.resetDate;
		if (!resetDate) {
			return undefined;
		}
		const date = new Date(resetDate);
		if (!Number.isFinite(date.getTime())) {
			return undefined;
		}
		return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
	}

	private _isTrajectoryShownInCurrentPeriod(): boolean {
		const periodKey = this._getTrajectoryPeriodKey();
		return !!periodKey && this._storageService.get(TRAJECTORY_NUDGE_SPEC.shownStorageKey, StorageScope.APPLICATION) === periodKey;
	}

	private _storeTrajectoryShown(): void {
		const periodKey = this._getTrajectoryPeriodKey();
		if (periodKey) {
			this._storageService.store(TRAJECTORY_NUDGE_SPEC.shownStorageKey, periodKey, StorageScope.APPLICATION, StorageTarget.USER);
		}
	}

	private _setNotification(notification: IChatInputNotification): void {
		this._chatInputNotificationService.setNotification(notification);
	}

	private _hideNotification(): void {
		this._showingExhausted = false;
		this._chatInputNotificationService.deleteNotification(QUOTA_NOTIFICATION_ID);
	}


	private _isQuotaKnownAvailable(): boolean {
		return !!this._getRelevantSnapshot() && !this._isQuotaUsedUp();
	}

	private _isExhaustedDismissed(): boolean {
		return this._storageService.getBoolean(QUOTA_EXHAUSTED_DISMISSED_STORAGE_KEY, StorageScope.APPLICATION, false);
	}

	private _setExhaustedDismissed(): void {
		this._storageService.store(QUOTA_EXHAUSTED_DISMISSED_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private _clearExhaustedDismissed(): void {
		this._storageService.remove(QUOTA_EXHAUSTED_DISMISSED_STORAGE_KEY, StorageScope.APPLICATION);
	}
}
