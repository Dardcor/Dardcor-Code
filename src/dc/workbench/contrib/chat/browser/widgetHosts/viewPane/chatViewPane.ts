/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatViewPane.css';
import { $, addDisposableListener, append, EventHelper, EventType, getWindow } from '../../../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../../../base/browser/mouseEvent.js';

import { DomScrollableElement } from '../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../../base/common/errors.js';
import { Event } from '../../../../../../base/common/event.js';
import { MutableDisposable, toDisposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { LRUCache } from '../../../../../../base/common/map.js';
import { MarshalledId } from '../../../../../../base/common/marshallingIds.js';
import { autorun, IObservable, IReader, observableFromEvent, observableValue } from '../../../../../../base/common/observable.js';
import { getComparisonKey, isEqual } from '../../../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';

import { MenuId } from '../../../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { editorBackground } from '../../../../../../platform/theme/common/colorRegistry.js';
import { ChatViewTitleControl } from './chatViewTitleControl.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { isDark } from '../../../../../../platform/theme/common/theme.js';
import { IAccessibilityService } from '../../../../../../platform/accessibility/common/accessibility.js';
import { IViewPaneOptions, ViewPane } from '../../../../../browser/parts/views/viewPane.js';
import { Memento } from '../../../../../common/memento.js';
import { SIDE_BAR_FOREGROUND } from '../../../../../common/theme.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../../../common/views.js';
import { ILifecycleService, StartupKind } from '../../../../../services/lifecycle/common/lifecycle.js';
import { IChatViewTitleActionContext } from '../../../common/actions/chatActions.js';
import { IChatAgentService } from '../../../common/participants/chatAgents.js';
import { ChatContextKeys } from '../../../common/actions/chatContextKeys.js';
import { IChatModel, IChatModelInputState } from '../../../common/model/chatModel.js';
import { CHAT_PROVIDER_ID } from '../../../common/participants/chatParticipantContribTypes.js';
import { IChatModelReference, IChatService } from '../../../common/chatService/chatService.js';
import { IChatSessionsService, localChatSessionType } from '../../../common/chatSessionsService.js';
import { LocalChatSessionUri, getChatSessionType, getNewChatSessionResource, isUntitledChatSession } from '../../../common/model/chatUri.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, getDefaultNewChatSessionType, getDefaultNewChatSessionTypeAndReasonFromServices, getLocalFallbackSessionTypeSelectionReason, SessionTypeSelectionReason } from '../../../common/constants.js';

import { ChatWidget } from '../../widget/chatWidget.js';
import { ChatViewWelcomeController, IViewWelcomeDelegate } from '../../viewsWelcome/chatViewWelcomeController.js';
import { IChatViewsWelcomeDescriptor } from '../../viewsWelcome/chatViewsWelcome.js';
import { IWorkbenchLayoutService, LayoutSettings, Position } from '../../../../../services/layout/browser/layoutService.js';
import { IProgressService } from '../../../../../../platform/progress/common/progress.js';
import { CHAT_WIDGET_VIEW_STATE_CACHE_LIMIT, ChatViewId, IChatWidgetService, IChatWidgetViewState, setModelPreservingInputTypedWhileLoading } from '../../chat.js';
import { IActivityService, ProgressBadge } from '../../../../../services/activity/common/activity.js';
import { disposableTimeout } from '../../../../../../base/common/async.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';

import { IChatEntitlementService } from '../../../../../services/chat/common/chatEntitlementService.js';
import { toErrorMessage } from '../../../../../../base/common/errorMessage.js';
import { IHostService } from '../../../../../services/host/browser/host.js';
import { IMicCaptureService } from '../../voiceClient/micCaptureService.js';
import { ITtsPlaybackService } from '../../voiceClient/ttsPlaybackService.js';
import { IVoiceSessionController } from '../../voiceClient/voiceSessionController.js';
import { IVoiceInputModeService, SimulatedVoiceState } from '../../voiceInputMode/voiceInputMode.js';
import { isGlowingVoiceState, readVoiceGlowIntensity, resolveVoiceGlowColors, VoiceGlowState } from '../../voiceClient/voiceGlow.js';
import { createVoiceGlowController } from '../../voiceClient/voiceGlowController.js';
import { combineVoiceInput } from '../../voiceClient/voiceInputUtils.js';
import { IVoiceModelSelectionResult, resolveVoiceModel } from '../../voiceClient/voiceToolDispatchService.js';
import { IVoicePlaybackService } from '../../../common/voicePlaybackService.js';
import { VOICE_AGENT_PROGRESS_SETTING } from '../../../common/voiceClient/voiceClientService.js';
import { IWorkbenchEnvironmentService } from '../../../../../services/environment/common/environmentService.js';

interface IChatViewPaneState extends Partial<IChatModelInputState> {
	sessionId?: string;
	sessionResource?: URI;

}

interface IChatSessionAcquisitionResult {
	modelRef: IChatModelReference | undefined;
	localFallbackSelectionReason?: SessionTypeSelectionReason;
}

type ChatViewPaneOpenedClassification = {
	owner: 'sbatten';
	comment: 'Event fired when the chat view pane is opened';
};

export class ChatViewPane extends ViewPane implements IViewWelcomeDelegate {

	private readonly memento: Memento<IChatViewPaneState>;
	private readonly viewState: IChatViewPaneState;

	private viewPaneContainer: HTMLElement | undefined;
	private readonly chatViewLocationContext: IContextKey<ViewContainerLocation>;

	private lastDimensions: { height: number; width: number } | undefined;

	private welcomeController: ChatViewWelcomeController | undefined;

	private restoringSession: Promise<void> | undefined;
	private readonly loadSessionCts = this._register(new MutableDisposable<CancellationTokenSource>());
	private readonly _applyModelCts = this._register(new MutableDisposable<CancellationTokenSource>());
	private readonly modelRef = this._register(new MutableDisposable<IChatModelReference>());
	private readonly widgetViewStates = new LRUCache<string, IChatWidgetViewState>(CHAT_WIDGET_VIEW_STATE_CACHE_LIMIT);

	private readonly activityBadge = this._register(new MutableDisposable());
	private readonly _currentSessionResource = observableValue<URI | undefined>(this, undefined);
	private _focusedSessionResource!: IObservable<URI | undefined>;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService2: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService private readonly storageService: IStorageService,
		@IChatService private readonly chatService: IChatService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IProgressService private readonly progressService: IProgressService,
		@IChatEntitlementService _chatEntitlementService: IChatEntitlementService,
		@ICommandService _commandService: ICommandService,
		@IActivityService private readonly activityService: IActivityService,
		@IHostService _hostService: IHostService,
		@IMicCaptureService private readonly micCaptureService: IMicCaptureService,
		@ITtsPlaybackService private readonly ttsPlaybackService: ITtsPlaybackService,
		@IVoiceSessionController private readonly voiceSessionController: IVoiceSessionController,
		@IVoiceInputModeService private readonly voiceInputModeService: IVoiceInputModeService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IVoicePlaybackService _voicePlaybackService: IVoicePlaybackService,
		@IWorkbenchEnvironmentService _workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IAgentHostEnablementService private readonly agentHostEnablementService: IAgentHostEnablementService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
	) {
		super(options, keybindingService2, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.element.classList.add('chat-viewpane-container');

		// View state for the ViewPane is currently global per-provider basically,
		this.memento = new Memento(`interactive-session-view-${CHAT_PROVIDER_ID}`, this.storageService);
		this.viewState = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		if (
			lifecycleService.startupKind !== StartupKind.ReloadedWindow &&
			this.configurationService.getValue<boolean>(ChatConfiguration.RestoreLastPanelSession) === false
		) {
			this.viewState.sessionId = undefined;
			this.viewState.sessionResource = undefined;
		}
		this.chatViewLocationContext = ChatContextKeys.panelLocation.bindTo(contextKeyService);

		this.updateContextKeys();

		this._focusedSessionResource = observableFromEvent(this,
			this.chatWidgetService.onDidChangeFocusedSession,
			() => this.chatWidgetService.lastFocusedWidget?.viewModel?.sessionResource);

		this.registerListeners();
	}

	private updateContextKeys(): void {
		const { location } = this.getViewPositionAndLocation();

		this.chatViewLocationContext.set(location ?? ViewContainerLocation.AuxiliaryBar);
	}

	private getViewPositionAndLocation(): { position: Position; location: ViewContainerLocation } {
		const viewLocation = this.viewDescriptorService.getViewLocationById(this.id);
		const sideBarPosition = this.layoutService.getSideBarPosition();
		const panelPosition = this.layoutService.getPanelPosition();

		let sideSessionsOnRightPosition: boolean;
		switch (viewLocation) {
			case ViewContainerLocation.Sidebar:
				sideSessionsOnRightPosition = sideBarPosition === Position.RIGHT;
				break;
			case ViewContainerLocation.Panel:
				sideSessionsOnRightPosition = panelPosition !== Position.LEFT;
				break;
			default:
				sideSessionsOnRightPosition = sideBarPosition === Position.LEFT;
				break;
		}

		return {
			position: sideSessionsOnRightPosition ? Position.RIGHT : Position.LEFT,
			location: viewLocation ?? ViewContainerLocation.AuxiliaryBar,
		};
	}


	private updateViewPaneClasses(fromEvent: boolean): void {
		const activityBarLocationDefault = this.configurationService.getValue<string>(LayoutSettings.ACTIVITY_BAR_LOCATION) === 'default';
		this.viewPaneContainer?.classList.toggle('activity-bar-location-default', activityBarLocationDefault);
		this.viewPaneContainer?.classList.toggle('activity-bar-location-other', !activityBarLocationDefault);

		const { position, location } = this.getViewPositionAndLocation();

		this.viewPaneContainer?.classList.toggle('chat-view-location-auxiliarybar', location === ViewContainerLocation.AuxiliaryBar);
		this.viewPaneContainer?.classList.toggle('chat-view-location-sidebar', location === ViewContainerLocation.Sidebar);
		this.viewPaneContainer?.classList.toggle('chat-view-location-panel', location === ViewContainerLocation.Panel);

		this.viewPaneContainer?.classList.toggle('chat-view-position-left', position === Position.LEFT);
		this.viewPaneContainer?.classList.toggle('chat-view-position-right', position === Position.RIGHT);

		if (fromEvent) {
			this.relayout();
		}
	}

	private registerListeners(): void {

		this._register(this.chatAgentService.onDidChangeAgents(() => this.onDidChangeAgents()));

		this._register(this.chatSessionsService.onDidCommitSession(async (e) => {
			if (!this.modelRef.value) {
				return;
			}

			if (!isEqual(e.original, this.modelRef.value.object.sessionResource)) {
				return;
			}

			const modelRef = await this.chatService.acquireOrLoadSession(e.committed, ChatAgentLocation.Chat, CancellationToken.None, 'ChatViewPane#onDidCommitSession');
			await this.showModel(CancellationToken.None, modelRef);
		}));

		this._register(Event.any(
			Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('workbench.sideBar.location')),
			this.layoutService.onDidChangePanelPosition,
			this.layoutService.onDidChangePartVisibility,
			Event.filter(this.viewDescriptorService.onDidChangeContainerLocation, e => e.viewContainer === this.viewDescriptorService.getViewContainerByViewId(this.id))
		)(() => {
			this.updateContextKeys();
			this.updateViewPaneClasses(true );
		}));

		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => {
			return e.affectsConfiguration(LayoutSettings.ACTIVITY_BAR_LOCATION);
		})(() => this.updateViewPaneClasses(true)));
	}

	private onDidChangeAgents(): void {
		if (this.chatAgentService.getDefaultAgent(ChatAgentLocation.Chat)) {
			if (!this._widget?.viewModel && !this.restoringSession) {
				this.restoringSession =
					this.acquireTransferredOrPersistedSession(CancellationToken.None, 'ChatViewPane#onDidChangeAgents').then(async session => {
						if (!this._widget) {
							return;
						}

						const wasVisible = this._widget.visible;
						try {
							this._widget.setVisible(false);

							await this.showModel(CancellationToken.None, session.modelRef, true, !session.modelRef, undefined, session.localFallbackSelectionReason);
						} finally {
							this._widget.setVisible(wasVisible);
						}
					});

				this.restoringSession.finally(() => this.restoringSession = undefined);
			}
		}

		this._onDidChangeViewWelcomeState.fire();
	}

	private async getTransferredOrPersistedSessionInfo(): Promise<URI | undefined> {
		if (this.chatService.transferredSessionResource) {
			return this.chatService.transferredSessionResource;
		}

		if (this.viewState.sessionResource) {
			const revived = URI.revive(this.viewState.sessionResource);
			if (revived) {
				return revived;
			}
		}

		if (this.viewState.sessionId) {
			return LocalChatSessionUri.forSession(this.viewState.sessionId);
		}

		if (this.configurationService.getValue<boolean>(ChatConfiguration.RestoreLastPanelSession) !== false) {
			const history = await this.chatService.getLocalSessionHistory();
			const activeSession = history.find(entry => !entry.isEmpty);
			if (activeSession) {
				return activeSession.sessionResource;
			}
			if (history.length > 0) {
				return history[0].sessionResource;
			}
		}

		return undefined;
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);

		this.telemetryService.publicLog2<{}, ChatViewPaneOpenedClassification>('chatViewPaneOpened');

		this.viewPaneContainer = parent;
		this.viewPaneContainer.classList.add('chat-viewpane');
		this.updateViewPaneClasses(false);

		const controlsWrapper = append(parent, $('.voice-agent-controls-wrapper'));
		this.createControls(controlsWrapper);

		this._voiceBarContainer = $('.voice-agent-bar-host');
		this._voiceBarContainer.style.display = 'none';
		this._updateVoiceBar(this._voiceBarContainer);

		const inputContainerEl = this._widget.inputPart.inputContainerElement;
		if (inputContainerEl) {
			this._setupVoiceTranscriptOverlay(inputContainerEl);
		}

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('agents.voice.enabled')) {
				this._updateVoiceBar(this._voiceBarContainer!);
			}
		}));

		this.setupContextMenu(parent);

		this.applyModel();
	}

	private createControls(parent: HTMLElement): void {

		const welcomeController = this.welcomeController = this._register(this.instantiationService.createInstance(ChatViewWelcomeController, parent, this, ChatAgentLocation.Chat));

		const chatWidget = this.createChatControl(parent);

		this.registerControlsListeners(chatWidget, welcomeController);
	}


	private _voiceBarContainer: HTMLElement | undefined;
	private readonly _voiceBarDisposables = this._register(new DisposableStore());

	private _updateVoiceBar(container: HTMLElement): void {
		this._voiceBarDisposables.clear();
		container.replaceChildren();

		container.style.display = 'none';

		if (this.configurationService.getValue<boolean>('agents.voice.enabled')) {
			this._voiceBarDisposables.add(CommandsRegistry.registerCommand('_chat.voice.acceptInput', (accessor, text: string) => {
				const chatWidgetService = accessor.get(IChatWidgetService);
				const focusedWidget = chatWidgetService.lastFocusedWidget;
				const widget = focusedWidget?.hasInputFocus() ? focusedWidget : this._widget;
				if (text && widget?.viewModel) {
					if (widget.viewModel.editing) {
						widget.input.setValue(text, false);
					} else {
						return widget.acceptInput(combineVoiceInput(widget.getInput(), text), {
							preserveFocus: true,
							isVoiceModeInput: this.configurationService.getValue<boolean>(VOICE_AGENT_PROGRESS_SETTING) === true,
						});
					}
				}
				return undefined;
			}));
			this._voiceBarDisposables.add(CommandsRegistry.registerCommand('_chat.voice.switchToSession', async (_accessor, resourceStr: string): Promise<boolean> => {
				if (!resourceStr) {
					return false;
				}
				try {
					const resource = URI.parse(resourceStr);
					this.viewState.sessionResource = resource;
					this.applyModel();
					await this.restoringSession;
					const restoredResource = this._widget?.viewModel?.sessionResource;
					return !!restoredResource && isEqual(restoredResource, resource);
				} catch {
					return false;
				}
			}));
			this._voiceBarDisposables.add(CommandsRegistry.registerCommand('_chat.voice.getCurrentSession', (_accessor): string | undefined => {
				return this._widget?.viewModel?.sessionResource?.toString();
			}));
			this._voiceBarDisposables.add(CommandsRegistry.registerCommand('_chat.voice.selectModel', (_accessor, requestedModel: string): IVoiceModelSelectionResult => {
				const widget = this._getVoiceActionWidget();
				if (!widget) {
					return { ok: false, reason: 'no_input' };
				}
				const resolved = resolveVoiceModel(widget.inputPart.availableLanguageModels, requestedModel);
				if (!resolved.ok || !resolved.identifier) {
					return resolved;
				}
				return widget.inputPart.switchModelByIdentifier(resolved.identifier, true, true)
					? resolved
					: { ok: false, reason: 'selection_failed', available_models: resolved.available_models };
			}));
		}
	}

	private _getVoiceActionWidget() {
		const target = this._currentVoiceInputResource();
		return target ? this.chatWidgetService.getWidgetBySessionResource(target) : this._widget;
	}

	private _currentVoiceInputResource(reader?: IReader): URI | undefined {
		const target = reader ? this.voiceSessionController.targetSession.read(reader) : this.voiceSessionController.targetSession.get();
		if (target) {
			return target;
		}
		const focused = reader ? this._focusedSessionResource.read(reader) : this._focusedSessionResource.get();
		return focused ?? this._widget?.viewModel?.sessionResource;
	}

	private _setupVoiceTranscriptOverlay(inputContainerEl: HTMLElement): void {
		inputContainerEl.style.position = 'relative';
		const showTranscriptSetting = observableFromEvent(
			this,
			Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('agents.voice.showTranscript')),
			() => this.configurationService.getValue<boolean>('agents.voice.showTranscript') !== false
		);
		const showLiveTranscriptSetting = observableFromEvent(
			this,
			Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('agents.voice.liveTranscript')),
			() => this.configurationService.getValue<boolean>('agents.voice.liveTranscript') !== false
		);
		const inputValue = observableFromEvent(
			this,
			this._widget.inputEditor.onDidChangeModelContent,
			() => this._widget.getInput()
		);
		const transcriptOverlay = $('.voice-transcript-overlay');
		const transcriptScrollable = this._register(new DomScrollableElement(transcriptOverlay, {
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
		}));
		const transcriptOverlayNode = transcriptScrollable.getDomNode();
		transcriptOverlayNode.classList.add('voice-transcript-overlay-scrollable');
		transcriptOverlayNode.style.display = 'none';
		inputContainerEl.append(transcriptOverlayNode);

		let animFrameId: number | undefined;
		const glowDataArrayRef: { value: Uint8Array | undefined } = { value: undefined };
		const win = getWindow(inputContainerEl);
		const glowController = this._register(createVoiceGlowController(
			inputContainerEl,
			() => isDark(this.themeService.getColorTheme().type) ? 'dark' : 'light',
			() => resolveVoiceGlowColors(this.themeService.getColorTheme()),
		));
		this._register(this.themeService.onDidColorThemeChange(() => glowController.refreshTheme()));
		const getEffectiveVoice = (): { connected: boolean; voiceState: VoiceGlowState; simulating: boolean } => {
			const sim: SimulatedVoiceState | undefined = this.voiceInputModeService.simulatedVoiceState.get();
			if (sim === 'idle' || sim === 'listening' || sim === 'speaking') {
				return { connected: true, voiceState: sim, simulating: true };
			}
			if (sim === 'off' || sim === 'connecting' || sim === 'dictating') {
				return { connected: false, voiceState: 'idle', simulating: true };
			}
			const voiceState = this.voiceSessionController.voiceState.get() as VoiceGlowState;
			return {
				connected: this.voiceSessionController.isConnected.get(),
				voiceState: voiceState === 'listening' && this.voiceSessionController.isMuted.get() ? 'idle' : voiceState,
				simulating: false,
			};
		};
		const startGlowAnimation = () => {
			if (animFrameId !== undefined) { return; }
			const animate = () => {
				animFrameId = win.requestAnimationFrame(animate);
				const { connected, voiceState, simulating } = getEffectiveVoice();
				const currentSession = this._currentSessionResource.get();
				const boundResource = this._currentVoiceInputResource();
				const isOwner = !!currentSession && !!boundResource && isEqual(currentSession, boundResource);
				const glowActive = connected && isGlowingVoiceState(voiceState) && (simulating || isOwner);

				if (!glowActive) {
					glowController.clear();
					return;
				}

				const analyser = this.ttsPlaybackService.analyserNode
					?? (voiceState === 'listening' ? this.micCaptureService.analyserNode : null)
					?? null;
				let intensity: number;
				if (!analyser && simulating) {
					const t = Date.now() / 1000;
					intensity = Math.min(1, 0.28 + 0.34 * Math.abs(Math.sin(t * 6.1)) + 0.22 * Math.abs(Math.sin(t * 11.3 + 1)));
				} else {
					intensity = readVoiceGlowIntensity(analyser, glowDataArrayRef);
				}

				glowController.render(voiceState, intensity, this.accessibilityService.isMotionReduced());
			};
			animFrameId = win.requestAnimationFrame(animate);
		};
		const stopGlowAnimation = () => {
			if (animFrameId !== undefined) {
				win.cancelAnimationFrame(animFrameId);
				animFrameId = undefined;
			}
			glowController.clear();
		};
		this._register(autorun(reader => {
			const connected = this.voiceSessionController.isConnected.read(reader);
			const voiceState = this.voiceSessionController.voiceState.read(reader);
			const sim = this.voiceInputModeService.simulatedVoiceState.read(reader);
			const simGlow = sim === 'listening' || sim === 'speaking';
			const liveGlow = connected && isGlowingVoiceState(voiceState) && !(voiceState === 'listening' && this.voiceSessionController.isMuted.read(reader));
			if (simGlow || liveGlow) {
				startGlowAnimation();
			} else {
				stopGlowAnimation();
			}
		}));
		this._register({ dispose: () => stopGlowAnimation() });

		let listeningSession: URI | undefined;
		let ownerSession: URI | undefined;
		this._register(autorun(reader => {
			const simState = this.voiceInputModeService.simulatedVoiceState.read(reader);
			const simVersion = this.voiceInputModeService.simulatedVersion.read(reader);
			if (simState !== undefined) {
				if (simState === 'idle' && simVersion) {
					transcriptOverlayNode.style.display = '';
					transcriptOverlayNode.classList.remove('has-transcript');
					transcriptOverlay.replaceChildren();
					const hint = $('span.partial');
					switch (simVersion) {
						case 'handsFree':
							hint.textContent = localize('voiceMode.simHint.handsFree', "Hands-free \u2014 just start talking");
							break;
						case 'keyboardHold': {
							const kbLabel = this.keybindingService.lookupKeybinding('workbench.action.chat.voiceInputMode.holdToTalk')?.getLabel();
							hint.textContent = kbLabel
								? localize('voiceMode.pttHint', "Hold {0} to talk", kbLabel)
								: localize('voiceMode.simHint.keyboardHold', "Hold Space to talk");
							break;
						}
						case 'buttonHold':
							hint.textContent = localize('voiceMode.simHint.buttonHold', "Hold the button to talk, tap to turn off");
							break;
						case 'clickToggle':
							hint.textContent = localize('voiceMode.simHint.clickToggle', "Tap the button to start listening");
							break;
					}
					transcriptOverlay.append(hint);
					transcriptScrollable.scanDomNode();
				} else {
					transcriptOverlayNode.style.display = 'none';
					transcriptOverlayNode.classList.remove('has-transcript');
				}
				return;
			}

			const turns = this.voiceSessionController.transcriptTurns.read(reader);
			const connected = this.voiceSessionController.isConnected.read(reader);
			const voiceState = this.voiceSessionController.voiceState.read(reader);
			const targetSession = this.voiceSessionController.targetSession.read(reader);
			const currentSession = this._currentSessionResource.read(reader);
			const showTranscript = showTranscriptSetting.read(reader);
			const showLiveTranscript = showLiveTranscriptSetting.read(reader);
			const hasInput = inputValue.read(reader).length > 0;
			const visible = turns.filter(t => t.text.length > 0 || (t.speaker === 'user' && t.isPartial));
			const showListeningPlaceholder = voiceState === 'listening' && (!showTranscript || !showLiveTranscript);

			if (!connected) {
				listeningSession = undefined;
				ownerSession = undefined;
				transcriptOverlayNode.style.display = 'none';
				transcriptOverlayNode.classList.remove('has-transcript');
				return;
			}

			if (voiceState === 'listening') {
				if (!listeningSession) {
					listeningSession = targetSession ?? currentSession;
					ownerSession = listeningSession;
				} else if (!targetSession && currentSession && !isEqual(currentSession, listeningSession)) {
					const dictationSession = listeningSession;
					const activelyDictating = turns.some(t => t.speaker === 'user' && t.isPartial && t.text.trim().length > 0);
					if (activelyDictating) {
						this.voiceSessionController.finishListeningAndSubmitTo(dictationSession);
						listeningSession = undefined;
					} else if (isUntitledChatSession(currentSession)) {
						listeningSession = currentSession;
						ownerSession = currentSession;
					} else {
						this.voiceSessionController.discardListening();
						listeningSession = undefined;
					}
				}
			} else {
				listeningSession = undefined;
			}

			const boundResource = this._currentVoiceInputResource(reader);
			if (boundResource && currentSession && !isEqual(boundResource, currentSession)) {
				transcriptOverlayNode.style.display = 'none';
				transcriptOverlayNode.classList.remove('has-transcript');
				return;
			}
			const effectiveOwner = targetSession ?? ownerSession;
			if (effectiveOwner && currentSession && !isEqual(effectiveOwner, currentSession)) {
				transcriptOverlayNode.style.display = 'none';
				transcriptOverlayNode.classList.remove('has-transcript');
				return;
			}

			if (visible.length === 0 || !showTranscript || showListeningPlaceholder) {
				if (hasInput) {
					transcriptOverlayNode.style.display = 'none';
					transcriptOverlayNode.classList.remove('has-transcript');
					return;
				}
				const handsFree = this.configurationService.getValue<boolean>('agents.voice.handsFree') === true;
				if (showListeningPlaceholder) {
					transcriptOverlayNode.style.display = '';
					transcriptOverlayNode.classList.remove('has-transcript');
					transcriptOverlay.replaceChildren();
					const listening = $('span.listening');
					listening.textContent = this.voiceSessionController.isMuted.read(reader)
						? localize('voiceMode.mutedUnmuteToSpeak', "Unmute to speak...")
						: localize('voiceMode.listening', "Listening...");
					transcriptOverlay.append(listening);
					transcriptScrollable.scanDomNode();
				} else if (!showTranscript && voiceState === 'speaking') {
					transcriptOverlayNode.style.display = '';
					transcriptOverlayNode.classList.remove('has-transcript');
					transcriptOverlay.replaceChildren();
					const hint = $('span.partial');
					const kb = this.keybindingService.lookupKeybinding('workbench.action.chat.voiceInputMode.holdToTalk')
						?? this.keybindingService.lookupKeybinding('agentsVoice.pushToTalk');
					const kbLabel = kb?.getLabel();
					hint.textContent = kbLabel
						? localize('voiceMode.bargeInHint', "Speak or use {0}", kbLabel)
						: localize('voiceMode.bargeInHintNoKb', "Speak to barge in");
					transcriptOverlay.append(hint);
					transcriptScrollable.scanDomNode();
				} else if (voiceState === 'idle' && visible.length === 0 && showTranscript && !handsFree) {
					transcriptOverlayNode.style.display = '';
					transcriptOverlayNode.classList.remove('has-transcript');
					transcriptOverlay.replaceChildren();
					const hint = $('span.partial');
					const kb = this.keybindingService.lookupKeybinding('agentsVoice.pushToTalk');
					const kbLabel = kb?.getLabel();
					hint.textContent = kbLabel
						? localize('voiceMode.pttOrBargeInHint', "Press {0} to talk or barge in", kbLabel)
						: localize('voiceMode.clickMicOrBargeInHint', "Click voice mode to talk or barge in");
					transcriptOverlay.append(hint);
					transcriptScrollable.scanDomNode();
				} else {
					transcriptOverlayNode.style.display = 'none';
					transcriptOverlayNode.classList.remove('has-transcript');
				}
				return;
			}

			transcriptOverlayNode.style.display = '';
			transcriptOverlayNode.classList.add('has-transcript');
			const lastTurn = visible[visible.length - 1];
			const contentElements: HTMLElement[] = [];
			if (lastTurn.speaker === 'user') {
				const span = $('span');
				if (lastTurn.isPartial) {
					const committedPart = lastTurn.committed || '';
					const unsurePart = lastTurn.text.slice(committedPart.length);
					if (committedPart) {
						const c = $('span.committed');
						c.textContent = committedPart;
						span.append(c);
					}
					const u = $('span.partial');
					u.textContent = unsurePart + '\u2589';
					span.append(u);
				} else {
					span.className = 'committed';
					span.textContent = lastTurn.text;
				}
				contentElements.push(span);
			} else {
				const div = $('div.assistant-text');
				div.textContent = lastTurn.text;
				contentElements.push(div);
			}
			transcriptOverlay.replaceChildren(...contentElements);
			transcriptScrollable.scanDomNode();
			transcriptScrollable.setScrollPosition({ scrollTop: 0 });
		}));
	}





	private _widget!: ChatWidget;
	get widget(): ChatWidget { return this._widget; }

	private titleControl: ChatViewTitleControl | undefined;

	private createChatControl(parent: HTMLElement): ChatWidget {
		const chatControlsContainer = append(parent, $('.chat-controls-container'));

		const locationBasedColors = this.getLocationBasedColors();

		const editorOverflowWidgetsDomNode = this.layoutService.getContainer(getWindow(chatControlsContainer)).appendChild($('.chat-editor-overflow.monaco-editor'));
		this._register(toDisposable(() => editorOverflowWidgetsDomNode.remove()));

		this.createChatTitleControl(chatControlsContainer);

		const scopedInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, this.scopedContextKeyService])));
		this._widget = this._register(scopedInstantiationService.createInstance(
			ChatWidget,
			ChatAgentLocation.Chat,
			{ viewId: this.id },
			{
				autoScroll: mode => mode !== ChatModeKind.Ask,
				renderFollowups: true,
				supportsFileReferences: true,
				clear: () => this.clear(),
				enableFind: true,
				rendererOptions: {
					renderTextEditsAsSummary: (uri) => {
						return true;
					},
					referencesExpandedWhenEmptyResponse: false,
					progressMessageAtBottomOfResponse: mode => mode !== ChatModeKind.Ask,
				},
				editorOverflowWidgetsDomNode,
				enableImplicitContext: true,
				enableWorkingSet: 'explicit',
				supportsChangingModes: true,
				dndContainer: parent,
			},
			{
				listForeground: SIDE_BAR_FOREGROUND,
				listBackground: locationBasedColors.background,
				listShadow: locationBasedColors.listOverrideStyles.treeStickyScrollShadow,
				overlayBackground: locationBasedColors.overlayBackground,
				inputEditorBackground: locationBasedColors.background,
				resultEditorBackground: editorBackground,
			}));
		this._widget.render(chatControlsContainer, parent);

		const updateWidgetVisibility = (reader?: IReader) => {
			const visible = this.isBodyVisible() && !this.welcomeController?.isShowingWelcome.read(reader);
			this._widget.setVisible(visible);
			if (visible) {
				this.relayout();
			}
		};
		this._register(this.onDidChangeBodyVisibility(() => updateWidgetVisibility()));
		this._register(autorun(reader => updateWidgetVisibility(reader)));

		return this._widget;
	}

	private createChatTitleControl(parent: HTMLElement): void {
		this.titleControl = this._register(this.instantiationService.createInstance(ChatViewTitleControl,
			parent,
			{
				focusChat: () => this._widget.focusInput()
			},
			undefined
		));

		this._register(this.titleControl.onDidChangeHeight(() => {
			this.relayout();
		}));
	}


	private registerControlsListeners(chatWidget: ChatWidget, welcomeController: ChatViewWelcomeController): void {



		this._register(chatWidget.onDidChangeViewModel(() => {
			const model = chatWidget.viewModel?.model;
			this.titleControl?.update(model);
			this._currentSessionResource.set(chatWidget.viewModel?.sessionResource, undefined);

		}));







		const progressBadgeDisposables = this._register(new MutableDisposable<DisposableStore>());
		const updateProgressBadge = () => {
			progressBadgeDisposables.value = new DisposableStore();

			if (!this.configurationService.getValue<boolean>(ChatConfiguration.ChatViewProgressBadgeEnabled)) {
				this.activityBadge.clear();
				return;
			}

			const model = chatWidget.viewModel?.model;
			if (model) {
				progressBadgeDisposables.value.add(autorun(reader => {
					if (model.requestInProgress.read(reader)) {
						this.activityBadge.value = this.activityService.showViewActivity(this.id, {
							badge: new ProgressBadge(() => localize('sessionInProgress', "Agent Session in Progress"))
						});
					} else {
						this.activityBadge.clear();
					}
				}));
			} else {
				this.activityBadge.clear();
			}
		};
		this._register(chatWidget.onDidChangeViewModel(() => updateProgressBadge()));
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration(ChatConfiguration.ChatViewProgressBadgeEnabled))(() => updateProgressBadge()));
		updateProgressBadge();
	}

	private setupContextMenu(parent: HTMLElement): void {
		this._register(addDisposableListener(parent, EventType.CONTEXT_MENU, e => {
			EventHelper.stop(e, true);

			this.contextMenuService.showContextMenu({
				menuId: MenuId.ChatWelcomeContext,
				contextKeyService: this.contextKeyService,
				getAnchor: () => new StandardMouseEvent(getWindow(parent), e)
			});
		}));
	}


	private applyModel(): void {
		this._applyModelCts.value?.cancel();
		const cts = this._applyModelCts.value = new CancellationTokenSource();
		this.restoringSession = this._applyModel(cts.token).catch(err => {
			if (!isCancellationError(err)) {
				this.logService.error('ChatViewPane#applyModel failed', err);
			}
		});
		this.restoringSession.finally(() => this.restoringSession = undefined);
	}

	private async _applyModel(token: CancellationToken): Promise<void> {
		const session = await this.acquireTransferredOrPersistedSession(token, 'ChatViewPane#applyModel');
		await this.showModel(token, session.modelRef, true, !session.modelRef, undefined, session.localFallbackSelectionReason);
	}

	async startNewLocalSession(sessionTypeSelectionReason: SessionTypeSelectionReason = 'explicitOverride'): Promise<IChatModel | undefined> {
		this._applyModelCts.value?.cancel();
		const ref = this.chatService.startNewLocalSession(ChatAgentLocation.Chat, { debugOwner: 'ChatViewPane#startNewLocalSession', sessionTypeSelectionReason });
		return this.showModel(CancellationToken.None, ref);
	}

	private async acquireDefaultNewSession(token: CancellationToken, localFallbackSelectionReason?: SessionTypeSelectionReason): Promise<IChatSessionAcquisitionResult> {
		const workspace = this.workspaceContextService.getWorkspace();
		const defaultTypeAndReason = getDefaultNewChatSessionTypeAndReasonFromServices(this.configurationService, this.chatSessionsService, this.storageService, workspace, this.agentHostEnablementService.enabled.get(), undefined, this.agentHostEnablementService.managedSandboxEnforced.get());
		if (defaultTypeAndReason.sessionType === localChatSessionType) {
			return { modelRef: this.chatService.startNewLocalSession(ChatAgentLocation.Chat, { debugOwner: 'ChatViewPane#acquireDefaultNewSession', sessionTypeSelectionReason: localFallbackSelectionReason ?? defaultTypeAndReason.selectionReason }) };
		}
		const resource = getNewChatSessionResource(defaultTypeAndReason.sessionType);
		try {
			const modelRef = await this.chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, token, 'ChatViewPane#acquireDefaultNewSession', defaultTypeAndReason.selectionReason);
			return {
				modelRef,
				localFallbackSelectionReason: getLocalFallbackSessionTypeSelectionReason(defaultTypeAndReason.sessionType, !!modelRef, localFallbackSelectionReason),
			};
		} catch (error) {
			if (isCancellationError(error)) {
				throw error;
			}
			this.logService.warn(`[ChatViewPane] Failed to acquire default agent-host session, falling back to local`, error);
			return {
				modelRef: undefined,
				localFallbackSelectionReason: getLocalFallbackSessionTypeSelectionReason(defaultTypeAndReason.sessionType, false, localFallbackSelectionReason),
			};
		}
	}

	private async acquireTransferredOrPersistedSession(token: CancellationToken, debugOwner: string): Promise<IChatSessionAcquisitionResult> {
		const sessionResource = await this.getTransferredOrPersistedSessionInfo();
		if (!sessionResource) {
			return { modelRef: undefined };
		}

		let modelRef: IChatModelReference | undefined;
		try {
			modelRef = await this.chatService.acquireOrLoadSession(sessionResource, ChatAgentLocation.Chat, token, debugOwner);
		} catch (error) {
			this.logService.warn(`[ChatViewPane] Failed to acquire session ${sessionResource.toString()}, attempting fallback to last history session`, error);
		}

		if (!modelRef) {
			const history = await this.chatService.getLocalSessionHistory();
			const fallback = history.find(entry => !entry.isEmpty && entry.sessionResource.toString() !== sessionResource.toString());
			if (fallback) {
				try {
					modelRef = await this.chatService.acquireOrLoadSession(fallback.sessionResource, ChatAgentLocation.Chat, token, debugOwner);
				} catch {
					modelRef = undefined;
				}
			}
		}

		if (!modelRef) {
			return {
				modelRef: undefined,
				localFallbackSelectionReason: getLocalFallbackSessionTypeSelectionReason(getChatSessionType(sessionResource), false),
			};
		}

		if (this.shouldSkipRestoredLocalSession(sessionResource, modelRef.object)) {
			modelRef.dispose();
			return { modelRef: undefined };
		}

		return { modelRef };
	}

	private shouldSkipRestoredLocalSession(sessionResource: URI, model: IChatModel): boolean {
		const workspace = this.workspaceContextService.getWorkspace();
		const defaultType = getDefaultNewChatSessionType(this.configurationService, this.chatSessionsService, this.storageService, workspace, this.agentHostEnablementService.enabled.get(), undefined, this.agentHostEnablementService.managedSandboxEnforced.get());
		return defaultType !== localChatSessionType
			&& getChatSessionType(sessionResource) === localChatSessionType
			&& !model.hasRequests;
	}

	private async showModel(token: CancellationToken, modelRef?: IChatModelReference | undefined, startNewSession = true, ignoreTransferredSession = false, inputBeforeLoad?: string, localFallbackSelectionReason?: SessionTypeSelectionReason): Promise<IChatModel | undefined> {
		const oldModelResource = this._widget.viewModel?.sessionResource;
		if (oldModelResource) {
			this.widgetViewStates.set(getComparisonKey(oldModelResource), this._widget.getViewState());
		}
		this.modelRef.value = undefined;

		const baselineInput = inputBeforeLoad ?? this._widget?.getInput() ?? '';

		let ref: IChatModelReference | undefined;
		if (startNewSession) {
			if (modelRef) {
				ref = modelRef;
			} else if (!ignoreTransferredSession && this.chatService.transferredSessionResource) {
				ref = await this.chatService.acquireOrLoadSession(this.chatService.transferredSessionResource, ChatAgentLocation.Chat, token, 'ChatViewPane#showModel');
			} else {
				const defaultSession = await this.acquireDefaultNewSession(token, localFallbackSelectionReason);
				ref = defaultSession.modelRef
					?? this.chatService.startNewLocalSession(ChatAgentLocation.Chat, { debugOwner: 'ChatViewPane#showModel', sessionTypeSelectionReason: defaultSession.localFallbackSelectionReason });
			}
			if (!ref) {
				throw new Error('Could not start chat session');
			}
		}

		if (token.isCancellationRequested) {
			ref?.dispose();
			return undefined;
		}

		this.modelRef.value = ref;
		const model = ref?.object;

		if (model) {
			await this.updateWidgetLockState(getChatSessionType(model.sessionResource));

			if (token.isCancellationRequested) {
				this.modelRef.value = undefined;
				return undefined;
			}

			this.viewState.sessionResource = model.sessionResource;
		}

		if (model) {
			setModelPreservingInputTypedWhileLoading(this._widget, baselineInput, () => this._widget.setModel(model));
			const widgetViewState = this.widgetViewStates.get(getComparisonKey(model.sessionResource));
			if (widgetViewState) {
				this._widget.restoreViewState(widgetViewState);
			}
		} else {
			this._widget.setModel(model);
		}

		this.titleControl?.update(model);

		this.updateActions();



		return model;
	}

	private async updateWidgetLockState(sessionType: string): Promise<void> {
		if (sessionType === localChatSessionType) {
			this._widget.unlockFromCodingAgent();
			return;
		}

		let canResolve = false;
		try {
			canResolve = await this.chatSessionsService.canResolveChatSession(sessionType);
		} catch (error) {
			this.logService.warn(`Failed to resolve chat session type '${sessionType}' for locking`, error);
		}

		if (!canResolve) {
			this._widget.unlockFromCodingAgent();
			return;
		}

		const contribution = this.chatSessionsService.getChatSessionContribution(sessionType);
		if (contribution) {
			this._widget.lockToCodingAgent(contribution.name, contribution.displayName, sessionType, contribution.agentHostProviderId);
		} else {
			this._widget.unlockFromCodingAgent();
		}
	}

	private async clear(): Promise<void> {
		this.loadSessionCts.value?.cancel();

		this.updateViewState();
		await this.showModel(CancellationToken.None);

		this.updateActions();
	}

	async loadSession(sessionResource: URI, sessionTypeSelectionReason?: SessionTypeSelectionReason): Promise<IChatModel | undefined> {
		const t0 = Date.now();
		this.logService.trace(`[ChatViewPane] loadSession start uri=${sessionResource.toString()}`);

		const inputBeforeLoad = this._widget?.getInput() ?? '';

		this.loadSessionCts.value?.cancel();
		const cts = this.loadSessionCts.value = new CancellationTokenSource();
		const token = cts.token;

		if (this.restoringSession) {
			await this.restoringSession;
		}

		if (token.isCancellationRequested) {
			this.logService.trace(`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} cancelled=true phase=preAcquire`);
			return undefined;
		}

		return this.progressService.withProgress({ location: ChatViewId, delay: 200 }, async () => {
			let queue: Promise<void> = Promise.resolve();
			let didAcquireSession = false;

			const clearWidget = disposableTimeout(() => {
				if (token.isCancellationRequested || this.loadSessionCts.value !== cts) {
					return;
				}
				queue = this.showModel(token, undefined, false).then(() => { });
			}, 100);
			const clearWidgetCancellationListener = token.onCancellationRequested(() => clearWidget.dispose());

			try {
				const newModelRef = await this.chatService.acquireOrLoadSession(sessionResource, ChatAgentLocation.Chat, token, 'ChatViewPane#loadSession', sessionTypeSelectionReason);
				didAcquireSession = !!newModelRef;
				clearWidget.dispose();
				await queue;

				if (token.isCancellationRequested) {
					newModelRef?.dispose();
					this.logService.trace(`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} cancelled=true phase=postAcquire`);
					return undefined;
				}

				const localFallbackSelectionReason = getLocalFallbackSessionTypeSelectionReason(getChatSessionType(sessionResource), !!newModelRef);
				const result = await this.showModel(token, newModelRef, true, false, inputBeforeLoad, localFallbackSelectionReason);
				this.logService.trace(`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()}`);
				return result;
			} catch (err) {
				clearWidget.dispose();
				await queue;

				if (token.isCancellationRequested) {
					this.logService.trace(`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} cancelled=true phase=error`);
					return undefined;
				}

				this.logService.error(`Failed to load chat session '${sessionResource.toString()}'`, err);
				this.notificationService.error(localize('chat.loadSessionFailed', "Failed to open chat session: {0}", toErrorMessage(err)));
				const localFallbackSelectionReason = getLocalFallbackSessionTypeSelectionReason(getChatSessionType(sessionResource), didAcquireSession);
				const result = await this.showModel(token, undefined, true, false, inputBeforeLoad, localFallbackSelectionReason);
				this.logService.trace(`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} error=true`);
				return result;
			} finally {
				clearWidgetCancellationListener.dispose();
			}
		});
	}


	override focus(): void {
		super.focus();

		this.focusInput();
	}

	focusInput(): void {
		this._widget.focusInput();
	}



	private relayout(): void {
		if (!this._widget?.visible) {
			return;
		}

		if (this.lastDimensions) {
			this.layoutBody(this.lastDimensions.height, this.lastDimensions.width);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		this.lastDimensions = { height, width };
		const titleHeight = this.titleControl?.getHeight() ?? 0;
		const effectiveHeight = Math.max(0, height - titleHeight);
		this._widget?.layout(effectiveHeight, width);
	}


	override saveState(): void {

		if (this._widget?.viewModel) {
			this._widget.saveState();

			this.updateViewState();
			this.memento.saveMemento();
		}

		super.saveState();
	}

	private updateViewState(viewState?: IChatModelInputState): void {
		const newViewState = viewState ?? this._widget.getInputState();
		if (newViewState) {
			for (const [key, value] of Object.entries(newViewState)) {
				(this.viewState as Record<string, unknown>)[key] = value;
			}
		}
	}

	override shouldShowWelcome(): boolean {
		const noPersistedSessions = !this.chatService.hasSessions();
		const hasCoreAgent = this.chatAgentService.getAgents().some(agent => agent.isCore && agent.locations.includes(ChatAgentLocation.Chat));
		const hasDefaultAgent = this.chatAgentService.getDefaultAgent(ChatAgentLocation.Chat) !== undefined;
		const shouldShow = !hasCoreAgent && (!hasDefaultAgent || !this._widget?.viewModel && noPersistedSessions);

		this.logService.trace(`ChatViewPane#shouldShowWelcome() = ${shouldShow}: hasCoreAgent=${hasCoreAgent} hasDefaultAgent=${hasDefaultAgent} || noViewModel=${!this._widget?.viewModel} && noPersistedSessions=${noPersistedSessions}`);

		return !!shouldShow;
	}

	getMatchingWelcomeView(): IChatViewsWelcomeDescriptor | undefined {
		return this.welcomeController?.getMatchingWelcomeView();
	}

	override getActionsContext(): IChatViewTitleActionContext | undefined {
		return this._widget?.viewModel ? {
			sessionResource: this._widget.viewModel.sessionResource,
			$mid: MarshalledId.ChatViewContext
		} : undefined;
	}

}
