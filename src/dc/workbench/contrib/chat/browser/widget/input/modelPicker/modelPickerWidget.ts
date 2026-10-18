/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/modelPicker.css';

import * as dom from '../../../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../../../base/browser/keyboardEvent.js';
import { renderIcon } from '../../../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { getBaseLayerHoverDelegate } from '../../../../../../../base/browser/ui/hover/hoverDelegate2.js';
import { getDefaultHoverDelegate } from '../../../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IStringDictionary } from '../../../../../../../base/common/collections.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { KeyCode } from '../../../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../../base/common/lifecycle.js';
import { disposableTimeout } from '../../../../../../../base/common/async.js';
import { autorun, IObservable } from '../../../../../../../base/common/observable.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { localize } from '../../../../../../../nls.js';
import { IActionListHeaderLink } from '../../../../../../../platform/actionWidget/browser/actionList.js';
import { IActionWidgetService } from '../../../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction } from '../../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { AgentHostAllowSignedOutWhenUsableSettingId } from '../../../../../../../platform/agentHost/common/agentService.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { IOpenerService } from '../../../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../../../platform/product/common/productService.js';
import { ITelemetryService } from '../../../../../../../platform/telemetry/common/telemetry.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';
import { TelemetryTrustedValue } from '../../../../../../../platform/telemetry/common/telemetryUtils.js';
import { DARD_COR_VENDOR_ID, getLanguageModelProviderDisplayName, IModelControlEntry, ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../../../../common/languageModels.js';
import { getLanguageModelDisplayNameWithSubscriptionSource } from '../../../../common/languageModelSourcePresentation.js';
import { IChatEntitlementService } from '../../../../../../services/chat/common/chatEntitlementService.js';
import { IModelPickerDelegate } from './modelPickerActionItem.js';
import { CHAT_SETUP_ACTION_ID } from '../../../actions/chatActions.js';
import { IUriIdentityService } from '../../../../../../../platform/uriIdentity/common/uriIdentity.js';
import { GitHubPaths, IDefaultAccountService } from '../../../../../../../platform/defaultAccount/common/defaultAccount.js';
import { IUpdateService } from '../../../../../../../platform/update/common/update.js';
import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../../../../platform/workspace/common/workspaceTrust.js';
import { getCompactCodicon } from '../../../chatIcons.js';
import { withChatInputPickerMotion } from '../chatInputPickerActionItem.js';
import { buildModelPickerItems, createManageModelsAction, getModelPickerAccessibilityProvider, getModelPickerControlModels, ModelPickerSection, shouldShowManageModelsAction } from './modelPickerItems.js';
import { ModelPickerConfiguration } from './modelPickerConfiguration.js';
import { getCompactModelPickerIcon } from './modelProviderIcons.js';
import { ITabbedModelPickerContext, TabbedModelPicker } from './modelPickerTabbedWidget.js';
import { getModelConfigSummary } from './modelPickerModelConfig.js';
import { logModelConfigurationChange } from './modelPickerTelemetry.js';
import { IModelPickerProviderPlaceholder } from './modelPickerTabs.js';
import { getModelPickerUnavailableReason, isAutoModel, ModelPickerUnavailableReason, shouldShowCacheBreakHint as computeShouldShowCacheBreakHint } from './modelPickerPresentation.js';

const CACHE_BREAK_HINT_DISMISSED_STORAGE_KEY = 'chat.cacheBreakHintDismissed';

export const TABBED_MODEL_PICKER_SETTING_ID = 'chat.experimentalModelPicker';

const MODEL_PICKER_MINIMUM_LABEL_WIDTH = 60;
const MODEL_PICKER_NAME_CHROME_WIDTH = 30;
const MODEL_PICKER_MINIMUM_NAME_WIDTH = MODEL_PICKER_MINIMUM_LABEL_WIDTH + MODEL_PICKER_NAME_CHROME_WIDTH;
const MODEL_PICKER_AUTO_NAME_WIDTH = 50;
const MODEL_PICKER_NO_MODEL_NAME_WIDTH = 140;
const MODEL_PICKER_COMPACT_NAME_WIDTH = 22;
type ChatModelChangeClassification = {
	owner: 'lramos15';
	comment: 'Reporting when the model picker is switched';
	fromModel?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The previous chat model' };
	toModel: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The new chat model' };
	chatSessionId?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The id of the current chat session, used to correlate the model switch with the session.' };
};

type ChatModelChangeEvent = {
	fromModel: string | TelemetryTrustedValue<string> | undefined;
	toModel: string | TelemetryTrustedValue<string>;
	chatSessionId?: string;
};

type ChatModelPickerInteraction = 'disabledModelContactAdminClicked' | 'premiumModelUpgradePlanClicked' | 'otherModelsExpanded' | 'otherModelsCollapsed';

type ChatModelPickerInteractionClassification = {
	owner: 'sandy081';
	comment: 'Reporting interactions in the chat model picker';
	interaction: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The model picker interaction that occurred' };
};

type ChatModelPickerInteractionEvent = {
	interaction: ChatModelPickerInteraction;
};

type ModelPickerBadge = 'info' | 'warning';

interface IModelPickerAvailability {
	readonly reason: ModelPickerUnavailableReason | undefined;
	readonly activating: boolean;
	readonly genericNoModels: boolean;
	readonly noModels: boolean;
}

export class ModelPickerWidget extends Disposable {

	private readonly _onDidChangeSelection = this._register(new Emitter<ILanguageModelChatMetadataAndIdentifier>());
	readonly onDidChangeSelection: Event<ILanguageModelChatMetadataAndIdentifier> = this._onDidChangeSelection.event;
	private readonly _onDidChangeMinimumWidth = this._register(new Emitter<number>());
	readonly onDidChangeMinimumWidth: Event<number> = this._onDidChangeMinimumWidth.event;

	private _selectedModel: ILanguageModelChatMetadataAndIdentifier | undefined;
	private _badge: ModelPickerBadge | undefined;
	private _compact: IObservable<boolean> | undefined;
	private _minimal: IObservable<boolean> | undefined;
	private _workspaceTrustInitialized = false;
	private _activatingAfterTrust = false;
	private readonly _activatingTimer = this._register(new MutableDisposable());

	private _domNode: HTMLElement | undefined;
	private _badgeIcon: HTMLElement | undefined;
	private _nameButton: HTMLElement | undefined;
	private _configButton: HTMLElement | undefined;
	private _minimumWidth = MODEL_PICKER_MINIMUM_NAME_WIDTH;
	private readonly _configuration: ModelPickerConfiguration;
	private readonly _tabbedPicker = this._register(new MutableDisposable<TabbedModelPicker>());
	private readonly _tabbedPickerHideListener = this._register(new MutableDisposable());

	get selectedModel(): ILanguageModelChatMetadataAndIdentifier | undefined {
		return this._selectedModel;
	}

	get domNode(): HTMLElement | undefined {
		return this._domNode;
	}

	get nameButton(): HTMLElement | undefined {
		return this._nameButton;
	}

	get minimumWidth(): number {
		return this._minimumWidth;
	}

	private _updateMinimumWidth(nameWidth: number): void {
		const minimumWidth = nameWidth + (this._configButton?.offsetWidth ?? 0);
		if (this._minimumWidth !== minimumWidth) {
			this._minimumWidth = minimumWidth;
			this._onDidChangeMinimumWidth.fire(minimumWidth);
		}
	}

	constructor(
		private readonly _delegate: IModelPickerDelegate,
		@IActionWidgetService private readonly _actionWidgetService: IActionWidgetService,
		@ICommandService private readonly _commandService: ICommandService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@IProductService private readonly _productService: IProductService,
		@IChatEntitlementService private readonly _entitlementService: IChatEntitlementService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
		@IDefaultAccountService private readonly _defaultAccountService: IDefaultAccountService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService private readonly _workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._configuration = this._instantiationService.createInstance(ModelPickerConfiguration, {
			getSelectedModel: () => this._selectedModel,
			getConfigurationAccess: () => this._delegate.modelConfiguration ?? this._languageModelsService,
			isDisabled: () => !!this._domNode?.classList.contains('disabled'),
			shouldShowCacheBreakHint: () => this.shouldShowCacheBreakHint( false),
			getCacheBreakLearnMoreLink: () => this.getCacheBreakLearnMoreLink(),
			dismissCacheBreakHint: () => this.dismissCacheBreakHint(),
		});
		this._register(this._languageModelsService.onDidChangeLanguageModels(() => {
			if (this._activatingAfterTrust && this._delegate.getModels().length > 0) {
				this._clearActivating();
			}
			this._renderLabel();
		}));

		this._register(this._workspaceTrustManagementService.onDidChangeTrust(trusted => {
			if (trusted && this._delegate.getPresentationOptions().showAutoModel && this._delegate.getModels().length === 0) {
				this._activatingAfterTrust = true;
				this._activatingTimer.value = disposableTimeout(() => {
					this._activatingAfterTrust = false;
					this._renderLabel();
				}, 15000);
			} else {
				this._clearActivating();
			}
			this._renderLabel();
		}));

		this._workspaceTrustManagementService.workspaceTrustInitialized.then(() => {
			if (this._store.isDisposed) {
				return;
			}
			this._workspaceTrustInitialized = true;
			this._renderLabel();
		});

		this._register(this._entitlementService.onDidChangeUsageBasedBilling(() => {
			this._renderLabel();
		}));

		this._register(this._entitlementService.onDidChangeEntitlement(() => this._renderLabel()));
		this._register(this._entitlementService.onDidChangeSentiment(() => this._renderLabel()));
		this._register(this._entitlementService.onDidChangeAnonymous(() => this._renderLabel()));

		// a change. The global service path is already covered above via
		if (this._delegate.modelConfiguration?.onDidChange) {
			this._register(this._delegate.modelConfiguration.onDidChange(() => {
				this._renderLabel();
			}));
		}

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TABBED_MODEL_PICKER_SETTING_ID)) {
				this._renderLabel();
			}
		}));
	}

	setCompact(compact: IObservable<boolean>): void {
		this._compact = compact;
		this._register(autorun(reader => {
			const isCompact = compact.read(reader);
			if (this._domNode) {
				this._domNode.classList.toggle('compact', isCompact);
			}
			this._renderLabel();
		}));
	}

	setMinimal(minimal: IObservable<boolean>): void {
		this._minimal = minimal;
		this._register(autorun(reader => {
			const isMinimal = minimal.read(reader);
			this._domNode?.classList.toggle('minimal', isMinimal);
			this._renderLabel();
		}));
	}

	setSelectedModel(model: ILanguageModelChatMetadataAndIdentifier | undefined): void {
		this._selectedModel = model;
		this._renderLabel();
	}

	setEnabled(enabled: boolean): void {
		if (this._domNode) {
			this._domNode.classList.toggle('disabled', !enabled);
			this._domNode.setAttribute('aria-disabled', String(!enabled));
		}
	}

	setBadge(badge: ModelPickerBadge | undefined): void {
		this._badge = badge;
		this._updateBadge();
	}

	private _unavailableReason(): ModelPickerUnavailableReason | undefined {
		return getModelPickerUnavailableReason({
			trustInitialized: this._workspaceTrustInitialized,
			trusted: this._workspaceTrustManagementService.isWorkspaceTrusted(),
			pickerModels: this._delegate.getModels(),
			liveModelIds: this._languageModelsService.getLanguageModelIds(),
			requiresSetup: this._requiresSetup(),
		});
	}

	private _requiresSetup(): boolean {
		return false;
	}

	isRestrictedMode(): boolean {
		return this._unavailableReason() === ModelPickerUnavailableReason.Restricted;
	}

	isSetupRequired(): boolean {
		return this._unavailableReason() === ModelPickerUnavailableReason.SetupRequired;
	}

	isNoModelConfigured(): boolean {
		const { reason, activating, genericNoModels } = this._availability();
		if (activating) {
			return false;
		}
		if (reason !== undefined) {
			return true;
		}
		const empty = this._delegate.getModels().length === 0;
		if (empty) {
			return true;
		}
		const selectedModel = this._selectedModel;
		if (!selectedModel) {
			return true;
		}
		if (isAutoModel(selectedModel)) {
			return empty || genericNoModels || !this._delegate.getPresentationOptions().showAutoModel;
		}
		const models = this._delegate.getModels();
		return !models.some(m => m.identifier === selectedModel.identifier);
	}

	private _clearActivating(): void {
		this._activatingAfterTrust = false;
		this._activatingTimer.clear();
	}

	private async _requestWorkspaceTrust(): Promise<void> {
		await this._workspaceTrustRequestService.requestWorkspaceTrust({
			message: localize('chat.modelPicker.trustMessage', "Trusting this workspace enables AI models and chat features.")
		});
	}

	private _requestSetup(): void {
		this._commandService.executeCommand(CHAT_SETUP_ACTION_ID);
	}

	render(container: HTMLElement): void {
		this._domNode = dom.append(container, dom.$('div.action-label.model-picker-split'));
		this._domNode.setAttribute('role', 'group');
		this._domNode.tabIndex = -1;

		if (this._compact?.get()) {
			this._domNode.classList.toggle('compact', true);
		}
		if (this._minimal?.get()) {
			this._domNode.classList.toggle('minimal', true);
		}

		this._nameButton = dom.append(this._domNode, dom.$('a.model-picker-section.model-picker-name'));
		this._nameButton.tabIndex = 0;
		this._nameButton.setAttribute('role', 'button');
		this._nameButton.setAttribute('aria-haspopup', 'true');
		this._nameButton.setAttribute('aria-expanded', 'false');

		this._configButton = dom.append(this._domNode, dom.$('a.model-picker-section.model-picker-config'));
		this._configButton.tabIndex = 0;
		this._configButton.setAttribute('role', 'button');
		this._configButton.setAttribute('aria-haspopup', 'true');
		this._configButton.setAttribute('aria-expanded', 'false');
		this._configButton.style.display = 'none';

		this._badgeIcon = dom.$('span.model-picker-badge');
		this._updateBadge();

		this._renderLabel();

		this._registerButtonAction(this._nameButton, () => this.show());
		this._registerButtonAction(this._configButton, () => this._configuration.show(this._configButton));

		this._register(getBaseLayerHoverDelegate().setupManagedHover(
			getDefaultHoverDelegate('mouse'),
			this._configButton,
			localize('chat.modelPicker.configTooltip', "Configure Model")
		));
	}

	private _registerButtonAction(element: HTMLElement, action: () => void): void {
		this._register(dom.addDisposableGenericMouseDownListener(element, e => {
			if (e.button !== 0) {
				return;
			}
			dom.EventHelper.stop(e, true);
			action();
		}));
		this._register(dom.addDisposableListener(element, dom.EventType.KEY_DOWN, (e) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				dom.EventHelper.stop(e, true);
				action();
			}
		}));
	}

	private getCacheBreakLearnMoreLink(): IActionListHeaderLink | undefined {
		const url = this._productService.defaultChatAgent?.optimizeUsageDocumentationUrl;
		return url ? { label: localize('chat.cacheBreak.learnMore', "Learn more"), uri: URI.parse(url) } : undefined;
	}

	private isCacheBreakHintDismissed(): boolean {
		return this._storageService.getBoolean(CACHE_BREAK_HINT_DISMISSED_STORAGE_KEY, StorageScope.APPLICATION, false);
	}

	private dismissCacheBreakHint(): void {
		this._storageService.store(CACHE_BREAK_HINT_DISMISSED_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.USER);
	}

	private _availability(): IModelPickerAvailability {
		const reason = this._unavailableReason();
		const empty = this._delegate.getModels().length === 0;
		const activating = reason === undefined && empty && this._activatingAfterTrust;
		const genericNoModels = reason === undefined && !activating && empty && !this._delegate.getPresentationOptions().showAutoModel;
		return { reason, activating, genericNoModels, noModels: reason !== undefined || activating || genericNoModels || empty };
	}

	private shouldShowCacheBreakHint(excludeAutoModel: boolean): boolean {
		return computeShouldShowCacheBreakHint({
			dismissed: this.isCacheBreakHintDismissed(),
			cacheWarm: this._delegate.isCacheWarm?.() ?? false,
			noModelsAvailable: this._availability().noModels,
			excludeAutoModel,
			selectedModelIsAuto: !!this._selectedModel && isAutoModel(this._selectedModel),
		});
	}

	isTabbedPickerEnabled(): boolean {
		return this._configurationService.getValue<boolean>(TABBED_MODEL_PICKER_SETTING_ID) === true;
	}

	private _providerPlaceholders(): IModelPickerProviderPlaceholder[] {
		if (!this.isSetupRequired()) {
			return [];
		}
		return [{
			vendor: DARD_COR_VENDOR_ID,
			label: getLanguageModelProviderDisplayName(this._languageModelsService, DARD_COR_VENDOR_ID),
			message: localize('chat.modelPicker.signInMessage', "Sign in to see available models."),
			action: { label: localize('chat.modelPicker.signIn', "Sign in"), run: () => this._requestSetup() },
		}];
	}

	private _showTabbedPicker(anchor: HTMLElement, context: ITabbedModelPickerContext): void {
		const picker = this._tabbedPicker.value ?? (this._tabbedPicker.value = this._instantiationService.createInstance(TabbedModelPicker));
		const previouslyFocusedElement = dom.getActiveElement();
		this._tabbedPickerHideListener.value = picker.onDidHide(() => {
			this._tabbedPickerHideListener.clear();
			this._nameButton?.setAttribute('aria-expanded', 'false');
			if (dom.isHTMLElement(previouslyFocusedElement)) {
				previouslyFocusedElement.focus();
			}
		});
		this._nameButton?.setAttribute('aria-expanded', 'true');
		picker.show(anchor, context);
	}

	show(anchor?: HTMLElement): void {
		const chatInputContainer = (this._domNode?.closest('.chat-input-container, .new-chat-input-area')
			?? anchor?.closest('.chat-input-container, .new-chat-input-area')
			?? this._domNode?.closest('.interactive-input-part')?.querySelector<HTMLElement>('.chat-input-container')
			?? this._domNode?.closest('.interactive-session')?.querySelector<HTMLElement>('.chat-input-container')) as HTMLElement | null;
		const anchorElement = chatInputContainer ?? anchor ?? this._domNode;
		if (!anchorElement || this._domNode?.classList.contains('disabled')) {
			return;
		}
		if (this._nameButton?.getAttribute('aria-expanded') === 'true') {
			if (this._tabbedPicker.value?.isVisible) {
				this._tabbedPicker.value.hide();
			} else {
				this._actionWidgetService.hide(true);
			}
			return;
		}

		const previousModel = this._selectedModel;

		const onSelect = (model: ILanguageModelChatMetadataAndIdentifier) => {
			this._telemetryService.publicLog2<ChatModelChangeEvent, ChatModelChangeClassification>('chat.modelChange', {
				fromModel: previousModel?.metadata.vendor === 'dardcor' ? new TelemetryTrustedValue(previousModel.identifier) : 'unknown',
				toModel: model.metadata.vendor === 'dardcor' ? new TelemetryTrustedValue(model.identifier) : 'unknown',
				chatSessionId: this._delegate.getChatSessionId?.()
			});
			this._selectedModel = model;
			this._renderLabel();
			this._onDidChangeSelection.fire(model);
		};

		const onConfigure = (model: ILanguageModelChatMetadataAndIdentifier, group: string) => {
			onSelect(model);
			this._actionWidgetService.hide();
			this._configuration.show(this._configButton, group);
		};

		const models = this._delegate.getModels();
		const presentation = this._delegate.getPresentationOptions();
		const manifest = this._languageModelsService.getModelsControlManifest();
		const controlModelsForTier: IStringDictionary<IModelControlEntry> = getModelPickerControlModels(manifest, this._entitlementService.entitlement, models);
		const canShowManageModelsAction = presentation.showManageModelsAction && shouldShowManageModelsAction(this._entitlementService);
		const manageModelsAction = canShowManageModelsAction ? createManageModelsAction(this._commandService) : undefined;
		const logModelPickerInteraction = (interaction: ChatModelPickerInteraction) => {
			this._telemetryService.publicLog2<ChatModelPickerInteractionEvent, ChatModelPickerInteractionClassification>('chat.modelPickerInteraction', { interaction });
		};
		const manageSettingsUrl = this._defaultAccountService.resolveGitHubUrl(GitHubPaths.copilotSettings);
		const onTogglePin = (modelIdentifier: string, pinned: boolean) => {
			if (pinned) {
				this._languageModelsService.pinModel(modelIdentifier);
			} else {
				this._languageModelsService.unpinModel(modelIdentifier);
			}
			this._actionWidgetService.hide();
			this.show(anchorElement);
		};

		const onLinkClick = (uri: URI) => {
			if (uri.scheme === 'command' && uri.path === 'workbench.action.chat.upgradePlan') {
				logModelPickerInteraction('premiumModelUpgradePlanClicked');
			} else if (manageSettingsUrl && this._uriIdentityService.extUri.isEqual(uri, URI.parse(manageSettingsUrl))) {
				logModelPickerInteraction('disabledModelContactAdminClicked');
			}
			void this._openerService.open(uri, { allowCommands: true });
		};

		const placeholders = this._providerPlaceholders();
		if (this.isTabbedPickerEnabled() && !this.isRestrictedMode() && (models.length > 0 || placeholders.length > 0)) {
			const showCacheBreakHint = this.shouldShowCacheBreakHint( true);
			this._showTabbedPicker(anchorElement, {
				models,
				selectedModelId: this._selectedModel?.identifier,
				recentModelIds: this._languageModelsService.getRecentlyUsedModelIds().filter(id => !this._languageModelsService.isModelHidden(id)),
				pinnedModelIds: this._languageModelsService.getPinnedModelIds().filter(id => !this._languageModelsService.isModelHidden(id)),
				controlModels: controlModelsForTier,
				configurationAccess: this._delegate.modelConfiguration ?? this._languageModelsService,
				isUBB: !!this._entitlementService.quotas.usageBasedBilling,
				showManageModels: !!manageModelsAction,
				providerPlaceholders: placeholders,
				unavailableContext: {
					show: presentation.showUnavailableFeatured,
					currentVSCodeVersion: this._productService.version,
					manageSettingsUrl,
					updateStateType: this._updateService.state.type,
				},
				onUnavailableLinkClick: onLinkClick,
				onSelect,
				onTogglePin,
				onManageModels: () => manageModelsAction?.run(),
				onConfigurationChanged: (model, group, key, fromValue, toValue) => logModelConfigurationChange(this._telemetryService, model, group, key, fromValue, toValue),
				cacheBreakHint: showCacheBreakHint ? {
					text: localize('chat.modelPicker.cacheBreakHint', "Switching models mid-session resets the prompt cache and may increase cost."),
					link: this.getCacheBreakLearnMoreLink(),
					dismiss: () => this.dismissCacheBreakHint(),
				} : undefined,
			});
			return;
		}

		const items = buildModelPickerItems({
			models,
			selectedModelId: this._selectedModel?.identifier,
			recentModelIds: this._languageModelsService.getRecentlyUsedModelIds().filter(id => !this._languageModelsService.isModelHidden(id)),
			pinnedModelIds: this._languageModelsService.getPinnedModelIds().filter(id => !this._languageModelsService.isModelHidden(id)),
			controlModels: controlModelsForTier,
			currentVSCodeVersion: this._productService.version,
			updateStateType: this._updateService.state.type,
			manageSettingsUrl,
			manageModelsAction,
			chatEntitlementService: this._entitlementService,
			languageModelsService: this._languageModelsService,
			openerService: this._openerService,
			presentation: {
				...presentation,
				restrictedMode: this.isRestrictedMode(),
				setupRequired: this.isSetupRequired(),
				showManageModelsInSetupRequired: this._configurationService.getValue<boolean>(AgentHostAllowSignedOutWhenUsableSettingId) === true,
				isUBB: !!this._entitlementService.quotas.usageBasedBilling,
			},
			actions: {
				onSelect,
				onTogglePin,
				onConfigure,
				onRequestTrust: () => { void this._requestWorkspaceTrust(); },
				onRequestSetup: () => { this._requestSetup(); },
			},
		});

		const hoverDisposables = new DisposableStore();
		for (const item of items) {
			if (item.hover?.disposable) {
				hoverDisposables.add(item.hover.disposable);
			}
		}

		const unavailable = this.isRestrictedMode() || this.isSetupRequired();
		const showCacheBreakHint = this.shouldShowCacheBreakHint( true);
		const chatInputWidth = chatInputContainer?.offsetWidth;
		const minWidth = chatInputWidth && chatInputWidth > 200 ? chatInputWidth : 200;
		const maxWidth = chatInputWidth && chatInputWidth > 200 ? chatInputWidth : undefined;
		const listOptions = withChatInputPickerMotion({
			className: 'chat-model-picker-dropdown',
			headerText: showCacheBreakHint ? localize('chat.modelPicker.cacheBreakHint', "Switching models mid-session resets the prompt cache and may increase cost.") : undefined,
			headerIcon: showCacheBreakHint ? Codicon.info : undefined,
			headerLink: showCacheBreakHint ? this.getCacheBreakLearnMoreLink() : undefined,
			headerDismiss: showCacheBreakHint ? () => this.dismissCacheBreakHint() : undefined,
			showFilter: !unavailable,
			filterPlaceholder: localize('chat.modelPicker.search', "Search models"),
			focusFilterOnOpen: true,
			filterAsCombobox: !unavailable,
			collapsedByDefault: new Set([ModelPickerSection.Other]),
			onDidToggleSection: (section: string, collapsed: boolean) => {
				if (section === ModelPickerSection.Other) {
					logModelPickerInteraction(collapsed ? 'otherModelsCollapsed' : 'otherModelsExpanded');
				}
			},
			linkHandler: onLinkClick,
			minWidth,
			maxWidth,
		});
		const previouslyFocusedElement = dom.getActiveElement();

		const delegate = {
			onSelect: (action: IActionWidgetDropdownAction) => {
				this._actionWidgetService.hide();
				action.run();
			},
			onHide: () => {
				hoverDisposables.dispose();
				this._nameButton?.setAttribute('aria-expanded', 'false');
				if (dom.isHTMLElement(previouslyFocusedElement)) {
					previouslyFocusedElement.focus();
				}
			}
		};

		this._nameButton?.setAttribute('aria-expanded', 'true');

		this._actionWidgetService.show(
			'ChatModelPicker',
			false,
			items,
			delegate,
			anchorElement,
			undefined,
			[],
			getModelPickerAccessibilityProvider(!unavailable),
			listOptions
		);
	}

	private _updateBadge(): void {
		if (this._badgeIcon) {
			if (this._badge) {
				const icon = this._badge === 'info' ? Codicon.info : Codicon.warningCompact;
				dom.reset(this._badgeIcon, renderIcon(icon));
				this._badgeIcon.style.display = '';
				this._badgeIcon.classList.toggle('info', this._badge === 'info');
				this._badgeIcon.classList.toggle('warning', this._badge === 'warning');
			} else {
				this._badgeIcon.style.display = 'none';
			}
		}
	}

	private _renderLabel(): void {
		if (!this._domNode || !this._nameButton) {
			return;
		}

		const selectedModel = this._selectedModel;
		const name = selectedModel
			? getLanguageModelDisplayNameWithSubscriptionSource(selectedModel)
			: undefined;

		const { reason, activating, noModels: noModelsAvailable } = this._availability();
		const restrictedMode = reason === ModelPickerUnavailableReason.Restricted;
		const setupRequired = reason === ModelPickerUnavailableReason.SetupRequired;
		const unavailable = reason !== undefined;

		const nameChildren: (HTMLElement | string)[] = [];
		const modelIcon = selectedModel
			? (this._delegate.getPresentationOptions().showModelIcon
				? getCompactModelPickerIcon(selectedModel)
				: selectedModel.metadata.statusIcon ? getCompactCodicon(selectedModel.metadata.statusIcon) : undefined)
			: undefined;
		const compact = this._compact?.get() ?? false;
		const minimal = this._minimal?.get() ?? false;
		if (modelIcon && !noModelsAvailable) {
			nameChildren.push(renderIcon(modelIcon));
		}
		const noModelConfigured = this.isNoModelConfigured();
		const modelLabel = activating
			? localize('chat.modelPicker.activating', "Activating...")
			: noModelConfigured
				? localize('chat.modelPicker.noModelConfigure', "No Model Configure")
				: (name ?? (selectedModel && isAutoModel(selectedModel) ? localize('chat.modelPicker.auto', "Auto") : localize('chat.modelPicker.noModelConfigure', "No Model Configure")));
		const configSummary = this.isTabbedPickerEnabled() && !unavailable && !minimal && selectedModel
			? getModelConfigSummary(selectedModel, this._delegate.modelConfiguration ?? this._languageModelsService)
			: undefined;
		const showModelLabel = !compact || !modelIcon || noModelsAvailable || noModelConfigured;
		const showingNoModel = !activating && noModelConfigured;
		const showingAuto = !activating && !noModelConfigured && (!selectedModel || isAutoModel(selectedModel));
		const nameMinimumWidth = compact && !showModelLabel
			? MODEL_PICKER_COMPACT_NAME_WIDTH
			: showingNoModel
				? MODEL_PICKER_NO_MODEL_NAME_WIDTH
				: showingAuto
					? MODEL_PICKER_AUTO_NAME_WIDTH
					: MODEL_PICKER_MINIMUM_NAME_WIDTH;
		this._nameButton.style.minWidth = `${nameMinimumWidth}px`;
		if (showModelLabel) {
			nameChildren.push(dom.$('span.chat-input-picker-label', undefined, modelLabel));
		}
		if (configSummary && showModelLabel) {
			nameChildren.push(dom.$('span.model-picker-config-summary', undefined, configSummary));
		}
		if (this._badgeIcon) {
			nameChildren.push(this._badgeIcon);
		}
		dom.reset(this._nameButton, ...nameChildren);

		if (this._configButton) {
			if (this.isTabbedPickerEnabled()) {
				this._configButton.style.display = 'none';
			} else {
				this._configuration.renderButton(this._configButton, minimal, noModelsAvailable);
			}
		}
		const configVisible = !!this._configButton && this._configButton.style.display !== 'none';
		this._domNode.classList.toggle('icon-only', !showModelLabel && !configVisible);

		const ariaLabel = restrictedMode
			? localize('chat.modelPicker.ariaLabelRestricted', "Models, {0}, unavailable while in Restricted mode", modelLabel)
			: setupRequired
				? localize('chat.modelPicker.ariaLabelSetupRequired', "Models, {0}, configuration required", modelLabel)
				: configSummary
					? localize('chat.modelPicker.ariaLabelConfigured', "Models, {0}, {1}", modelLabel, configSummary)
					: localize('chat.modelPicker.ariaLabel', "Models, {0}", modelLabel);
		this._domNode.ariaLabel = ariaLabel;
		this._nameButton.ariaLabel = ariaLabel;
		this._updateMinimumWidth(nameMinimumWidth);
	}

}
