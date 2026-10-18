/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { addDisposableListener } from '../../../../../../base/browser/dom.js';
import { DEFAULT_FONT_FAMILY } from '../../../../../../base/browser/fonts.js';
import { IHistoryNavigationWidget } from '../../../../../../base/browser/history.js';
import { hasModifierKeys, StandardKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { IActionViewItem } from '../../../../../../base/browser/ui/actionbar/actionbar.js';
import { ActionViewItem, BaseActionViewItem, IActionViewItemOptions } from '../../../../../../base/browser/ui/actionbar/actionViewItems.js';
import * as aria from '../../../../../../base/browser/ui/aria/aria.js';
import { ButtonWithIcon } from '../../../../../../base/browser/ui/button/button.js';
import { createInstantHoverDelegate } from '../../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IAction } from '../../../../../../base/common/actions.js';
import { equals as arraysEqual } from '../../../../../../base/common/arrays.js';
import { DeferredPromise, RunOnceScheduler } from '../../../../../../base/common/async.js';
import { IStringDictionary } from '../../../../../../base/common/collections.js';
import { isDefined } from '../../../../../../base/common/types.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { onUnexpectedError } from '../../../../../../base/common/errors.js';
import { Iterable } from '../../../../../../base/common/iterator.js';
import { KeyCode } from '../../../../../../base/common/keyCodes.js';
import { Lazy } from '../../../../../../base/common/lazy.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ResourceMap, ResourceSet } from '../../../../../../base/common/map.js';
import { MarshalledId } from '../../../../../../base/common/marshallingIds.js';
import { Schemas } from '../../../../../../base/common/network.js';
import { mixin } from '../../../../../../base/common/objects.js';
import { autorun, constObservable, derived, derivedOpts, IObservable, ISettableObservable, ITransaction, observableFromEvent, observableSignalFromEvent, observableValue, transaction } from '../../../../../../base/common/observable.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import { isEqual, joinPath } from '../../../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IEditorConstructionOptions } from '../../../../../../editor/browser/config/editorConfiguration.js';
import { EditorExtensionsRegistry } from '../../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorOptions, IEditorOptions, IEditorScrollbarOptions } from '../../../../../../editor/common/config/editorOptions.js';
import { EDITOR_FONT_DEFAULTS } from '../../../../../../editor/common/config/fontInfo.js';
import { IDimension } from '../../../../../../editor/common/core/2d/dimension.js';
import { IPosition } from '../../../../../../editor/common/core/position.js';
import { IRange, Range } from '../../../../../../editor/common/core/range.js';
import { isLocation } from '../../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { CopyPasteController } from '../../../../../../editor/contrib/dropOrPasteInto/browser/copyPasteController.js';
import { DropIntoEditorController } from '../../../../../../editor/contrib/dropOrPasteInto/browser/dropIntoEditorController.js';
import { ContentHoverController } from '../../../../../../editor/contrib/hover/browser/contentHoverController.js';
import { GlyphHoverController } from '../../../../../../editor/contrib/hover/browser/glyphHoverController.js';
import { LinkDetector } from '../../../../../../editor/contrib/links/browser/links.js';
import { SuggestController } from '../../../../../../editor/contrib/suggest/browser/suggestController.js';
import { localize } from '../../../../../../nls.js';
import { IAccessibilityService } from '../../../../../../platform/accessibility/common/accessibility.js';
import { MenuWorkbenchButtonBar } from '../../../../../../platform/actions/browser/buttonbar.js';
import { IActionViewItemService, type IActionViewItemFactory } from '../../../../../../platform/actions/browser/actionViewItemService.js';
import { MenuEntryActionViewItem } from '../../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../../../../platform/actions/browser/toolbar.js';
import { MenuId, MenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { registerAndCreateHistoryNavigationContext } from '../../../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { WorkbenchList } from '../../../../../../platform/list/browser/listService.js';
import { canLog, ILogService, LogLevel } from '../../../../../../platform/log/common/log.js';
import { ObservableMemento, observableMemento } from '../../../../../../platform/observable/common/observableMemento.js';
import { bindContextKey } from '../../../../../../platform/observable/common/platformObservableUtils.js';
import { IVoiceModeOnboardingService } from '../../../../agentsVoice/browser/voiceModeOnboarding.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { ISharedWebContentExtractorService } from '../../../../../../platform/webContentExtractor/common/webContentExtractor.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../../platform/workspace/common/workspace.js';
import { ISCMService } from '../../../../scm/common/scm.js';
import { IWorkbenchLayoutService, Position } from '../../../../../services/layout/browser/layoutService.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../../../common/views.js';
import { ResourceLabels } from '../../../../../browser/labels.js';
import { IChatEntitlementService } from '../../../../../services/chat/common/chatEntitlementService.js';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from '../../../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../../../services/environment/common/environmentService.js';
import { AccessibilityVerbositySettingId } from '../../../../accessibility/browser/accessibilityConfiguration.js';
import { AccessibilityCommandId } from '../../../../accessibility/common/accessibilityCommands.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions, setupSimpleEditorSelectionStyling } from '../../../../codeEditor/browser/simpleEditorOptions.js';
import { IChatViewTitleActionContext } from '../../../common/actions/chatActions.js';
import { ChatContextKeys } from '../../../common/actions/chatContextKeys.js';
import { ChatRequestVariableSet, getImageAttachmentLimit, IChatRequestVariableEntry, isPastedTextArtifact, isBrowserViewVariableEntry, isElementVariableEntry, isExplicitFileOrImageVariableEntry, isImageVariableEntry, isNotebookOutputVariableEntry, isPasteVariableEntry, isPromptFileVariableEntry, isPromptTextVariableEntry, isSCMHistoryItemChangeRangeVariableEntry, isSCMHistoryItemChangeVariableEntry, isSCMHistoryItemVariableEntry, OmittedState } from '../../../common/attachments/chatVariableEntries.js';
import { ChatMode, getModeNameForTelemetry, IChatMode, IChatModes, IChatModeService } from '../../../common/chatModes.js';
import { IChatFollowup, IChatPlanReview, IChatQuestionCarousel, IChatService, IChatToolInvocation } from '../../../common/chatService/chatService.js';
import { IChatSessionProviderOptionGroup, IChatSessionProviderOptionItem, IChatSessionsService, isIChatSessionFileChange2, localChatSessionType, SessionType } from '../../../common/chatSessionsService.js';
import { getStoredSelectedModel, storeSelectedModel } from '../../../common/chatSelectedModel.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, ChatPermissionLevel, isChatPermissionLevel } from '../../../common/constants.js';
import { isAutoApprovePolicyRestricted, isAutoApproveValuePolicyRestricted } from '../../../common/agentHostConfigPolicy.js';
import { IChatEditingSession, IModifiedFileEntry, ModifiedFileEntryState } from '../../../common/editing/chatEditingService.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../../../common/languageModels.js';
import { ChatInputModelSelectionController, IChatInputModelSelectionRuntime } from './chatInputModelSelectionController.js';
import { ChatModelConfigurationStore } from './chatModelConfigurationStore.js';
import { ChatModelSelectionDiagnostics } from './chatModelSelectionDiagnostics.js';
import { deserializeUntitledInputAttachments, deserializeUntitledInputState, serializeUntitledInputAttachments, serializeUntitledInputState } from './chatInputStatePersistence.js';
import { ChatInputStateOrigin, IChatModel, IChatModelInputState, IChatRequestModeInfo, IChatRequestModel, IInputModel, IIntendedModelHolder, IntendedModelSlot, logChangesToStateModel } from '../../../common/model/chatModel.js';
import { isInConversationModelChoice, ModelSelectionReason, resolveConfiguredModel, RestoredModelReason } from '../../../common/modelSelection.js';
import { filterModelsForSession, hasModelsTargetingSession, isModelHiddenInPicker, isModelSupportedForInlineChat, isModelSupportedForMode, isNewConversation, isSessionStarted, mergeModelsWithCache, shouldDropAgnosticDraftModel, shouldResetOnModelListChange, shouldRestorePerTypeModelOnSessionSwitch } from './chatInputModelUtils.js';
import { getChatSessionType, isUntitledChatSession, LocalChatSessionUri } from '../../../common/model/chatUri.js';
import { IChatResponseViewModel, isResponseVM } from '../../../common/model/chatViewModel.js';
import { IChatAgentService } from '../../../common/participants/chatAgents.js';
import { ILanguageModelToolsService } from '../../../common/tools/languageModelToolsService.js';
import { ChatHistoryNavigator } from '../../../common/widget/chatWidgetHistoryService.js';
import { ChatEditingSessionSubmitAction, ChatSessionPrimaryPickerAction, ChatSubmitAction, IChatExecuteActionContext, OpenModelPickerAction, OpenModePickerAction, OpenPermissionPickerAction, OpenSessionTargetPickerAction, OpenWorkspacePickerAction } from '../../actions/chatExecuteActions.js';
import { ChatVoiceInputModeAction, VoiceInputModeActionViewItem } from '../../voiceInputMode/voiceInputModeActionViewItem.js';
import { ChatSpeechToTextConnectingAction, ChatSpeechToTextPreparingAction, ToggleChatSpeechToTextAction } from '../../actions/chatSpeechToTextActions.js';
import { DictationActionViewItem } from '../../speechToText/dictationActionViewItem.js';
import { DictationDownloadActionViewItem } from '../../speechToText/dictationDownloadActionViewItem.js';
import { ChatSpeechToTextState, IChatSpeechToTextService } from '../../speechToText/chatSpeechToTextService.js';
import { IDictationOnboardingService } from '../../speechToText/dictationOnboarding.js';
import { isDictationActiveForEditor, notifyDictationSubmitted, onDidChangeDictationEditor } from '../../speechToText/dictationSession.js';
import { VoiceModeActionViewItem } from '../../voiceClient/voiceModeActionViewItem.js';
import { isVoiceSessionActiveForInput, IVoiceSessionController } from '../../voiceClient/voiceSessionController.js';
import { ChatAttachmentModel } from '../../attachments/chatAttachmentModel.js';
import { IChatAttachmentWidgetRegistry } from '../../attachments/chatAttachmentWidgetRegistry.js';
import { DefaultChatAttachmentWidget, ElementChatAttachmentWidget, FileAttachmentWidget, ImageAttachmentWidget, BrowserViewAttachmentWidget, NotebookCellOutputChatAttachmentWidget, PasteAttachmentWidget, PromptFileAttachmentWidget, PromptTextAttachmentWidget, SCMHistoryItemAttachmentWidget, SCMHistoryItemChangeAttachmentWidget, SCMHistoryItemChangeRangeAttachmentWidget, TerminalCommandAttachmentWidget, ToolSetOrToolItemAttachmentWidget } from '../../attachments/chatAttachmentWidgets.js';
import { ChatImplicitContexts } from '../../attachments/chatImplicitContext.js';
import { ImplicitContextAttachmentWidget, isImplicitContextAlreadyAttached } from '../../attachments/implicitContextAttachment.js';
import { IChatWidget, IChatWidgetService, IChatWidgetViewModelChangeEvent, ISessionTypePickerDelegate, isIChatResourceViewContext, isIChatViewViewContext, IWorkspacePickerDelegate } from '../../chat.js';
import { ChatEditingShowChangesAction, ViewPreviousEditsAction } from '../../chatEditing/chatEditingActions.js';
import { resizeImage, createFileForMedia } from '../../chatImageUtils.js';
import { ChatSessionPickerActionItem, IChatSessionPickerDelegate } from '../../chatSessions/chatSessionPickerActionItem.js';
import { IChatContextService } from '../../contextContrib/chatContextService.js';
import { IDisposableReference } from '../chatContentParts/chatCollections.js';
import { ChatPlanReviewPart, IChatPlanReviewPartOptions } from '../chatContentParts/chatPlanReviewPart.js';
import { ChatQuestionCarouselPart, IChatQuestionCarouselOptions } from '../chatContentParts/chatQuestionCarouselPart.js';
import { ChatToolConfirmationCarouselPart, RevealSubagentCallback, ToolInvocationPartFactory } from '../chatContentParts/toolInvocationParts/chatToolConfirmationCarouselPart.js';
import { ChatToolInvocationPart } from '../chatContentParts/toolInvocationParts/chatToolInvocationPart.js';
import { IChatContentPartRenderContext } from '../chatContentParts/chatContentParts.js';
import { CollapsibleListPool, IChatCollapsibleListItem, IChatReferenceListItem } from '../chatContentParts/chatReferencesContentPart.js';
import { ChatTodoListWidget } from '../chatContentParts/chatTodoListWidget.js';
import { ChatArtifactsWidget } from '../chatArtifactsWidget.js';
import { handleTerminalCommandPaste, isTerminalCommandInput, isTerminalCommandPaste as isTerminalCommandPasteContent } from '../../chatTerminalCommandPaste.js';
import { ChatDynamicVariableModel } from '../../attachments/chatDynamicVariables.js';
import { ChatDragAndDrop } from '../chatDragAndDrop.js';
import { getChatPetPillPlatformTop, getChatPetStackPlatformTop } from '../chatPetWidget.js';
import { ChatFollowups } from './chatFollowups.js';
import { IChatInputNotificationContext, IChatInputNotificationService } from './chatInputNotificationService.js';
import { ChatGoalBannerWidget } from './chatGoalBannerWidget.js';
import { ChatInputNotificationWidget } from './chatInputNotificationWidget.js';
import { ChatInputNoticeHost, ChatInputNoticeLane } from './chatInputNoticeHost.js';
import { registerChatInputOnboardingHosts } from './chatInputOnboardingHosts.js';
import { IChatInputNoticeHubService } from './chatInputNoticeHub.js';
import { IChatInputPickerOptions } from './chatInputPickerActionItem.js';
import { ChatInputPickerResponsiveLayout, IChatInputPickerResponsiveLayoutItem, isChatInputPickerResponsiveState } from './chatInputPickerResponsiveLayout.js';
import { chatInputStackClass, chatInputStackSlotClass, chatInputSurfaceStackClass, chatInputSurfaceStackSlotClass, ChatInputStackSlot, setChatInputStackInputFocused, setChatInputStackSlot } from './chatInputStack.js';
import { ChatSessionArchiveNudge, IChatSessionArchiveNudgeOptions } from './chatSessionArchiveNudge.js';
import { ChatSelectedTools } from './chatSelectedTools.js';
import { ChatPetAchievementIds, didExplicitlySwitchChatPetModel } from '../../chatPetAchievements.js';
import { IChatPetService } from '../../chatPetService.js';
import { ModelPickerActionItem, IModelPickerDelegate, IModelPickerPresentationOptions } from './modelPicker/modelPickerActionItem.js';
import { IModePickerDelegate, ModePickerActionItem } from './modePickerActionItem.js';
import { IPermissionPickerDelegate, PermissionPickerActionItem } from './permissionPickerActionItem.js';
import { WorkspacePickerActionItem } from './workspacePickerActionItem.js';
import { ChatContextUsageWidget } from '../../widgetHosts/viewPane/chatContextUsageWidget.js';
import { Target } from '../../../common/promptSyntax/promptTypes.js';
import { ConfigureToolsAction } from '../../actions/chatToolActions.js';
import { InlineCompletionsController } from '../../../../../../editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.js';
import { PlaceholderTextContribution } from '../../../../../../editor/contrib/placeholderText/browser/placeholderTextContribution.js';

const $ = dom.$;

const INPUT_EDITOR_MAX_HEIGHT = 250;
const INPUT_EDITOR_LINE_HEIGHT = 20;
const INPUT_EDITOR_PADDING = { compact: { top: 2, bottom: 2 }, default: { top: 12, bottom: 12 } };
const CachedLanguageModelsKey = 'chat.cachedLanguageModels.v2';
const PERMISSION_LEVEL_OPTION_ID = 'permissionLevel';
const CHAT_INPUT_COMPACT_PICKER_WIDTH = 22;

function getToolbarPickerResponsiveItems(
	toolbar: MenuWorkbenchToolBar,
	compactStates: ReadonlyMap<string, ISettableObservable<boolean>>,
	minimalStates?: ReadonlyMap<string, ISettableObservable<boolean>>,
): IChatInputPickerResponsiveLayoutItem[] {
	const items: IChatInputPickerResponsiveLayoutItem[] = [];
	const visibleActionIds = new Set<string>();

	for (let index = 0; index < toolbar.getItemsLength(); index++) {
		const action = toolbar.getItemAction(index);
		const state = action && compactStates.get(action.id);
		const minimalState = action && minimalStates?.get(action.id);
		const viewItem = toolbar.getItemViewItem(index);
		const viewItemState = isChatInputPickerResponsiveState(viewItem) ? viewItem : undefined;
		if (!action || (!state && !viewItemState)) {
			continue;
		}
		visibleActionIds.add(action.id);
		const element = toolbar.getItemElement(index);
		items.push({
			element,
			canShrink: action.id === OpenModelPickerAction.ID,
			isCompact: () => viewItemState?.isCompact() ?? state!.get(),
			isMinimal: minimalState ? () => minimalState.get() : undefined,
			setCompact: compact => {
				state?.set(compact, undefined);
				viewItemState?.setCompact(compact);
				element?.classList.toggle('compact-picker', compact);
			},
			setMinimal: minimalState ? minimal => minimalState.set(minimal, undefined) : undefined,
		});
	}

	for (const [actionId, state] of compactStates) {
		if (!visibleActionIds.has(actionId)) {
			const minimalState = minimalStates?.get(actionId);
			items.push({
				element: undefined,
				isCompact: () => state.get(),
				isMinimal: minimalState ? () => minimalState.get() : undefined,
				setCompact: compact => state.set(compact, undefined),
				setMinimal: minimalState ? minimal => minimalState.set(minimal, undefined) : undefined,
			});
		}
	}

	return items;
}

type ShowableActionViewItem = IActionViewItem & { show(anchor?: HTMLElement): void };

function isShowableActionViewItem(item: IActionViewItem | undefined): item is ShowableActionViewItem {
	return !!item && 'show' in item && typeof item.show === 'function';
}

function createOverflowAction(action: IAction, run: () => void): IAction {
	return {
		id: action.id,
		label: action.label,
		tooltip: action.tooltip,
		class: action.class,
		enabled: action.enabled,
		checked: action.checked,
		run,
	};
}

export interface IChatInputStyles {
	overlayBackground: string;
	listForeground: string;
	listBackground: string;
	listShadow?: string;
}

export interface IChatPetHorizontalPlatformProvider {
	readonly onDidChange: Event<void>;
	getElements(): readonly HTMLElement[];
}

export interface IChatInputPartOptions {
	defaultMode?: IChatMode;
	renderFollowups: boolean;
	renderStyle?: 'compact';
	renderInputToolbarBelowInput: boolean;
	menus: {
		executeToolbar: MenuId;
		telemetrySource: string;
		inputToolbar?: MenuId;
		inputSideToolbar?: MenuId;
	};
	editorOverflowWidgetsDomNode?: HTMLElement;
	renderWorkingSet: boolean;
	enableImplicitContext?: boolean;
	supportsChangingModes?: boolean;
	dndContainer?: HTMLElement;
	inputEditorMinLines?: number;
	inputEditorQuickSuggestions?: IEditorOptions['quickSuggestions'];
	deferredNotificationsEnabled?: boolean;
	isTransientChat?: boolean;
	widgetViewKindTag: string;
	sessionTypePickerDelegate?: ISessionTypePickerDelegate;
	workspacePickerDelegate?: IWorkspacePickerDelegate;
	secondaryToolbarActionViewItemProvider?: (action: IAction, options?: IActionViewItemOptions) => IActionViewItem | undefined;
	secondaryToolbarOverflowActionHandler?: (actionId: string, anchor: HTMLElement) => boolean;
	suppressModePreferredModel?: boolean;
	/**
	 * When true, model picks via the picker do not write to global storage.
	 * Note: `switchToNextModel` keybindings still persist globally.
	 */
	suppressModelPersistence?: boolean;
	inputPartHorizontalPadding?: number;
}

export interface IWorkingSetEntry {
	uri: URI;
}

export const enum ChatWidgetLocation {
	SidebarLeft = 'sidebarLeft',
	SidebarRight = 'sidebarRight',
	Panel = 'panel',
	Editor = 'editor',
}

export interface IChatWidgetLocationInfo {
	readonly location: ChatWidgetLocation;
	readonly isMaximized: boolean;
}

export interface IChatModeChangeEvent {
	readonly isUserInitiated: boolean;
}

const LEGACY_SHARED_INPUT_STATE_TAGS = new Set(['view', 'editor', 'quick']);

function getInputStateStorageKey(widgetViewKindTag: string): string {
	if (LEGACY_SHARED_INPUT_STATE_TAGS.has(widgetViewKindTag)) {
		return 'chat.untitledInputState';
	}
	return `chat.untitledInputState.${widgetViewKindTag}`;
}

function createEmptyInputStateMemento(widgetViewKindTag: string) {
	return observableMemento<IChatModelInputState | undefined>({
		defaultValue: undefined,
		key: getInputStateStorageKey(widgetViewKindTag),
		toStorage: serializeUntitledInputState,
		fromStorage(value) {
			const obj = deserializeUntitledInputState(value);
			if (obj.selectedModel && !obj.selectedModel.metadata.isDefaultForLocation) {
				type OldILanguageModelChatMetadata = ILanguageModelChatMetadata & { isDefault?: boolean };
				const oldIsDefault = (obj.selectedModel.metadata as OldILanguageModelChatMetadata).isDefault;
				const isDefaultForLocation = { [ChatAgentLocation.Chat]: Boolean(oldIsDefault) };
				mixin(obj.selectedModel.metadata, { isDefaultForLocation: isDefaultForLocation } satisfies Partial<ILanguageModelChatMetadata>);
				delete (obj.selectedModel.metadata as OldILanguageModelChatMetadata).isDefault;
			}
			return obj;
		},
	});
}

const emptyInputAttachments = observableMemento<readonly IChatRequestVariableEntry[]>({
	defaultValue: [],
	key: 'chat.untitledInputAttachments',
	toStorage: serializeUntitledInputAttachments,
	fromStorage: deserializeUntitledInputAttachments,
});

export class ChatInputPart extends Disposable implements IHistoryNavigationWidget {
	private static _counter = 0;

	private _workingSetCollapsed = observableValue('chatInputPart.workingSetCollapsed', true);
	private readonly _chatInputTodoListWidget = this._register(new MutableDisposable<ChatTodoListWidget>());
	private readonly _chatArtifactsWidget = this._register(new MutableDisposable<ChatArtifactsWidget>());
	private readonly _chatQuestionCarouselWidgets = this._register(new DisposableMap<string, ChatQuestionCarouselPart>());
	private readonly _questionCarouselResponseIds = new Map<string, string>();
	private readonly _questionCarouselSessionResources = new Map<string, URI>();
	private _hasQuestionCarouselContextKey: IContextKey<boolean> | undefined;
	private readonly _chatPlanReviewWidgets = this._register(new DisposableMap<string, ChatPlanReviewPart>());
	private readonly _planReviewResponseIds = new Map<string, string>();
	private readonly _planReviewSessionResources = new Map<string, URI>();
	private readonly _chatToolConfirmationCarousels = this._register(new DisposableMap<string, ChatToolConfirmationCarouselPart>());
	private readonly _onDidChangeActiveConfirmationSubagent = this._register(new Emitter<string | undefined>());
	readonly onDidChangeActiveConfirmationSubagent = this._onDidChangeActiveConfirmationSubagent.event;
	private readonly _chatEditingTodosDisposables = this._register(new DisposableStore());

	private _onDidLoadInputState: Emitter<void> = this._register(new Emitter());
	readonly onDidLoadInputState: Event<void> = this._onDidLoadInputState.event;
	private readonly _toolbarRelayoutScheduler = this._register(new RunOnceScheduler(() => {
		this.layoutForToolbarChange();
	}, 0));

	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus: Event<void> = this._onDidFocus.event;

	private _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur: Event<void> = this._onDidBlur.event;

	private _onDidChangeContext = this._register(new Emitter<{ removed?: IChatRequestVariableEntry[]; added?: IChatRequestVariableEntry[] }>());
	readonly onDidChangeContext: Event<{ removed?: IChatRequestVariableEntry[]; added?: IChatRequestVariableEntry[] }> = this._onDidChangeContext.event;

	private _onDidAcceptFollowup = this._register(new Emitter<{ followup: IChatFollowup; response: IChatResponseViewModel | undefined }>());
	readonly onDidAcceptFollowup: Event<{ followup: IChatFollowup; response: IChatResponseViewModel | undefined }> = this._onDidAcceptFollowup.event;

	private _onDidClickOverlay = this._register(new Emitter<void>());
	readonly onDidClickOverlay: Event<void> = this._onDidClickOverlay.event;

	private readonly _attachmentModel: ChatAttachmentModel;
	private _widget?: IChatWidget;
	public get attachmentModel(): ChatAttachmentModel {
		return this._attachmentModel;
	}

	readonly selectedToolsModel: ChatSelectedTools;

	public getAttachedContext() {
		const contextArr = new ChatRequestVariableSet();
		contextArr.add(...this.attachmentModel.attachments, ...this.chatContextService.getWorkspaceContextItems());
		return contextArr;
	}

	public getAttachedAndImplicitContext(): ChatRequestVariableSet {

		const contextArr = this.getAttachedContext();

		if (this.implicitContext) {
			const implicitChatVariables = this.implicitContext.enabledBaseEntries(this.configurationService.getValue<boolean>('chat.implicitContext.suggestedContext'));
			contextArr.add(...implicitChatVariables);
		}
		return contextArr;
	}

	private _indexOfLastAttachedContextDeletedWithKeyboard: number = -1;
	private _indexOfLastOpenedContext: number = -1;

	private _implicitContext: ChatImplicitContexts | undefined;
	public get implicitContext(): ChatImplicitContexts | undefined {
		return this._implicitContext;
	}

	private _hasFileAttachmentContextKey: IContextKey<boolean>;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	private readonly _contextResourceLabels: ResourceLabels;

	private readonly inputEditorMaxHeight: number;
	private readonly inputEditorMinHeight: number | undefined;
	private readonly singleLineInputEditorHeight: number;
	private inputEditorHeight: number = 0;
	private ignoreInputEditorContentSizeChanges = false;
	private _maxHeight: number | undefined;
	private container!: HTMLElement;

	private inputSideToolbarContainer?: HTMLElement;
	private secondaryToolbarContainer!: HTMLElement;
	private secondaryToolbar!: MenuWorkbenchToolBar;
	private statusToolbarContainer!: HTMLElement;
	private statusToolbar!: MenuWorkbenchToolBar;

	private followupsContainer!: HTMLElement;
	private readonly followupsDisposables: DisposableStore = this._register(new DisposableStore());

	private attachmentsContainer!: HTMLElement;

	private chatInputOverlay!: HTMLElement;
	private readonly overlayClickListener: MutableDisposable<IDisposable> = this._register(new MutableDisposable<IDisposable>());

	private attachedContextContainer!: HTMLElement;
	private readonly attachedContextDisposables: MutableDisposable<DisposableStore> = this._register(new MutableDisposable<DisposableStore>());

	private skillChipsContainer!: HTMLElement;
	private readonly _activeSkills = new Set<string>();

	private chatEditingSessionWidgetContainer!: HTMLElement;
	private chatInputTodoListWidgetContainer!: HTMLElement;
	private chatArtifactsWidgetContainer!: HTMLElement;
	private chatGettingStartedTipContainer!: HTMLElement;
	private chatQuestionCarouselContainer!: HTMLElement;
	private chatPlanReviewContainer!: HTMLElement;
	private chatToolConfirmationCarouselContainer!: HTMLElement;
	private chatInputNotificationContainer!: HTMLElement;
	private chatGoalBannerContainer!: HTMLElement;
	private persistentContentContainer!: HTMLElement;
	private sessionArchiveNudgeContainer: HTMLElement | undefined;
	private sessionArchiveNudgeOptions: IChatSessionArchiveNudgeOptions | undefined;
	private readonly sessionArchiveNudgeWidget = this._register(new MutableDisposable<ChatSessionArchiveNudge>());
	private readonly _chatPetHorizontalPlatformProviders = new Set<IChatPetHorizontalPlatformProvider>();
	private readonly _onDidChangeChatPetHorizontalPlatforms = this._register(new Emitter<void>());
	readonly onDidChangeChatPetHorizontalPlatforms = this._onDidChangeChatPetHorizontalPlatforms.event;
	private inputContainer!: HTMLElement;
	private inputAndSideToolbar!: HTMLElement;
	private readonly _notificationWidget = this._register(new MutableDisposable<ChatInputNotificationWidget>());
	private readonly _goalBannerWidget = this._register(new MutableDisposable<ChatGoalBannerWidget>());
	private readonly _onDidDismissGoalBanner = this._register(new Emitter<void>());
	readonly onDidDismissGoalBanner: Event<void> = this._onDidDismissGoalBanner.event;

	private contextUsageWidget?: ChatContextUsageWidget;
	private contextUsageWidgetContainer!: HTMLElement;
	private readonly _contextUsageDisposables = this._register(new MutableDisposable<DisposableStore>());

	get inputContainerElement(): HTMLElement | undefined {
		return this.inputContainer;
	}

	get inputRowHeight(): number {
		return this.inputAndSideToolbar.offsetHeight;
	}

	get persistentContentContainerElement(): HTMLElement {
		return this.persistentContentContainer;
	}

	get hasSessionArchiveNudge(): boolean {
		return !!this.sessionArchiveNudgeWidget.value;
	}

	setSessionArchiveNudge(options: IChatSessionArchiveNudgeOptions | undefined): void {
		this.sessionArchiveNudgeOptions = options;
		if (!this.sessionArchiveNudgeContainer) {
			return;
		}

		if (!options) {
			const restoreFocus = this.sessionArchiveNudgeWidget.value && dom.isAncestorOfActiveElement(this.sessionArchiveNudgeWidget.value.domNode);
			this.sessionArchiveNudgeWidget.clear();
			if (restoreFocus) {
				this.focus();
			}
			return;
		}

		const widgetOptions: IChatSessionArchiveNudgeOptions = {
			...options,
			onDismiss: () => {
				this.focus();
				this.setSessionArchiveNudge(undefined);
				options.onDismiss();
			},
		};
		if (this.sessionArchiveNudgeWidget.value) {
			this.sessionArchiveNudgeWidget.value.setOptions(widgetOptions);
		} else {
			const widget = this.sessionArchiveNudgeWidget.value = this.instantiationService.createInstance(ChatSessionArchiveNudge, widgetOptions);
			this.sessionArchiveNudgeContainer.appendChild(widget.domNode);
		}
	}

	get gettingStartedTipContainerElement(): HTMLElement {
		return this.chatGettingStartedTipContainer;
	}

	readonly noticeHost = this._register(new ChatInputNoticeHost(() => this.focus()));

	registerChatPetHorizontalPlatformProvider(provider: IChatPetHorizontalPlatformProvider): IDisposable {
		this._chatPetHorizontalPlatformProviders.add(provider);
		const store = new DisposableStore();
		store.add(provider.onDidChange(() => this._onDidChangeChatPetHorizontalPlatforms.fire()));
		store.add(toDisposable(() => {
			this._chatPetHorizontalPlatformProviders.delete(provider);
			this._onDidChangeChatPetHorizontalPlatforms.fire();
		}));
		this._onDidChangeChatPetHorizontalPlatforms.fire();
		return store;
	}

	getChatPetPlatformTop(petCenterX?: number): number {
		if (petCenterX !== undefined) {
			const pillBounds: DOMRect[] = [];
			for (const provider of this._chatPetHorizontalPlatformProviders) {
				for (const element of provider.getElements()) {
					pillBounds.push(element.getBoundingClientRect());
				}
			}
			const pillTop = getChatPetPillPlatformTop(
				petCenterX,
				pillBounds
			);
			if (pillTop !== undefined) {
				return pillTop;
			}
		}
		return getChatPetStackPlatformTop(this.container, this.inputContainer, this.persistentContentContainer);
	}

	readonly height = observableValue<number>(this, 0);

	private _inputEditor!: CodeEditorWidget;
	private _inputEditorElement!: HTMLElement;
	private _forceVisibleScrollbarUntilAccept = false;

	private _inputModel: IInputModel | undefined;
	private _inputModelSessionResource: URI | undefined;
	private readonly _unboundIntent = new IntendedModelSlot();

	private _restorePerTypeModel = false;

	private get _intentHolder(): IIntendedModelHolder {
		return this._inputModel ?? this._unboundIntent;
	}

	private _restoreReasonFor(model: ILanguageModelChatMetadataAndIdentifier): RestoredModelReason {
		const intended = this._intentHolder.intendedModel;
		return intended?.modelId === model.identifier && isInConversationModelChoice(intended.reason)
			? ModelSelectionReason.RestoredChoice
			: ModelSelectionReason.SessionRestore;
	}

	private readonly _modelSyncDisposables = this._register(new DisposableStore());
	private readonly _currentChatModes = this._register(new MutableDisposable<IChatModes & IDisposable>());

	private _isSyncingToOrFromInputModel = false;

	private readonly _syncTextDebounced: RunOnceScheduler;

	private executeToolbar!: MenuWorkbenchToolBar;
	private inputActionsToolbar!: MenuWorkbenchToolBar;
	private _inputPickerResponsiveLayout: ChatInputPickerResponsiveLayout | undefined;
	private _secondaryPickerResponsiveLayout: ChatInputPickerResponsiveLayout | undefined;



	get inputEditor() {
		return this._inputEditor;
	}

	setHistoryKey(historyKey: string | undefined): void {
		this.history.setHistoryKey(historyKey);
	}

	readonly dnd: ChatDragAndDrop;

	private history: ChatHistoryNavigator;
	private historyNavigationBackwardsEnablement!: IContextKey<boolean>;
	private historyNavigationForewardsEnablement!: IContextKey<boolean>;
	private inputModel: ITextModel | undefined;
	private inputEditorHasText: IContextKey<boolean>;
	private inputEditorHasSendableContent: IContextKey<boolean>;
	private chatCursorAtTop: IContextKey<boolean>;
	private inputEditorHasFocus: IContextKey<boolean>;
	private currentlyEditingInputKey!: IContextKey<boolean>;
	private editingSentRequestKey!: IContextKey<ChatContextKeys.EditingRequestType | undefined>;
	private chatModeKindKey: IContextKey<ChatModeKind>;
	private chatModeNameKey: IContextKey<string>;
	private chatModelIdKey: IContextKey<string>;
	private withinEditSessionKey: IContextKey<boolean>;
	private filePartOfEditSessionKey: IContextKey<boolean>;
	private chatSessionHasOptions: IContextKey<boolean>;
	private chatSessionOptionsValid: IContextKey<boolean>;
	private agentSessionTypeKey: IContextKey<string>;
	private chatSessionSupportsDelegationKey: IContextKey<boolean>;
	private chatHasPendingDelegationTargetKey: IContextKey<boolean>;
	private chatSessionHasCustomAgentTarget: IContextKey<boolean>;
	private chatSessionHasTargetedModels: IContextKey<boolean>;
	private modelWidget: ModelPickerActionItem | undefined;
	private modeWidget: ModePickerActionItem | undefined;
	private readonly modeWidgetDisposable = this._register(new MutableDisposable<ModePickerActionItem>());
	private permissionWidget: PermissionPickerActionItem | undefined;
	private readonly permissionWidgetDisposeListener = this._register(new MutableDisposable<IDisposable>());
	private readonly overflowPickerWidget = this._register(new MutableDisposable<IDisposable>());

	private readonly chatSessionPickerWidgets = this._register(new DisposableMap<string, ChatSessionPickerActionItem>());
	private chatSessionPickerContainer: HTMLElement | undefined;
	private _lastSessionPickerAction: MenuItemAction | undefined;
	private _lastSessionPickerOptions: IChatInputPickerOptions | undefined;
	private readonly _chatSessionOptionEmitters = this._register(new DisposableMap<string, Emitter<IChatSessionProviderOptionItem>>());

	private _scopedContextKeyService: IContextKeyService | undefined;

	private readonly _optionContextKeys: Map<string, IContextKey<string>> = new Map();

	private readonly _modelSelectionDiagnostics: ChatModelSelectionDiagnostics;
	private readonly _modelSelectionController: ChatInputModelSelectionController;
	private readonly _currentLanguageModel: IObservable<ILanguageModelChatMetadataAndIdentifier | undefined>;
	private readonly _modelSelectionRuntime: IChatInputModelSelectionRuntime;

	private readonly _modelConfigStore: ChatModelConfigurationStore;

	get currentLanguageModel() {
		return this._currentLanguageModel.get()?.identifier;
	}

	get selectedLanguageModel(): IObservable<ILanguageModelChatMetadataAndIdentifier | undefined> {
		return this._currentLanguageModel;
	}

	get availableLanguageModels(): readonly ILanguageModelChatMetadataAndIdentifier[] {
		return this.getModels();
	}

	private _onDidChangeCurrentChatMode: Emitter<IChatModeChangeEvent> = this._register(new Emitter<IChatModeChangeEvent>());
	readonly onDidChangeCurrentChatMode: Event<IChatModeChangeEvent> = this._onDidChangeCurrentChatMode.event;

	private readonly _currentModeObservable: ISettableObservable<IChatMode>;
	private readonly _currentChatModesObservable: ISettableObservable<IChatModes>;
	private readonly _currentPermissionLevel: ISettableObservable<ChatPermissionLevel>;
	private permissionLevelKey: IContextKey<ChatPermissionLevel>;

	public get currentModeKind(): ChatModeKind {
		const mode = this._currentModeObservable.get();
		return mode.kind === ChatModeKind.Agent && !this.agentService.hasToolsAgent ?
			ChatModeKind.Edit :
			mode.kind;
	}

	public get currentModeObs(): IObservable<IChatMode> {
		return this._currentModeObservable;
	}

	public get currentChatModesObs(): IObservable<IChatModes> {
		return this._currentChatModesObservable;
	}

	public get currentPermissionLevelObs(): IObservable<ChatPermissionLevel> {
		return this._currentPermissionLevel;
	}

	public get currentModeInfo(): IChatRequestModeInfo {
		const mode = this._currentModeObservable.get();
		const modeId: 'ask' | 'agent' | 'edit' | 'custom' | undefined = mode.isBuiltin ? this.currentModeKind : 'custom';

		const modeInstructions = mode.modeInstructions?.get();
		return {
			kind: this.currentModeKind,
			isBuiltin: mode.isBuiltin,
			modeInstructions: modeInstructions ? {
				uri: mode.uri?.get(),
				name: mode.name.get(),
				content: modeInstructions.content,
				toolReferences: this.toolService.toToolReferences(modeInstructions.toolReferences),
				allowedSubagents: mode.agents?.get(),
				metadata: modeInstructions.metadata,
				isBuiltin: mode.isBuiltin
			} : undefined,
			telemetryModeId: modeId,
			telemetryModeName: getModeNameForTelemetry(mode),
			applyCodeBlockSuggestionId: undefined,
			permissionLevel: this._currentPermissionLevel.get(),
		};
	}

	private cachedWidth: number | undefined;
	private cachedExecuteToolbarWidth: number | undefined;
	private cachedInputToolbarWidth: number | undefined;

	readonly inputUri: URI = URI.parse(`${Schemas.vscodeChatInput}:input-${ChatInputPart._counter++}`);

	private _workingSetLinesAddedSpan = new Lazy(() => dom.$('.working-set-lines-added'));
	private _workingSetLinesRemovedSpan = new Lazy(() => dom.$('.working-set-lines-removed'));

	private readonly _chatEditsActionsDisposables: DisposableStore = this._register(new DisposableStore());
	private readonly _chatEditsDisposables: DisposableStore = this._register(new DisposableStore());
	private readonly _renderingChatEdits = this._register(new MutableDisposable());

	private _chatEditsListPool: CollapsibleListPool;
	private _chatEditList: IDisposableReference<WorkbenchList<IChatCollapsibleListItem>> | undefined;
	get selectedElements(): URI[] {
		const edits = [];
		const editsList = this._chatEditList?.object;
		const selectedElements = editsList?.getSelectedElements() ?? [];
		for (const element of selectedElements) {
			if (element.kind === 'reference' && URI.isUri(element.reference)) {
				edits.push(element.reference);
			}
		}
		return edits;
	}

	private _attemptedWorkingSetEntriesCount: number = 0;
	public get attemptedWorkingSetEntriesCount() {
		return this._attemptedWorkingSetEntriesCount;
	}

	public get pendingDelegationTarget(): string | undefined {
		return this._pendingDelegationTarget;
	}

	private _generating?: { rc: number; defer: DeferredPromise<void> };

	private _emptyInputState: ObservableMemento<IChatModelInputState | undefined>;
	private _emptyInputAttachments: ObservableMemento<readonly IChatRequestVariableEntry[]>;
	private _chatSessionIsEmpty = false;
	private readonly _pendingDelegationTargetObservable = observableValue<string | undefined>(this, undefined);
	private get _pendingDelegationTarget(): string | undefined { return this._pendingDelegationTargetObservable.get(); }
	private set _pendingDelegationTarget(value: string | undefined) { this._pendingDelegationTargetObservable.set(value, undefined); }

	private readonly _currentSessionTypeObservable = observableValue<string | undefined>(this, undefined);
	private get _currentSessionType(): string | undefined { return this._currentSessionTypeObservable.get(); }
	private set _currentSessionType(value: string | undefined) { this._currentSessionTypeObservable.set(value, undefined); }
	private readonly _currentSessionResourceObservable = observableValue<URI | undefined>(this, undefined);
	private readonly _currentSessionModelObservable = observableValue<IChatModel | undefined>(this, undefined);
	private readonly _deferredNotificationsEnabled = observableValue(this, true);
	private readonly _notificationAvailableLanguageModels = observableValue<readonly ILanguageModelChatMetadataAndIdentifier[]>(this, []);
	private readonly _notificationModelState = derived(this, reader => {
		const models = this._notificationAvailableLanguageModels.read(reader);
		const currentModel = this.selectedLanguageModel.read(reader);
		return {
			currentModel: models.find(model => model.identifier === currentModel?.identifier),
			models,
		};
	});
	private _isFirstWorkbenchSession: boolean | undefined;

	private readonly _sessionStarted = derived(this, reader => {
		const model = this._currentSessionModelObservable.read(reader);
		return isSessionStarted(!!model, !!model?.lastRequestObs.read(reader));
	});

	private readonly _notificationModelTargetChatSessionType = derived(this, reader =>
		this._pendingDelegationTargetObservable.read(reader)
		?? this._currentSessionTypeObservable.read(reader)
		?? this.getCurrentSessionType()
	);
	constructor(
		private readonly location: ChatAgentLocation,
		private readonly options: IChatInputPartOptions,
		styles: IChatInputStyles,
		private readonly inline: boolean,
		@IModelService private readonly modelService: IModelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@IThemeService private readonly themeService: IThemeService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IStorageService private readonly storageService: IStorageService,
		@IDialogService private readonly dialogService: IDialogService,
		@IChatAgentService private readonly agentService: IChatAgentService,
		@ISharedWebContentExtractorService private readonly sharedWebExtracterService: ISharedWebContentExtractorService,
		@IChatEntitlementService private readonly entitlementService: IChatEntitlementService,
		@IChatModeService private readonly chatModeService: IChatModeService,
		@ILanguageModelToolsService private readonly toolService: ILanguageModelToolsService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@IChatContextService private readonly chatContextService: IChatContextService,
		@IChatSpeechToTextService private readonly speechToTextService: IChatSpeechToTextService,
		@IDictationOnboardingService private readonly dictationOnboardingService: IDictationOnboardingService,
		@IChatInputNoticeHubService private readonly chatInputNoticeHubService: IChatInputNoticeHubService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ISCMService _scmService: ISCMService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IChatAttachmentWidgetRegistry private readonly _chatAttachmentWidgetRegistry: IChatAttachmentWidgetRegistry,
		@IChatInputNotificationService private readonly chatInputNotificationService: IChatInputNotificationService,
		@IVoiceModeOnboardingService private readonly voiceModeOnboardingService: IVoiceModeOnboardingService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IVoiceSessionController private readonly voiceSessionController: IVoiceSessionController,
		@IChatService private readonly chatService: IChatService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IChatPetService private readonly chatPetService: IChatPetService,
		@IActionViewItemService private readonly actionViewItemService: IActionViewItemService,
	) {
		super();
		this._modelSelectionDiagnostics = new ChatModelSelectionDiagnostics(this.logService, this.storageService, () => ({
			surface: 'workbench',
			location: this.location,
			modelTarget: this.getSelectedModelTarget(),
			sessionKey: this.getCurrentSessionType(),
			conversationKey: this._inputModelSessionResource?.toString(),
			metadata: { widgetViewKind: this.options.widgetViewKindTag },
		}));
		this._modelSelectionRuntime = {
			getCurrentSessionType: () => this._currentSessionType ?? this.getCurrentSessionType(),
			isEmpty: () => !this._inputModel || this._chatSessionIsEmpty,
			getModels: sessionType => this.getModelsForSessionType(sessionType),
			getAllModels: () => this.getAllMergedModels(),
			isAwaitingSessionModels: sessionType => this.chatSessionsService.requiresCustomModelsForSessionType(sessionType)
				&& !hasModelsTargetingSession(this.getAllMergedModels(), sessionType),
			getConfiguredModelValue: () => this.getConfiguredModelValue(),
			isModelSupportedHere: model => isModelSupportedForMode(model, this.currentModeKind) && isModelSupportedForInlineChat(model, this.location),
			getDeclaredDefaultModel: models => models.find(model => model.metadata.isDefaultForLocation[this.location]),
			subscribeToModelChanges: listener => this.languageModelsService.onDidChangeLanguageModels(listener),
			getBoundConversationKey: () => this._inputModelSessionResource?.toString(),
			getIntentHolder: () => this._intentHolder,
			restoreModelConfiguration: (modelId, configuration) => this.restoreModelConfiguration(modelId, configuration),
			applyModel: () => {
				if (this.cachedWidth) {
					this.layout(this.cachedWidth);
				}
				this._syncInputStateToModel();
			},
		};
		this._modelSelectionController = this._register(new ChatInputModelSelectionController(this._modelSelectionRuntime, this._modelSelectionDiagnostics));
		this._currentLanguageModel = this._modelSelectionController.currentModel;
		this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, undefined, this._store)(event => {
			this._modelSelectionDiagnostics.logStorageChange(event, this._currentLanguageModel.get()?.identifier);
		}));

		this._modelConfigStore = this._register(new ChatModelConfigurationStore(
			() => this.getModelConfigurationStorageKey(),
			this.languageModelsService,
			this.storageService,
		));

		this._syncTextDebounced = this._register(new RunOnceScheduler(() => {
			logChangesToStateModel(this._inputModel, `[DEBOUNCE] _syncTextDebounced fired -> _syncInputStateToModel in ${this._currentSessionKey}`, undefined, this._inputModel?.state.get(), this.logService);
			this._syncInputStateToModel();
		}, 150));
		this._emptyInputState = this._register(createEmptyInputStateMemento(this.options.widgetViewKindTag)(StorageScope.WORKSPACE, StorageTarget.USER, this.storageService));
		this._emptyInputAttachments = this._register(emptyInputAttachments(StorageScope.WORKSPACE, StorageTarget.USER, this.storageService));

		this._contextResourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this._onDidChangeVisibility.event }));
		this._currentModeObservable = observableValue<IChatMode>('currentMode', this.options.defaultMode ?? ChatMode.Agent);
		const localModes = this.chatModeService.createModes(LocalChatSessionUri.getNewSessionUri());
		this._currentChatModes.value = localModes;
		this._currentChatModesObservable = observableValue<IChatModes>('currentChatModes', localModes);
		this._currentPermissionLevel = observableValue<ChatPermissionLevel>('permissionLevel', this.getDefaultPermissionLevel());
		const languageModelListChanged = observableSignalFromEvent(this, Event.any(
			this.languageModelsService.onDidChangeLanguageModels,
			this.languageModelsService.onDidChangeModelVisibility,
		));
		this._register(autorun(reader => {
			languageModelListChanged.read(reader);
			const sessionType = this._notificationModelTargetChatSessionType.read(reader);
			this._currentModeObservable.read(reader);
			this._notificationAvailableLanguageModels.set(this.getModelsForSessionType(sessionType), undefined);
		}));
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this._indexOfLastOpenedContext = -1;
			this.refreshChatSessionPickers();
		}));

		this._register(this.chatSessionsService.onDidChangeSessionOptions(e => {
			const sessionResource = this._widget?.viewModel?.model.sessionResource;
			if (sessionResource && isEqual(sessionResource, e.sessionResource)) {
				this.refreshChatSessionPickers();
			}
		}));

		this._register(this.chatSessionsService.onDidChangeOptionGroups(chatSessionType => {
			const sessionResource = this._widget?.viewModel?.model.sessionResource;
			if (sessionResource) {
				const delegateSessionType = this.options.sessionTypePickerDelegate?.getActiveSessionProvider?.();
				if (getChatSessionType(sessionResource) === chatSessionType || delegateSessionType === chatSessionType) {
					this.refreshChatSessionPickers();
				}
			}
		}));

		if (this.options.sessionTypePickerDelegate?.onDidChangeActiveSessionProvider) {
			this._register(this.options.sessionTypePickerDelegate.onDidChangeActiveSessionProvider(async (newSessionType) => {
				this._currentSessionType = newSessionType;
				this.getVisibleOptionGroupsModeAndUpdateContextKeys(this.getCurrentSessionResource());
				this.agentSessionTypeKey.set(newSessionType);
				this.chatSessionSupportsDelegationKey.set(this.chatSessionsService.supportsDelegationForSessionType(newSessionType));
				this.updateWidgetLockStateFromSessionType(newSessionType);
				this.checkModeInSessionPool(newSessionType);
				this._modelSelectionController.revalidateForSessionType(() => this.initSelectedModel());
				this.refreshChatSessionPickers();
			}));
		}

		this._attachmentModel = this._register(this.instantiationService.createInstance(ChatAttachmentModel));
		const attachmentModel = this._attachmentModel;
		this._register(this._attachmentModel.onDidChange(() => {
			if (this._chatSessionIsEmpty) {
				this._emptyInputAttachments.set(this._attachmentModel.attachments, undefined);
			}
			this._syncInputStateToModel();
		}));
		this._register(this._modelConfigStore.onDidChange(() => this._syncInputStateToModel()));
		this.selectedToolsModel = this._register(this.instantiationService.createInstance(ChatSelectedTools, this.currentModeObs, this._currentLanguageModel));
		this.dnd = this._register(this.instantiationService.createInstance(ChatDragAndDrop, () => this._widget, {
			get attachments() { return attachmentModel.attachments; },
			addAttachments: (entries: readonly IChatRequestVariableEntry[]) => attachmentModel.addContext(...entries),
		}, styles));

		this.inputEditorMaxHeight = this.options.renderStyle === 'compact' ? INPUT_EDITOR_MAX_HEIGHT / 3 : INPUT_EDITOR_MAX_HEIGHT;
		const padding = this.options.renderStyle === 'compact' ? INPUT_EDITOR_PADDING.compact : INPUT_EDITOR_PADDING.default;
		this.singleLineInputEditorHeight = INPUT_EDITOR_LINE_HEIGHT + padding.top + padding.bottom;
		this.inputEditorMinHeight = this.options.inputEditorMinLines ? this.options.inputEditorMinLines * INPUT_EDITOR_LINE_HEIGHT + padding.top + padding.bottom : undefined;

		this.inputEditorHasText = ChatContextKeys.inputHasText.bindTo(contextKeyService);
		this.inputEditorHasSendableContent = ChatContextKeys.inputHasSendableContent.bindTo(contextKeyService);
		this.chatCursorAtTop = ChatContextKeys.inputCursorAtTop.bindTo(contextKeyService);
		this.inputEditorHasFocus = ChatContextKeys.inputHasFocus.bindTo(contextKeyService);
		this._hasQuestionCarouselContextKey = ChatContextKeys.Editing.hasQuestionCarousel.bindTo(contextKeyService);
		this.chatModeKindKey = ChatContextKeys.chatModeKind.bindTo(contextKeyService);
		this.chatModeNameKey = ChatContextKeys.chatModeName.bindTo(contextKeyService);
		this.chatModelIdKey = ChatContextKeys.chatModelId.bindTo(contextKeyService);
		this.permissionLevelKey = ChatContextKeys.chatPermissionLevel.bindTo(contextKeyService);
		this.permissionLevelKey.set(this._currentPermissionLevel.get());
		this.withinEditSessionKey = ChatContextKeys.withinEditSessionDiff.bindTo(contextKeyService);
		this.filePartOfEditSessionKey = ChatContextKeys.filePartOfEditSession.bindTo(contextKeyService);
		this.chatSessionHasOptions = ChatContextKeys.chatSessionHasModels.bindTo(contextKeyService);
		this.chatSessionOptionsValid = ChatContextKeys.chatSessionOptionsValid.bindTo(contextKeyService);
		this.agentSessionTypeKey = ChatContextKeys.agentSessionType.bindTo(contextKeyService);
		this.chatSessionSupportsDelegationKey = ChatContextKeys.chatSessionSupportsDelegation.bindTo(contextKeyService);
		this.chatHasPendingDelegationTargetKey = ChatContextKeys.hasPendingDelegationTarget.bindTo(contextKeyService);

		if (this.options.sessionTypePickerDelegate?.getActiveSessionProvider) {
			const initialSessionType = this.options.sessionTypePickerDelegate.getActiveSessionProvider();
			if (initialSessionType) {
				this.agentSessionTypeKey.set(initialSessionType);
				this.chatSessionSupportsDelegationKey.set(this.chatSessionsService.supportsDelegationForSessionType(initialSessionType));
			}
		}
		this.chatSessionHasCustomAgentTarget = ChatContextKeys.chatSessionHasCustomAgentTarget.bindTo(contextKeyService);
		this.chatSessionHasTargetedModels = ChatContextKeys.chatSessionHasTargetedModels.bindTo(contextKeyService);

		this.history = this._register(this.instantiationService.createInstance(ChatHistoryNavigator, this.location));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			const newOptions: IEditorOptions = {};
			if (e.affectsConfiguration(ChatConfiguration.GlobalAutoApprove)) {
				this.setPermissionLevel(this._currentPermissionLevel.get());
			}
			if (e.affectsConfiguration(ChatConfiguration.DefaultPermissionLevel)) {
				if (this._chatSessionIsEmpty) {
					this.setPermissionLevel(this.getDefaultPermissionLevel());
				}
			}
			if (e.affectsConfiguration(ChatConfiguration.DefaultModel)) {
				this._modelSelectionController.applyConfiguredDefault();
			}
			if (e.affectsConfiguration(AccessibilityVerbositySettingId.Chat)) {
				newOptions.ariaLabel = this._getAriaLabel();
			}
			if (e.affectsConfiguration('editor.wordSegmenterLocales')) {
				newOptions.wordSegmenterLocales = this.configurationService.getValue<string | string[]>('editor.wordSegmenterLocales');
			}
			if (e.affectsConfiguration('editor.autoClosingBrackets')) {
				newOptions.autoClosingBrackets = this.configurationService.getValue('editor.autoClosingBrackets');
			}
			if (e.affectsConfiguration('editor.autoClosingQuotes')) {
				newOptions.autoClosingQuotes = this.configurationService.getValue('editor.autoClosingQuotes');
			}
			if (e.affectsConfiguration('editor.autoSurround')) {
				newOptions.autoSurround = this.configurationService.getValue('editor.autoSurround');
			}

			this.inputEditor.updateOptions(newOptions);
		}));

		this._chatEditsListPool = this._register(this.instantiationService.createInstance(CollapsibleListPool, this._onDidChangeVisibility.event, MenuId.ChatEditingWidgetModifiedFilesToolbar, { verticalScrollMode: ScrollbarVisibility.Visible }));

		this._hasFileAttachmentContextKey = ChatContextKeys.hasFileAttachments.bindTo(contextKeyService);

		this.initSelectedModel();

		this._register(this._onDidChangeCurrentChatMode.event(() => {
			this._modelSelectionController.ensureCurrentModelSupported();
		}));

		const updateAfterModelListChange = (reconcileSelection: boolean) => {
			const modelIdentifier = this._currentLanguageModel.get()?.identifier;
			const models = this.getModels();
			if (canLog(this.logService.getLevel(), LogLevel.Debug)) {
				const mergedModels = this.getAllMergedModels();
				const filteredModels = filterModelsForSession(models, this.getCurrentSessionType(), this.currentModeKind, this.location);
				const messageparts: string[] = [
					`resetting current language model due to model list change from ${modelIdentifier}`,
					`this._widget?.viewModel?.model.sessionResource = ${this._widget?.viewModel?.model.sessionResource?.toString()}`,
					`this.currentModeKind = ${this.currentModeKind}`,
					`this.getCurrentSessionType = ${this.getCurrentSessionType()}`,
					`this._currentSessionType = ${this._currentSessionType}`,
					`shouldResetOnModelListChange(modelIdentifier, models) = ${shouldResetOnModelListChange(modelIdentifier, models)}`,
					`vendors: ${this.languageModelsService.getVendors().map(v => v.vendor).join(', ')}`,
					`hiddenModelIds: ${this.languageModelsService.getHiddenModelIds().join(', ')}`,
					`model identifiers: ${models.map(m => m.identifier).join(', ')}`,
					`model target Session Types: ${models.map(m => m.metadata.targetChatSessionType || '').join(', ')}`,
					`model metadataid: ${models.map(m => m.metadata.id).join(', ')}`,
					`merged.model identifiers: ${mergedModels.map(m => m.identifier).join(', ')}`,
					`merged.model target Session Types: ${mergedModels.map(m => m.metadata.targetChatSessionType || '').join(', ')}`,
					`merged.model metadataid: ${mergedModels.map(m => m.metadata.id).join(', ')}`,
					`filtered.model identifiers: ${filteredModels.map(m => m.identifier).join(', ')}`,
					`filtered.model target Session Types: ${filteredModels.map(m => m.metadata.targetChatSessionType || '').join(', ')}`,
					`filtered.model metadataid: ${filteredModels.map(m => m.metadata.id).join(', ')}`,
				];
				if (this.getCurrentSessionType() !== SessionType.CopilotCLI) {
					const delegateSessionType = this.options.sessionTypePickerDelegate?.getActiveSessionProvider?.();
					if (delegateSessionType) {
						messageparts.push(`delegateSessionType = ${delegateSessionType}`);
					}
					const sessionResource = this._widget?.viewModel?.model.sessionResource;
					messageparts.push(`current session resource = ${sessionResource}`);
				}

				logChangesToStateModel(this._inputModel, messageparts.join(', '), undefined, undefined, this.logService);
			}
			if (reconcileSelection) {
				this._modelSelectionController.reconcileModelListChange(models);
			}
			this._updateInputContentContextKeys();
		};
		this._register(this.languageModelsService.onDidChangeLanguageModels(() => updateAfterModelListChange(false)));
		this._register(this.languageModelsService.onDidChangeModelVisibility(() => updateAfterModelListChange(true)));

		this._register(this.onDidChangeCurrentChatMode(() => {
			this.accessibilityService.alert(this._currentModeObservable.get().label.get());
			if (this._inputEditor) {
				this._inputEditor.updateOptions({ ariaLabel: this._getAriaLabel() });
			}
			this.setImplicitContextEnablement();
		}));
		this._register(autorun(reader => {
			const lm = this._currentLanguageModel.read(reader);
			this.chatModelIdKey.set(lm?.metadata.id.toLowerCase() ?? '');
			this.contextUsageWidget?.setSelectedModel(lm?.identifier);
			if (lm?.metadata.name) {
				this.accessibilityService.alert(lm.metadata.name);
			}
			this._inputEditor?.updateOptions({ ariaLabel: this._getAriaLabel() });
		}));
		this._register(autorun(reader => {
			const modes = this._currentChatModesObservable.read(reader);
			reader.store.add(modes.onDidChange(() => {
				this.validateCurrentChatMode();
				this._restorePersistedCustomModeIfAvailable();
			}));
		}));
		this._register(autorun(r => {
			const mode = this._currentModeObservable.read(r);
			this.chatModeKindKey.set(mode.kind);
			this.chatModeNameKey.set(mode.name.read(r));
			if (this.options.suppressModePreferredModel) {
				return;
			}
			const models = mode.model?.read(r);
			if (models) {
				this.switchModelByQualifiedName(models);
			}
		}));

		this.validateCurrentChatMode();
	}

	private setImplicitContextEnablement() {
		if (this.implicitContext && this.configurationService.getValue<boolean>('chat.implicitContext.suggestedContext')) {
			this.implicitContext.setEnabled(this._currentModeObservable.get().name.get().toLowerCase() === 'ask');
		}
	}

	public setIsWithinEditSession(inInsideDiff: boolean, isFilePartOfEditSession: boolean) {
		this.withinEditSessionKey.set(inInsideDiff);
		this.filePartOfEditSessionKey.set(isFilePartOfEditSession);
	}

	public setSubmitPending(pending: boolean, blocking: boolean = false): void {
		this.inputEditorHasSendableContent.set(!pending && !!this.inputEditorHasSendableContent.get());
		void blocking;
	}

	private getSelectedModelTarget(): string | undefined {
		const sessionType = this._currentSessionType;
		return sessionType && this.sessionTypeHasOwnModelPool(sessionType) ? sessionType : undefined;
	}

	private sessionTypeHasOwnModelPool(sessionType: string): boolean {
		return this.chatSessionsService.requiresCustomModelsForSessionType(sessionType)
			|| hasModelsTargetingSession(this.getAllMergedModels(), sessionType);
	}

	private initSelectedModel() {
		this._modelConfigStore.clear();

		const storedSelection = getStoredSelectedModel(this.storageService, this.location, this.getSelectedModelTarget());
		this._modelSelectionController.initialize(storedSelection);
	}

	public setEditing(enabled: boolean, editingSentRequest: ChatContextKeys.EditingRequestType | undefined) {
		this.currentlyEditingInputKey?.set(enabled);
		this.editingSentRequestKey?.set(editingSentRequest);
	}

	public switchModel(modelMetadata: Pick<ILanguageModelChatMetadata, 'vendor' | 'id' | 'family'>) {
		const models = this.getModels();
		const model = models.find(m => m.metadata.vendor === modelMetadata.vendor && m.metadata.id === modelMetadata.id && m.metadata.family === modelMetadata.family);
		if (model) {
			this.setCurrentLanguageModel(model, true);
		}
	}

	public switchModelByIdentifier(identifier: string, storeSelection: boolean = false, isUserAction: boolean = false): boolean {
		const models = this.getModels();
		const model = models.find(m => m.identifier === identifier);
		if (model) {
			if (isUserAction) {
				this.setCurrentLanguageModel(model, true, storeSelection);
			} else {
				this._applyProgrammaticLanguageModel(model);
			}
			return true;
		}
		return false;
	}

	public switchModelByQualifiedName(qualifiedModelNames: readonly string[]): boolean {
		const models = this.getModels();
		for (const qualifiedModelName of qualifiedModelNames) {
			const model = models.find(m => ILanguageModelChatMetadata.matchesQualifiedName(qualifiedModelName, m.metadata));
			if (model) {
				this._applyProgrammaticLanguageModel(model);
				return true;
			}
		}
		this.logService.warn(`[chat] Node of the models "${qualifiedModelNames.join(', ')}" not found. Use format "<name> (<vendor>)", e.g. "GPT-4o (copilot)".`);
		return false;
	}

	public requestModelByIdentifier(identifier: string): Promise<boolean> {
		return this._requestProgrammaticLanguageModel(() => this.getModels().find(model => model.identifier === identifier));
	}

	public requestModelByQualifiedName(qualifiedModelNames: readonly string[]): Promise<boolean> {
		return this._requestProgrammaticLanguageModel(() => {
			const models = this.getModels();
			return qualifiedModelNames.map(name => models.find(model => ILanguageModelChatMetadata.matchesQualifiedName(name, model.metadata))).find(isDefined);
		});
	}

	get hasPendingProgrammaticModelSelection(): boolean {
		return this._modelSelectionController.hasPendingProgrammaticSelection();
	}


	public switchToNextModel(): void {
		const models = this.getModels();
		if (models.length > 0) {
			const currentIndex = models.findIndex(model => model.identifier === this._currentLanguageModel.get()?.identifier);
			const nextIndex = (currentIndex + 1) % models.length;
			this.setCurrentLanguageModel(models[nextIndex], true);
		}
	}

	public switchToNextPinnedModel(): void {
		const models = this.getModels();
		if (models.length === 0) {
			return;
		}

		const modelMap = new Map(models.map(model => [model.identifier, model]));
		const pinnedModels = this.languageModelsService
			.getPinnedModelIds()
			.map(modelId => modelMap.get(modelId))
			.filter(isDefined);

		if (pinnedModels.length === 0) {
			return;
		}

		const currentIndex = pinnedModels.findIndex(model => model.identifier === this._currentLanguageModel.get()?.identifier);
		const nextIndex = (currentIndex + 1) % pinnedModels.length;
		this.setCurrentLanguageModel(pinnedModels[nextIndex], true);
	}

	public openModelPicker(): void {
		this.modelWidget?.show();
	}

	public openModePicker(): void {
		this.modeWidget?.show();
	}

	private _createModelPickerDelegate(): IModelPickerDelegate {
		return {
			currentModel: this._currentLanguageModel,
			setModel: (model: ILanguageModelChatMetadataAndIdentifier) => {
				const previousModelIdentifier = this._currentLanguageModel.get()?.identifier;
				this.setCurrentLanguageModel(model, true, !this.options.suppressModelPersistence);
				if (didExplicitlySwitchChatPetModel(previousModelIdentifier, model.identifier)) {
					this.chatPetService.unlockAchievement(ChatPetAchievementIds.ModelSwitch);
				}
				this.renderAttachedContext();
			},
			getModels: () => this.getModels(),
			isCacheWarm: () => (this._widget?.viewModel?.model.getRequests().length ?? 0) > 0,
			getPresentationOptions: () => this._getModelPickerPresentationOptions(),
			modelConfiguration: this._modelConfigStore,
		};
	}

	private _getModelPickerPresentationOptions(): IModelPickerPresentationOptions {
		const sessionType = this.getCurrentSessionType();
		const useRichPicker = !sessionType || sessionType === localChatSessionType;
		return {
			useGroupedModelPicker: useRichPicker,
			showManageModelsAction: useRichPicker,
			showUnavailableFeatured: useRichPicker,
			showFeatured: useRichPicker,
			showAutoModel: this._showAutoModel(),
			showModelIcon: !this._usesHarnessProviderIcon(),
		};
	}

	private _usesHarnessProviderIcon(): boolean {
		const sessionType = this.getCurrentSessionType();
		return sessionType === SessionType.Codex;
	}

	/**
	 * Returns this editor's snapshot of the given model's configuration (e.g.
	 * context size, thinking effort), scoped to this editor rather than the
	 * profile-global value. Delegates to {@link ChatModelConfigurationStore}.
	 * See issue #320393.
	 */
	getModelConfiguration(modelId: string): IStringDictionary<unknown> | undefined {
		return this._modelConfigStore.getModelConfiguration(modelId);
	}

	private restoreModelConfiguration(modelId: string, modelConfiguration: IStringDictionary<unknown> | undefined): void {
		if (modelConfiguration) {
			this._modelConfigStore.restoreModelConfiguration(modelId, modelConfiguration);
		}
	}

	private getModelConfigurationStorageKey(): string {
		const sessionType = this._currentSessionType;
		if (sessionType && this.sessionTypeHasOwnModelPool(sessionType)) {
			return `chat.modelConfiguration.${this.location}.${sessionType}`;
		}
		return `chat.modelConfiguration.${this.location}`;
	}

	private _createModePickerDelegate(): IModePickerDelegate {
		return {
			currentMode: this._currentModeObservable,
			currentChatModes: this._currentChatModesObservable,
			sessionResource: () => this._widget?.viewModel?.sessionResource,
			setMode: (mode: IChatMode) => this.setChatMode2(mode, true),
			customAgentTarget: () => {
				const sessionResource = this._widget?.viewModel?.model.sessionResource;
				return (sessionResource && this.chatSessionsService.getCustomAgentTargetForSessionType(getChatSessionType(sessionResource))) ?? Target.Undefined;
			},
		};
	}

	public openPermissionPicker(): void {
		this.permissionWidget?.show();
	}

	public setPermissionLevel(level: ChatPermissionLevel): void {
		level = this.getPermittedPermissionLevel(level);
		this._currentPermissionLevel.set(level, undefined);
		this.permissionLevelKey.set(level);
		this.permissionWidget?.refresh();
		const sessionResource = this.getCurrentSessionResource();
		if (sessionResource) {
			this.chatSessionsService.setSessionOption(sessionResource, PERMISSION_LEVEL_OPTION_ID, level);
		}
		logChangesToStateModel(this._inputModel, `setPermissionLevel -> _syncInputStateToModel (level=${level}, currentLanguageModel=${this._currentLanguageModel.get()?.identifier}) in ${this._currentSessionKey}`, undefined, undefined, this.logService);
		this._syncInputStateToModel();
	}

	private _createPermissionPickerDelegate(): IPermissionPickerDelegate {
		return {
			// Legacy Autopilot can still control continuation elsewhere, but it is
			// displayed here as the conservative access level and grants no tool access.
			currentPermissionLevel: derived(this, reader => {
				const level = this._currentPermissionLevel.read(reader);
				return level === ChatPermissionLevel.Autopilot ? ChatPermissionLevel.Default : level;
			}),
			setPermissionLevel: (level: ChatPermissionLevel) => this.setPermissionLevel(level),
			availableLevels: [ChatPermissionLevel.Default, ChatPermissionLevel.Assisted, ChatPermissionLevel.AutoApprove],
			getExtensionPermissions: () => {
				const sessionResource = this.getCurrentSessionResource();
				const group = this.getActiveExtensionPermissionGroup(sessionResource);
				if (!group) {
					return undefined;
				}
				const current = sessionResource ? this.chatSessionsService.getSessionOption(sessionResource, group.id) : undefined;
				const defaultId = group.selected?.id ?? group.items.find(item => item.default)?.id;
				const rawSelectedId = current === undefined ? defaultId : typeof current === 'string' ? current : current.id;
				const selectedId = rawSelectedId !== undefined && group.items.some(item => item.id === rawSelectedId) ? rawSelectedId : defaultId;
				const sessionType = sessionResource
					? getChatSessionType(sessionResource)
					: (this.options.sessionTypePickerDelegate?.getActiveSessionProvider?.() ?? '');
				return { sessionType, groupId: group.id, items: group.items, selectedId };
			},
			setExtensionPermission: (groupId: string, item: IChatSessionProviderOptionItem) => {
				this.updateOptionContextKey(groupId, item.id);
				this.getOrCreateOptionEmitter(groupId).fire(item);
				const sessionResource = this.getCurrentSessionResource();
				if (sessionResource) {
					this.chatSessionsService.setSessionOption(sessionResource, groupId, item);
				}
				this.permissionWidget?.refresh();
			},
			isSandboxToggleApplicable: () => this.getEffectiveSessionType(this.getCurrentSessionResource()) === SessionType.Local,
		};
	}

	private getDefaultPermissionLevel(): ChatPermissionLevel {
		const level = this.configurationService.getValue<string>(ChatConfiguration.DefaultPermissionLevel);
		return isChatPermissionLevel(level) ? level : ChatPermissionLevel.Default;
	}

	private getPermittedPermissionLevel(level: ChatPermissionLevel): ChatPermissionLevel {
		if (isAutoApproveValuePolicyRestricted(level, isAutoApprovePolicyRestricted(this.configurationService))) {
			return ChatPermissionLevel.Default;
		}
		return level;
	}

	public openSessionTargetPicker(): void {
	}

	public openChatSessionPicker(): void {
		const firstWidget = this.chatSessionPickerWidgets?.values()?.next().value;
		firstWidget?.show();
	}

	private createChatSessionPickerWidgets(action: MenuItemAction, pickerOptions?: IChatInputPickerOptions): ChatSessionPickerActionItem[] {
		this._lastSessionPickerAction = action;
		this._lastSessionPickerOptions = pickerOptions;

		const sessionResource = this.getCurrentSessionResource();
		const visibleOptionGroups = this.getVisibleOptionGroupsModeAndUpdateContextKeys(sessionResource);
		if (!visibleOptionGroups.length) {
			return [];
		}

		const effectiveSessionType = this.getEffectiveSessionType(sessionResource);
		if (!effectiveSessionType) {
			return [];
		}

		this.chatSessionPickerWidgets.clearAndDisposeAll();

		const widgets: ChatSessionPickerActionItem[] = [];
		for (const optionGroup of visibleOptionGroups) {
			const initialItem = this.getCurrentOptionForGroup(optionGroup.id);
			const initialState = { group: optionGroup, item: initialItem };

			const itemDelegate: IChatSessionPickerDelegate = {
				getCurrentOption: () => this.getCurrentOptionForGroup(optionGroup.id),
				onDidChangeOption: this.getOrCreateOptionEmitter(optionGroup.id).event,
				setOption: (option: IChatSessionProviderOptionItem) => {
					this.updateOptionContextKey(optionGroup.id, option.id);
					this.getOrCreateOptionEmitter(optionGroup.id).fire(option);

					const sessionResource = this._widget?.viewModel?.model.sessionResource;
					if (sessionResource) {
						this.chatSessionsService.setSessionOption(sessionResource, optionGroup.id, option);
					}

					this.refreshChatSessionPickers();
				},
				getOptionGroup: () => {
					const groups = this.chatSessionsService.getOptionGroupsForSessionType(effectiveSessionType);
					return groups?.find(g => g.id === optionGroup.id);
				},
				getSessionResource: () => {
					return this._widget?.viewModel?.model.sessionResource;
				}
			};

			const widget = this.instantiationService.createInstance(ChatSessionPickerActionItem, action, initialState, itemDelegate, pickerOptions);
			this.chatSessionPickerWidgets.set(optionGroup.id, widget);
			widgets.push(widget);
		}

		return widgets;
	}

	setInputModel(model: IInputModel, chatSessionIsEmpty: boolean, forSessionResource: URI): void {
		logChangesToStateModel(this._inputModel, `setInputModel for ${forSessionResource.toString()} (chatSessionIsEmpty=${chatSessionIsEmpty}, outgoing._inputModel=${this._inputModel ? 'present' : 'undefined'})`, model.state.get(), this._inputModel?.state.get(), this.logService);
		if (this._inputModel) {
			logChangesToStateModel(this._inputModel, `[FLUSH-PRE] setInputModel pre-flush boundInputModelSession=${this._inputModelSessionResource?.toString()} widgetSession=${this._currentSessionKey} incoming=${forSessionResource.toString()}`, undefined, this._inputModel.state.get(), this.logService);
			this._syncInputStateToModel();
		}

		this._currentSessionType = getChatSessionType(forSessionResource);
		this._currentSessionModelObservable.set(undefined, undefined);
		this._inputModel = model;
		this._inputModelSessionResource = forSessionResource;
		this._modelSyncDisposables.clear();
		const chatModes = this.chatModeService.createModes(forSessionResource);
		this._currentChatModes.value = chatModes;
		this._currentChatModesObservable.set(chatModes, undefined);
		this.selectedToolsModel.resetSessionEnablementState();
		this._chatSessionIsEmpty = isNewConversation(forSessionResource, chatSessionIsEmpty);
		const ownsPool = !!this._currentSessionType && this.sessionTypeHasOwnModelPool(this._currentSessionType);
		const hadIncomingModel = !!model.state.get()?.selectedModel;
		this._modelSelectionController.beginConversationSwitch();
		this._restorePerTypeModel = shouldRestorePerTypeModelOnSessionSwitch(this._chatSessionIsEmpty, ownsPool, hadIncomingModel);

		if (this._chatSessionIsEmpty) {
			const persistedState = model.state.get() ? undefined : this._getPersistedEmptyInputState();
			if (persistedState) {
				model.setState(persistedState);
				this._syncFromModel(persistedState, forSessionResource);
			}
			this._setEmptyModelState();

			this._modelSyncDisposables.add(this.configurationService.onDidChangeConfiguration(e => {
				if (this._chatSessionIsEmpty && e.affectsConfiguration(ChatConfiguration.DefaultNewSessionMode)) {
					this._setEmptyModelState();
				}
			}));
			this._modelSyncDisposables.add(this._currentChatModesObservable.get().onDidChange(() => {
				if (this._chatSessionIsEmpty) {
					this._setEmptyModelState();
				}
			}));
		}

		const widgetViewModelSession = this._widget?.viewModel?.model.sessionResource;
		const isStaleAtRegistration = !!widgetViewModelSession && !isEqual(widgetViewModelSession, forSessionResource);
		logChangesToStateModel(this._inputModel, `[AUTORUN-REG] registering model->view autorun for ${forSessionResource.toString()}, widgetSession=${this._currentSessionKey}, widgetViewModelSession=${widgetViewModelSession?.toString()}, isStaleAtRegistration=${isStaleAtRegistration}, model.state.selectedModel=${model.state.get()?.selectedModel?.identifier}, _currentLanguageModel=${this._currentLanguageModel.get()?.identifier}`, undefined, undefined, this.logService);

		this._modelSyncDisposables.add(autorun(reader => {
			let state = model.state.read(reader);
			let message = `syncing from model for ${forSessionResource.toString()} in ${this._currentSessionKey}`;
			if (!state && this._chatSessionIsEmpty) {
				state = this._getPersistedEmptyInputState();
				message = `syncing from empty input state for ${forSessionResource.toString()}`;
				if (state) {
					const resolved = this.resolveDraftModel(state.selectedModel, this._currentSessionType, false);
					if (resolved.changed) {
						state = { ...state, selectedModel: resolved.model, modelConfiguration: undefined };
					}
				}
			}
			const widgetSessionResource = this._widget?.viewModel?.model.sessionResource;
			const isStaleSession =
				!!this._inputModelSessionResource && !isEqual(this._inputModelSessionResource, forSessionResource);
			if (isStaleSession) {
				message = `[STALE-SESSION-AUTORUN] ${message} (widget now on ${widgetSessionResource?.toString()}, ${this._inputModelSessionResource?.toString()}, ${forSessionResource.toString()} is old)`;
			}
			const prevState = this._inputModel?.state.read(undefined);
			logChangesToStateModel(this._inputModel, message, state, prevState, this.logService);

			if (isStaleSession) {
				return;
			}
			this._syncFromModel(state, forSessionResource);
		}));
	}

	private _getPersistedEmptyInputState(): IChatModelInputState | undefined {
		let state = this._emptyInputState.read(undefined);
		if (!state) {
			return undefined;
		}

		const persistedAttachments = this._emptyInputAttachments.read(undefined);
		state = {
			...state,
			attachments: persistedAttachments.length > 0 ? persistedAttachments : state.attachments,
		};

		const resolved = this.resolveDraftModel(state.selectedModel, this._currentSessionType, true);
		if (resolved.changed) {
			state = { ...state, selectedModel: resolved.model, modelConfiguration: undefined };
		}

		return state;
	}

	private _setEmptyModelState() {
		logChangesToStateModel(this._inputModel, `setting empty model state for ${this._widget?.viewModel?.sessionResource.toString()} in ${this._currentSessionKey}`, undefined, undefined, this.logService);
		const currentLevel = this._inputModel?.state?.get()?.permissionLevel;
		if (currentLevel === undefined || !isChatPermissionLevel(currentLevel)) {
			this.setPermissionLevel(this.getDefaultPermissionLevel());
		}

		if (this.entitlementService.anonymous) {
			this.setChatMode(ChatModeKind.Agent, false);
			this._modelSelectionController.ensureCurrentModelSupported();
			return;
		}

		const rawDefaultMode = this.configurationService.getValue<string>(ChatConfiguration.DefaultNewSessionMode);
		let targetMode: string = ChatModeKind.Agent;
		if (typeof rawDefaultMode === 'string' && rawDefaultMode.trim()) {
			const defaultMode = rawDefaultMode.trim();
			const defaultModeLower = defaultMode.toLowerCase();
			const modes = this._currentChatModesObservable.get();
			const resolved = modes.findModeById(defaultMode)
				?? modes.findModeByName(defaultMode)
				?? modes.custom.find(m => m.name.get().toLowerCase() === defaultModeLower);
			if (resolved) {
				targetMode = resolved.id;
			}
		}
		this.setChatMode(targetMode, false);
		this._modelSelectionController.ensureCurrentModelSupported();
	}

	private _syncFromModel(state: IChatModelInputState | undefined, forSessionResource: URI): void {
		if (this._isSyncingToOrFromInputModel) {
			return;
		}

		try {
			this._isSyncingToOrFromInputModel = true;

			if (state) {
				const currentMode = this._currentModeObservable.get();
				if (currentMode.id !== state.mode.id) {
					this.setChatMode(state.mode.id, false);
				}
			}

			if (state?.selectedModel) {
				const sessionType = getChatSessionType(forSessionResource);
				this._modelSelectionController.syncFromConversationState(state.selectedModel, state.modelConfiguration, sessionType, forSessionResource.toString(), state.origin === ChatInputStateOrigin.Remote, this._restoreReasonFor(state.selectedModel));
			} else if (state) {
				this._modelSelectionDiagnostics.report('conversation-state-without-model', {
					conversation: forSessionResource.toString(),
					currentModel: this._currentLanguageModel.get()?.identifier,
				});
			}

			const currentAttachments = this._attachmentModel.attachments;
			if (!state) {
				this._attachmentModel.clear();
			} else if (!arraysEqual(currentAttachments, state.attachments)) {
				this._attachmentModel.clearAndSetContext(...state.attachments);
			}

			if (this._inputEditor) {
				this._inputEditor.setValue(state?.inputText || '');
				if (state?.selections.length) {
					this._inputEditor.setSelections(state.selections);
				}
			}

			// Sync permission level (skip if global auto-approve is on, so the picker stays unchanged)
			if (!this.configurationService.getValue<boolean>(ChatConfiguration.GlobalAutoApprove)) {
				const targetLevel = this.getPermittedPermissionLevel(state?.permissionLevel ?? ChatPermissionLevel.Default);
				if (this._currentPermissionLevel.get() !== targetLevel) {
					this._currentPermissionLevel.set(targetLevel, undefined);
					this.permissionLevelKey.set(targetLevel);
					this.permissionWidget?.refresh();
				}
			}

			if (state) {
				this._widget?.contribs.forEach(contrib => {
					contrib.setInputState?.(state.contrib);
				});
			}
		} finally {
			this._isSyncingToOrFromInputModel = false;
			this._syncTextDebounced.cancel();
		}
	}

	private _syncInputStateToModel(): void {
		if (this._isSyncingToOrFromInputModel) {
			return;
		}

		this._isSyncingToOrFromInputModel = true;
		const state = this.getCurrentInputState();
		if (this._chatSessionIsEmpty) {
			this._emptyInputState.set(state, undefined);
		}
		const prevState = this._inputModel?.state.get();
		logChangesToStateModel(this._inputModel, `_syncInputStateToModel boundInputModelSession=${this._inputModelSessionResource?.toString()} widgetSession=${this._currentSessionKey} mismatch=${this._inputModelSessionResource?.toString() !== this._currentSessionKey}`, state, prevState, this.logService);
		this._inputModel?.setState(state);
		this._isSyncingToOrFromInputModel = false;

		queueMicrotask(() => this.inputActionsToolbar?.relayout());
	}

	public flushInputStateToModel(): void {
		if (this._inputModel) {
			this._syncInputStateToModel();
		}
	}

	public setCurrentLanguageModel(model: ILanguageModelChatMetadataAndIdentifier, isUserAction = false, storeSelection: boolean = isUserAction) {
		const persistSelection = isUserAction && storeSelection;
		this._modelSelectionDiagnostics.report('set-model', {
			model: model.identifier,
			isUserAction,
			persistSelection,
			available: this.getModels().length,
		}, 'info');
		const apply = () => {
			if (this.cachedWidth) {
				this.layout(this.cachedWidth);
			}
			if (persistSelection) {
				storeSelectedModel(this.storageService, this.location, this.getSelectedModelTarget(), model.identifier);
			}
			this._syncInputStateToModel();
		};
		this._modelSelectionController.applySelection(model, apply, isUserAction);
	}

	private _applyProgrammaticLanguageModel(model: ILanguageModelChatMetadataAndIdentifier): void {
		this._modelSelectionController.applyProgrammaticSelection(model);
	}

	private _requestProgrammaticLanguageModel(resolveModel: () => ILanguageModelChatMetadataAndIdentifier | undefined): Promise<boolean> {
		const result = this._modelSelectionController.requestProgrammaticSelection(
			resolveModel,
			this._inputModelSessionResource?.toString(),
		);
		this._updateInputContentContextKeys();
		void result.finally(() => this._updateInputContentContextKeys());
		return result;
	}

	setChatMode(mode: ChatModeKind | string, storeSelection = true, isUserInitiated = false): void {
		if (!this.options.supportsChangingModes) {
			return;
		}

		const modes = this._currentChatModesObservable.get();
		const mode2 = modes.findModeById(mode) ??
			modes.findModeByName(mode) ??
			modes.findModeById(ChatModeKind.Agent) ??
			ChatMode.Ask;
		this.setChatMode2(mode2, storeSelection, isUserInitiated);
	}

	private setChatMode2(mode: IChatMode, storeSelection = true, isUserInitiated = false): void {
		if (!this.options.supportsChangingModes) {
			return;
		}

		this._currentModeObservable.set(mode, undefined);
		this._onDidChangeCurrentChatMode.fire({ isUserInitiated });

		if (storeSelection) {
			logChangesToStateModel(this._inputModel, `setChatMode2 -> _syncInputStateToModel (mode=${mode.id}, storeSelection=${storeSelection}, isUserInitiated=${isUserInitiated}, currentLanguageModel=${this._currentLanguageModel.get()?.identifier}) in ${this._currentSessionKey}`, undefined, undefined, this.logService);
			this._syncInputStateToModel();
		}
	}

	private getAllMergedModels(): ILanguageModelChatMetadataAndIdentifier[] {
		const cachedModels = this.storageService.getObject<ILanguageModelChatMetadataAndIdentifier[]>(CachedLanguageModelsKey, StorageScope.APPLICATION, []);
		const liveModels = this.languageModelsService.getLanguageModelIds()
			.map(modelId => ({ identifier: modelId, metadata: this.languageModelsService.lookupLanguageModel(modelId)! }));

		const contributedVendors = new Set(this.languageModelsService.getVendors().map(v => v.vendor));
		const resolvedVendors = new Set<string>();
		for (const v of contributedVendors) {
			if (this.languageModelsService.hasResolvedVendor(v)) {
				resolvedVendors.add(v);
			}
		}
		const models = mergeModelsWithCache(liveModels, cachedModels, contributedVendors, resolvedVendors);
		if (liveModels.length > 0 || resolvedVendors.size > 0) {
			this.storageService.store(CachedLanguageModelsKey, models, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		return models;
	}

	private getModels(): ILanguageModelChatMetadataAndIdentifier[] {
		return this.getModelsForSessionType(this.getCurrentSessionType());
	}

	private _showAutoModel(): boolean {
		const sessionType = this.getCurrentSessionType();
		return !sessionType || this.chatSessionsService.supportsAutoModelForSessionType(sessionType);
	}


	private getModelsForSessionType(sessionType: string | undefined): ILanguageModelChatMetadataAndIdentifier[] {
		const allModels = this.getAllMergedModels();

		allModels.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
		const sessionFiltered = filterModelsForSession(allModels, sessionType, this.currentModeKind, this.location);
		return sessionFiltered.filter(m => !isModelHiddenInPicker(m, id => this.languageModelsService.isModelHidden(id)));
	}

	private getCurrentSessionType(): string | undefined {
		const sessionResource = this._widget?.viewModel?.model.sessionResource;
		if (sessionResource) {
			return getChatSessionType(sessionResource);
		}
		return this.options.sessionTypePickerDelegate?.getActiveSessionProvider?.();
	}

	private checkModeInSessionPool(sessionType?: string): void {
		if (!sessionType) {
			const sessionResource = this._widget?.viewModel?.model.sessionResource;
			if (!sessionResource) {
				return;
			}
			sessionType = getChatSessionType(sessionResource);
		}

		const customAgentTarget = this.chatSessionsService.getCustomAgentTargetForSessionType(sessionType);
		if (!customAgentTarget || customAgentTarget === Target.Undefined) {
			return;
		}

		const currentMode = this._currentModeObservable.get();
		if (currentMode.id === ChatMode.Agent.id) {
			return;
		}
		if (currentMode.isBuiltin) {
			this.setChatMode(ChatModeKind.Agent, false);
			return;
		}

		const modeTarget = currentMode.target.get();
		if (modeTarget !== customAgentTarget && modeTarget !== Target.Undefined) {
			this.setChatMode(ChatModeKind.Agent, false);
		}
	}

	private setCurrentLanguageModelToDefault(forSessionType?: string) {
		this._modelSelectionController.selectDefault(forSessionType ?? this.getCurrentSessionType());
	}

	private getConfiguredModelValue(): string | undefined {
		const model = this.configurationService.getValue<string>(ChatConfiguration.DefaultModel)?.trim();
		return model ? model : undefined;
	}

	private resolveDraftModel(
		draftModel: ILanguageModelChatMetadataAndIdentifier | undefined,
		sessionTypeForValidation: string | undefined,
		validatePool: boolean,
	): { readonly model: ILanguageModelChatMetadataAndIdentifier | undefined; readonly changed: boolean } {
		let model = draftModel;
		if (validatePool && shouldDropAgnosticDraftModel(model, this.getAllMergedModels(), sessionTypeForValidation)) {
			model = undefined;
		}
		const configuredValue = this.getConfiguredModelValue();
		if (configuredValue) {
			model = resolveConfiguredModel(configuredValue, this.getModelsForSessionType(this._currentSessionType ?? this.getCurrentSessionType()));
		}
		return { model, changed: model?.identifier !== draftModel?.identifier };
	}

	private reinitializeIfOutsidePool(initialize: () => void): void {
		const currentModel = this._modelSelectionController.currentModel.get();
		const pool = this.getModelsForSessionType(this._currentSessionType ?? this.getCurrentSessionType());
		if (!currentModel || pool.some(model => model.identifier === currentModel.identifier)) {
			return;
		}
		initialize();
		this._modelSelectionController.ensureCurrentModelSupported();
	}

	public resetLanguageModelToDefault(): void {
		this._modelSelectionController.resetToDefault(this.getCurrentSessionType());
	}

	public getCurrentInputState(): IChatModelInputState {
		const mode = this._currentModeObservable.get();
		const selectedModel = this._currentLanguageModel.get();
		const state: IChatModelInputState = {
			inputText: this._inputEditor?.getValue() ?? '',
			attachments: this._attachmentModel.attachments,
			mode: {
				id: mode.id,
				kind: mode.kind
			},
			selectedModel,
			modelConfiguration: selectedModel ? this._modelConfigStore.getModelConfiguration(selectedModel.identifier) : undefined,
			selectedModelReason: selectedModel ? this._modelSelectionController.selectionReason : undefined,
			selections: this._inputEditor?.getSelections() || [],
			permissionLevel: this._currentPermissionLevel.get(),
			contrib: {},
		};

		for (const contrib of this._widget?.contribs || Iterable.empty()) {
			contrib.getInputState?.(state.contrib);
		}

		return state;
	}

	private _getAriaLabel(): string {
		const verbose = this.configurationService.getValue<boolean>(AccessibilityVerbositySettingId.Chat);
		let kbLabel;
		if (verbose) {
			kbLabel = this.keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp)?.getLabel();
		}
		const mode = this._currentModeObservable.get();

		const modelName = this._currentLanguageModel.get()?.metadata.name;
		const modelInfo = modelName ? localize('chatInput.model', ", {0}. ", modelName) : '';

		let modeLabel = '';
		if (!mode.isBuiltin) {
			const mode = this.currentModeObs.get();
			modeLabel = localize('chatInput.mode.custom', "({0}), {1}", mode.label.get(), mode.description.get());
		} else {
			switch (this.currentModeKind) {
				case ChatModeKind.Agent:
					modeLabel = localize('chatInput.mode.agent', "(Agent), edit files in your workspace.");
					break;
				case ChatModeKind.Edit:
					modeLabel = localize('chatInput.mode.edit', "(Edit), edit files in your workspace.");
					break;
				case ChatModeKind.Ask:
				default:
					modeLabel = localize('chatInput.mode.ask', "(Ask), ask questions or type / for topics.");
					break;
			}
		}
		if (verbose) {
			return kbLabel
				? localize('actions.chat.accessibiltyHelp', "Chat Input {0}{1} Press Enter to send out the request. Use {2} for Chat Accessibility Help.", modeLabel, modelInfo, kbLabel)
				: localize('chatInput.accessibilityHelpNoKb', "Chat Input {0}{1} Press Enter to send out the request. Use the Chat Accessibility Help command for more information.", modeLabel, modelInfo);
		} else {
			return localize('chatInput.accessibilityHelp', "Chat Input {0}{1}.", modeLabel, modelInfo);
		}
	}

	private validateCurrentChatMode() {
		const currentMode = this._currentModeObservable.get();
		const validMode = this._currentChatModesObservable.get().findModeById(currentMode.id);
		const isAgentModeEnabled = this.configurationService.getValue<boolean>(ChatConfiguration.AgentEnabled);
		if (!validMode) {
			this.setChatMode(isAgentModeEnabled ? ChatModeKind.Agent : ChatModeKind.Ask);
			return;
		}
		if (currentMode.kind === ChatModeKind.Agent && !isAgentModeEnabled) {
			this.setChatMode(ChatModeKind.Ask);
			return;
		}
	}

	private _restorePersistedCustomModeIfAvailable(): void {
		const persistedMode = this._inputModel?.state.get()?.mode;
		if (!persistedMode) {
			return;
		}
		const modes = this._currentChatModesObservable.get();
		const found = modes.findModeById(persistedMode.id) ?? modes.findModeByName(persistedMode.id);
		if (found && !found.isBuiltin && this._currentModeObservable.get().id !== found.id) {
			this.setChatMode(found.id, false);
		}
	}

	logInputHistory(): void {
		const historyStr = this.history.values.map(entry => JSON.stringify(entry)).join('\n');
		this.logService.info(`[${this.location}] Chat input history:`, historyStr);
	}

	setVisible(visible: boolean): void {
		this._onDidChangeVisibility.fire(visible);
	}

	get generating() {
		return this._generating?.defer.p;
	}

	startGenerating(): IDisposable {
		this.logService.trace('ChatWidget#startGenerating');
		if (this._generating) {
			this._generating.rc++;
		} else {
			this._generating = { rc: 1, defer: new DeferredPromise<void>() };
		}

		return toDisposable(() => {
			this.logService.trace('ChatWidget#doneGenerating');
			if (this._generating && !--this._generating.rc) {
				this._generating.defer.complete();
				this._generating = undefined;
			}
		});
	}

	get element(): HTMLElement {
		return this.container;
	}

	async showPreviousValue(): Promise<void> {
		if (this.history.isAtStart()) {
			return;
		}

		const state = this.getCurrentInputState();
		if (state.inputText || state.attachments.length) {
			this.history.overlay(state);
		}
		this.navigateHistory(true);
	}

	async showNextValue(): Promise<void> {
		if (this.history.isAtEnd()) {
			return;
		}

		const state = this.getCurrentInputState();
		if (state.inputText || state.attachments.length) {
			this.history.overlay(state);
		}
		this.navigateHistory(false);
	}

	async restoreAttachments(attachments: readonly IChatRequestVariableEntry[]): Promise<void> {
		let restored = [...attachments];

		if (restored.length > 0) {
			restored = (await Promise.all(restored.map(async (attachment) => {
				if (isImageVariableEntry(attachment) && !attachment.value && attachment.references?.length && URI.isUri(attachment.references[0].reference)) {
					const currReference = attachment.references[0].reference;
					try {
						const imageBinary = currReference.toString(true).startsWith('http') ? await this.sharedWebExtracterService.readImage(currReference, CancellationToken.None) : (await this.fileService.readFile(currReference)).value;
						if (!imageBinary) {
							return undefined;
						}
						const newAttachment = { ...attachment };
						newAttachment.value = (isImageVariableEntry(attachment) && attachment.isPasted) ? imageBinary.buffer : await resizeImage(imageBinary.buffer);
						return newAttachment;
					} catch (err) {
						this.logService.error('Failed to fetch and reference.', err);
						return undefined;
					}
				}
				return attachment;
			}))).filter(isDefined);
		}

		this._attachmentModel.clearAndSetContext(...restored);
	}

	private async navigateHistory(previous: boolean): Promise<void> {
		const historyEntry = previous ?
			this.history.previous() : this.history.next();

		await this.restoreAttachments(historyEntry?.attachments ?? []);

		const inputText = historyEntry?.inputText ?? '';
		const contribData = historyEntry?.contrib ?? {};
		aria.status(inputText);
		this.setValue(inputText, true);
		this._widget?.contribs.forEach(contrib => {
			contrib.setInputState?.(contribData);
		});
		this._onDidLoadInputState.fire();

		const model = this._inputEditor.getModel();
		if (!model) {
			return;
		}

		if (previous) {
			this._inputEditor.setPosition({ lineNumber: 1, column: 1 });
		} else {
			this._inputEditor.setPosition(getLastPosition(model));
		}
	}

	setValue(value: string, transient: boolean): void {
		this.inputEditor.setValue(value);
		const model = this.inputEditor.getModel();
		if (model) {
			this.inputEditor.setPosition(getLastPosition(model));
		}
	}

	focus() {
		this._inputEditor.focus();
	}

	hasFocus(): boolean {
		return this._inputEditor.hasWidgetFocus();
	}

	focusTodoList(): boolean {
		return this._chatInputTodoListWidget.value?.focus() ?? false;
	}

	isTodoListFocused(): boolean {
		return this._chatInputTodoListWidget.value?.hasFocus() ?? false;
	}

	hasVisibleTodos(): boolean {
		return this._chatInputTodoListWidget.value?.hasTodos() ?? false;
	}

	async acceptInput(isUserQuery?: boolean, preserveFocus?: boolean, preserveInput?: boolean): Promise<void> {
		if (isUserQuery) {
			const userQuery = this.getCurrentInputState();
			this.history.append(this._getFilteredEntry(userQuery));
		}

		this.resetScrollbarVisibilityAfterAccept();

		this.chatInputNotificationService.handleMessageSent(this.getNotificationContext());

		if (this._chatSessionIsEmpty) {
			this._chatSessionIsEmpty = false;
			this._emptyInputState.set(undefined, undefined);
			this._emptyInputAttachments.set([], undefined);
		}

		if (preserveInput) {
			if (!preserveFocus) {
				this._inputEditor.focus();
			}
			return;
		}

		notifyDictationSubmitted(this._inputEditor);
		logChangesToStateModel(this._inputModel, `[ACCEPT] acceptInput -> attachmentModel.clear() in ${this._currentSessionKey}`, undefined, this._inputModel?.state.get(), this.logService);
		this.attachmentModel.clear();
		this.clearActiveSkills();
		this._onDidLoadInputState.fire();
		if (this.accessibilityService.isScreenReaderOptimized() && isMacintosh) {
			this._acceptInputForVoiceover();
		} else if (preserveFocus) {
			this._inputEditor.setValue('');
		} else {
			this._inputEditor.focus();
			this._inputEditor.setValue('');
		}
	}

	validateAgentMode(): void {
		if (!this.agentService.hasToolsAgent && this._currentModeObservable.get().kind === ChatModeKind.Agent) {
			this.setChatMode(ChatModeKind.Edit);
		}
	}

	private _getFilteredEntry(inputState: IChatModelInputState): IChatModelInputState {
		const attachmentsWithoutImageValues = inputState.attachments.map(attachment => {
			if (isImageVariableEntry(attachment) && attachment.references?.length && attachment.value) {
				const newAttachment = { ...attachment };
				newAttachment.value = undefined;
				return newAttachment;
			}
			return attachment;
		});

		return { ...inputState, attachments: attachmentsWithoutImageValues };
	}

	private _acceptInputForVoiceover(): void {
		const domNode = this._inputEditor.getDomNode();
		if (!domNode) {
			return;
		}
		domNode.remove();
		this._inputEditor.setValue('');
		this._inputEditorElement.appendChild(domNode);
		this._inputEditor.focus();
	}

	private _handleAttachedContextChange() {
		this._hasFileAttachmentContextKey.set(Boolean(this._attachmentModel.attachments.find(a => a.kind === 'file')));
		this._updateInputContentContextKeys();
		this.renderAttachedContext();
	}

	private _updateInputContentContextKeys(): void {
		const inputHasText = !!this._inputEditor?.getModel()?.getValue().trim();
		this.inputEditorHasText.set(inputHasText);
		const hasSendableContent = inputHasText || this._attachmentModel.attachments.some(isExplicitFileOrImageVariableEntry);
		this.inputEditorHasSendableContent.set(hasSendableContent && !this.hasPendingProgrammaticModelSelection);
	}

	private getOrCreateOptionEmitter(optionGroupId: string): Emitter<IChatSessionProviderOptionItem> {
		let emitter = this._chatSessionOptionEmitters.get(optionGroupId);
		if (!emitter) {
			emitter = new Emitter<IChatSessionProviderOptionItem>();
			this._chatSessionOptionEmitters.set(optionGroupId, emitter);
		}
		return emitter;
	}

	private getOrCreateOptionContextKey(optionGroupId: string): IContextKey<string> | undefined {
		if (!this._scopedContextKeyService) {
			return undefined;
		}
		let contextKey = this._optionContextKeys.get(optionGroupId);
		if (!contextKey) {
			const rawKey = new RawContextKey<string>(`chatSessionOption.${optionGroupId}`, '');
			contextKey = rawKey.bindTo(this._scopedContextKeyService);
			this._optionContextKeys.set(optionGroupId, contextKey);
		}
		return contextKey;
	}

	private updateOptionContextKey(optionGroupId: string, optionItemId: string): void {
		const normalizedOptionId = optionItemId.trim();
		const contextKey = this.getOrCreateOptionContextKey(optionGroupId);
		if (contextKey) {
			contextKey.set(normalizedOptionId);
		}
	}

	private evaluateOptionGroupVisibility(optionGroup: { id: string; when?: string }): boolean {
		if (!optionGroup.when) {
			return true;
		}

		if (!this._scopedContextKeyService) {
			return true;
		}

		const expr = ContextKeyExpr.deserialize(optionGroup.when);
		if (!expr) {
			return true;
		}

		return this._scopedContextKeyService.contextMatchesRules(expr);
	}

	private getVisibleOptionGroupsModeAndUpdateContextKeys(sessionResource: URI | undefined): IChatSessionProviderOptionGroup[] {
		const sessionType = this.getEffectiveSessionType(sessionResource);
		const customAgentTarget = sessionType ? this.chatSessionsService.getCustomAgentTargetForSessionType(sessionType) : Target.Undefined;
		this.chatSessionHasCustomAgentTarget.set(customAgentTarget !== Target.Undefined);

		const requiresCustomModels = sessionType && this.chatSessionsService.requiresCustomModelsForSessionType(sessionType);
		this.chatSessionHasTargetedModels.set(!!requiresCustomModels);

		const visibleOptionGroups = this.getVisibleOptionGroups(sessionResource);
		this.permissionWidget?.refresh();
		if (!visibleOptionGroups.length) {
			this.chatSessionHasOptions.set(false);
			this.chatSessionOptionsValid.set(true);
			this._updateInputContentContextKeys();
			return [];
		}

		const allOptionsValid = sessionResource ? this.areAllOptionsValid(sessionResource, visibleOptionGroups) : true;

		this.chatSessionHasOptions.set(true);
		this.chatSessionOptionsValid.set(allOptionsValid);

		this._updateInputContentContextKeys();

		return visibleOptionGroups;
	}

	private getCurrentSessionResource() {
		return this._widget?.viewModel?.model.sessionResource;
	}

	private getTerminalCommandPrefix(): string | undefined {
		const sessionResource = this.getCurrentSessionResource();
		return sessionResource ? this.chatSessionsService.getCapabilitiesForSessionType(getChatSessionType(sessionResource))?.terminalCommandPrefix : undefined;
	}

	isTerminalCommandPaste(pastedText: string, range: IRange): boolean {
		const model = this._inputEditor.getModel();
		const prefix = this.getTerminalCommandPrefix();
		if (!model || !prefix) {
			return false;
		}
		return isTerminalCommandPasteContent({
			prefix,
			pastedText,
			currentValue: model.getValue(),
			selectionStartOffset: model.getOffsetAt(Range.getStartPosition(range)),
			selectionEndOffset: model.getOffsetAt(Range.getEndPosition(range)),
		});
	}

	private updateInputEditorFontFamily(): void {
		if (!this._inputEditor) {
			return;
		}

		const isCommand = isTerminalCommandInput(this._inputEditor.getModel()?.getLineContent(1) || '', this.getTerminalCommandPrefix());
		this._inputEditor.updateOptions({ fontFamily: isCommand ? EDITOR_FONT_DEFAULTS.fontFamily : DEFAULT_FONT_FAMILY });
	}

	public addSkill(skillName: string): void {
		const cleanName = skillName.startsWith('/') ? skillName.slice(1) : skillName;
		if (!cleanName) {
			return;
		}
		this._activeSkills.add(cleanName);
		this.renderSkillChips();
	}

	public removeSkill(skillName: string): void {
		this._activeSkills.delete(skillName);
		this.renderSkillChips();
	}

	public getActiveSkills(): string[] {
		return Array.from(this._activeSkills);
	}

	public clearActiveSkills(): void {
		this._activeSkills.clear();
		this.renderSkillChips();
	}

	private _isExtractingSkills = false;

	public extractSkillsFromInput(model: ITextModel, allowEndOfString = false): void {
		if (this._isExtractingSkills) {
			return;
		}
		const text = model.getValue();
		if (!text.includes('/')) {
			return;
		}

		const BUILTIN_COMMANDS = new Set([
			'create-agent', 'clear', 'help', 'init', 'explain', 'fix', 'test',
			'tests', 'review', 'commit', 'start-debugging', 'setup-tests',
			'goal', 'schedule', 'grill-me', 'learn'
		]);

		const skillPattern = allowEndOfString
			? /(?:^|\s)\/([\p{L}0-9_.:-]+)(?=\s|$)/gu
			: /(?:^|\s)\/([\p{L}0-9_.:-]+)\s+/gu;

		const foundSkills: string[] = [];
		let match: RegExpExecArray | null;

		while ((match = skillPattern.exec(text)) !== null) {
			const skill = match[1];
			if (!BUILTIN_COMMANDS.has(skill.toLowerCase())) {
				foundSkills.push(skill);
			}
		}

		if (foundSkills.length === 0) {
			return;
		}

		this._isExtractingSkills = true;
		try {
			for (const skill of foundSkills) {
				this.addSkill(skill);
			}

			let newText = text;
			for (const skill of foundSkills) {
				const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const replaceRegex = new RegExp(`(?:^|\\s)\\/` + escaped + `(?:\\s+|$)`, 'gu');
				newText = newText.replace(replaceRegex, ' ');
			}
			newText = newText.trim();
			if (newText !== text) {
				model.setValue(newText);
				this._inputEditor.setPosition(getLastPosition(model));
			}
		} finally {
			this._isExtractingSkills = false;
		}
	}

	private renderSkillChips(): void {
		if (!this.skillChipsContainer) {
			return;
		}
		dom.clearNode(this.skillChipsContainer);
		if (this._activeSkills.size === 0) {
			dom.hide(this.skillChipsContainer);
			this.inputContainer?.classList.remove('has-skill-chips');
			const defaultPadding = this.options.renderStyle === 'compact' ? INPUT_EDITOR_PADDING.compact : INPUT_EDITOR_PADDING.default;
			this._inputEditor?.updateOptions({ padding: defaultPadding });
			if (typeof this.cachedWidth === 'number') {
				this._layout(this.cachedWidth);
			}
			return;
		}
		dom.show(this.skillChipsContainer);
		this.inputContainer?.classList.add('has-skill-chips');
		this._inputEditor?.updateOptions({ padding: { top: 2, bottom: INPUT_EDITOR_PADDING.default.bottom } });
		for (const skill of this._activeSkills) {
			const chip = dom.$('.chat-skill-chip');
			const icon = dom.$('span.chat-skill-chip-icon');
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.terminal));
			const name = dom.$('span.chat-skill-chip-name', {}, skill);
			const close = dom.$('span.chat-skill-chip-remove');
			close.classList.add(...ThemeIcon.asClassNameArray(Codicon.closeCompact));
			close.title = localize('chat.removeSkill', "Remove {0}", skill);
			close.setAttribute('role', 'button');
			close.setAttribute('tabindex', '0');
			close.setAttribute('aria-label', localize('chat.removeSkillAria', "Remove skill {0}", skill));
			close.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.removeSkill(skill);
			};
			close.onkeydown = (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					e.stopPropagation();
					this.removeSkill(skill);
				}
			};
			chip.appendChild(icon);
			chip.appendChild(name);
			chip.appendChild(close);
			this.skillChipsContainer.appendChild(chip);
		}
		if (typeof this.cachedWidth === 'number') {
			this._layout(this.cachedWidth);
		}
	}

	private handleTerminalCommandPaste(e: ClipboardEvent): void {
		if (this._handleClipboardImagePaste(e)) {
			return;
		}
		handleTerminalCommandPaste(e, this._inputEditor, this.getTerminalCommandPrefix(), this.dialogService, this.storageService);
	}

	private _handleClipboardImagePaste(e: ClipboardEvent): boolean {
		const items = e.clipboardData?.items;
		if (!items || items.length === 0) {
			return false;
		}
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.kind === 'file' && item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) {
					e.preventDefault();
					e.stopPropagation();
					void file.arrayBuffer().then(async buffer => {
						const uint8 = new Uint8Array(buffer);
						const mimeType = file.type || 'image/png';
						const scaled = await resizeImage(uint8, mimeType);
						const hash = crypto.randomUUID();
						const displayName = localize('pastedImageName', 'Pasted Image');
						let tempDisplayName = displayName;
						const attached = this._attachmentModel.attachments;
						for (let append = 2; attached.some(a => a.name === tempDisplayName); append++) {
							tempDisplayName = `${displayName} ${append}`;
						}
						const imagesFolder = joinPath(this.environmentService.workspaceStorageHome, 'vscode-chat-images');
						const fileRef = await createFileForMedia(this.fileService, imagesFolder, uint8, mimeType).catch(() => undefined);
						this._attachmentModel.addContext({
							kind: 'image',
							value: scaled,
							id: hash,
							name: tempDisplayName,
							icon: Codicon.fileMedia,
							mimeType,
							isPasted: true,
							references: fileRef ? [{ reference: fileRef, kind: 'reference' }] : []
						});
					});
					return true;
				}
			}
		}
		return false;
	}

	private areAllOptionsValid(sessionResource: URI, visibleOptionGroups: readonly IChatSessionProviderOptionGroup[]): boolean {
		for (const optionGroup of visibleOptionGroups) {
			const currentOption = this.chatSessionsService.getSessionOption(sessionResource, optionGroup.id);
			if (currentOption) {
				const currentOptionId = typeof currentOption === 'string' ? currentOption : currentOption.id;
				if (!optionGroup.items.some(item => item.id === currentOptionId) && typeof currentOption === 'string') {
					return false;
				}
			}
		}
		return true;
	}

	private getAllOptionsGroups(sessionResource: URI | undefined): IChatSessionProviderOptionGroup[] {
		const delegateSessionType = this.options.sessionTypePickerDelegate?.getActiveSessionProvider?.();
		const effectiveSessionType = delegateSessionType ?? (sessionResource ? getChatSessionType(sessionResource) : undefined);
		if (!effectiveSessionType) {
			return [];
		}

		const allOptionGroups = this.chatSessionsService.getOptionGroupsForSessionType(effectiveSessionType);
		return allOptionGroups ?? [];
	}

	private getVisibleOptionGroups(sessionResource: URI | undefined): IChatSessionProviderOptionGroup[] {
		const allOptionGroups = this.getAllOptionsGroups(sessionResource);
		if (!allOptionGroups.length) {
			return [];
		}

		if (sessionResource) {
			for (const optionGroup of allOptionGroups) {
				const currentOption = this.chatSessionsService.getSessionOption(sessionResource, optionGroup.id);
				if (currentOption) {
					const optionId = typeof currentOption === 'string' ? currentOption : currentOption.id;
					this.updateOptionContextKey(optionGroup.id, optionId);
				}
			}
		}

		const visibleGroups = new Map<string, IChatSessionProviderOptionGroup>();
		for (const optionGroup of allOptionGroups) {
			if (optionGroup.kind === 'permissions') {
				continue;
			}
			const hasItems = optionGroup.items.length > 0 || (optionGroup.commands || []).length > 0;
			const passesWhenClause = this.evaluateOptionGroupVisibility(optionGroup);

			const sessionHasOption = !sessionResource || this.chatSessionsService.getSessionOption(sessionResource, optionGroup.id) !== undefined;

			if (hasItems && passesWhenClause && sessionHasOption) {
				visibleGroups.set(optionGroup.id, optionGroup);
			}
		}

		return Array.from(visibleGroups.values());
	}

	private getActiveExtensionPermissionGroup(sessionResource: URI | undefined): IChatSessionProviderOptionGroup | undefined {
		const allOptionGroups = this.getAllOptionsGroups(sessionResource);
		return allOptionGroups.find(g =>
			g.kind === 'permissions'
			&& g.items.length > 0
			&& this.evaluateOptionGroupVisibility(g)
		);
	}

	private refreshChatSessionPickers(): void {
		const sessionResource = this.getCurrentSessionResource();
		const allOptionsGroups = this.getAllOptionsGroups(sessionResource);
		const visibleOptionGroups = this.getVisibleOptionGroupsModeAndUpdateContextKeys(sessionResource);
		if (!allOptionsGroups.length || !visibleOptionGroups.length) {
			this.hideAllSessionPickerWidgets();
			return;
		}

		const currentWidgetGroupIds = new Set(this.chatSessionPickerWidgets.keys());
		const needsRecreation =
			currentWidgetGroupIds.size !== visibleOptionGroups.length ||
			!visibleOptionGroups.every(group => currentWidgetGroupIds.has(group.id));

		if (needsRecreation && this._lastSessionPickerAction && this.chatSessionPickerContainer) {
			const widgets = this.createChatSessionPickerWidgets(this._lastSessionPickerAction, this._lastSessionPickerOptions);
			dom.clearNode(this.chatSessionPickerContainer);
			for (const widget of widgets) {
				const container = dom.$('.action-item.chat-sessionPicker-item');
				widget.render(container);
				this.chatSessionPickerContainer.appendChild(container);
			}
		}

		if (this.chatSessionPickerContainer) {
			this.chatSessionPickerContainer.style.display = '';
		}

		if (sessionResource) {
			for (const [optionGroupId] of this.chatSessionPickerWidgets) {
				const currentOption = this.chatSessionsService.getSessionOption(sessionResource, optionGroupId);
				if (currentOption) {
					const optionGroup = allOptionsGroups.find(g => g.id === optionGroupId);
					if (optionGroup) {
						const currentOptionId = typeof currentOption === 'string' ? currentOption : currentOption.id;
						const item = optionGroup.items.find((m: IChatSessionProviderOptionItem) => m.id === currentOptionId);
						if (item && typeof currentOption === 'string') {
							this.getOrCreateOptionEmitter(optionGroupId).fire(item);
						} else if (typeof currentOption !== 'string') {
							this.getOrCreateOptionEmitter(optionGroupId).fire(currentOption);
						}

					}
				}
			}
		}
	}

	private hideAllSessionPickerWidgets(): void {
		if (this.chatSessionPickerContainer) {
			this.chatSessionPickerContainer.style.display = 'none';
		}
	}

	private getCurrentOptionForGroup(optionGroupId: string): IChatSessionProviderOptionItem | undefined {
		const sessionResource = this._widget?.viewModel?.model.sessionResource;
		if (!sessionResource) {
			return;
		}

		if (this.chatSessionsService.getSessionOption(sessionResource, optionGroupId) === undefined) {
			return;
		}

		const effectiveSessionType = this.getEffectiveSessionType(sessionResource);
		const optionGroups = effectiveSessionType ? this.chatSessionsService.getOptionGroupsForSessionType(effectiveSessionType) : undefined;
		const optionGroup = optionGroups?.find(g => g.id === optionGroupId);
		if (!optionGroup || optionGroup.items.length === 0) {
			return;
		}

		const currentOptionValue = this.chatSessionsService.getSessionOption(sessionResource, optionGroupId);
		if (!currentOptionValue) {
			const defaultItem = optionGroup.items.find(item => item.default);
			return defaultItem;
		}

		if (typeof currentOptionValue === 'string') {
			const normalizedOptionId = currentOptionValue.trim();
			return optionGroup.items.find(m => m.id === normalizedOptionId);
		} else {
			return currentOptionValue as IChatSessionProviderOptionItem;
		}

	}


	private getEffectiveSessionType(sessionResource: URI | undefined): string | undefined {
		return this.options.sessionTypePickerDelegate?.getActiveSessionProvider?.() ?? (sessionResource ? getChatSessionType(sessionResource) : undefined);
	}

	private updateAgentSessionTypeContextKey(): void {
		const sessionResource = this._widget?.viewModel?.model.sessionResource;

		const delegate = this.options.sessionTypePickerDelegate;
		const delegateSessionType = delegate?.setActiveSessionProvider && delegate?.getActiveSessionProvider?.();
		const sessionType = delegateSessionType || (sessionResource ? getChatSessionType(sessionResource) : '');

		this.agentSessionTypeKey.set(sessionType);
		this.chatSessionSupportsDelegationKey.set(this.chatSessionsService.supportsDelegationForSessionType(sessionType));
	}

	private updateWidgetLockStateFromSessionType(sessionType: string): void {
		if (sessionType === localChatSessionType) {
			this._widget?.unlockFromCodingAgent();
			return;
		}

		const contribution = this.chatSessionsService.getChatSessionContribution(sessionType);
		if (contribution) {
			this._widget?.lockToCodingAgent(contribution.name, contribution.displayName, contribution.type, contribution.agentHostProviderId);
		} else {
			this._widget?.unlockFromCodingAgent();
		}
	}

	private getActiveSessionTypeForDelegation(): string | undefined {
		const sessionResource = this._widget?.viewModel?.sessionResource;
		return sessionResource ? getChatSessionType(sessionResource) : undefined;
	}

	public continueInSession(provider: string): void {
		this.setPendingDelegationTarget(provider);
		this.focus();
	}

	private setPendingDelegationTarget(provider: string): void {
		const isActive = this.getActiveSessionTypeForDelegation() === provider;
		this._pendingDelegationTarget = isActive ? undefined : provider;
		this.chatHasPendingDelegationTargetKey.set(!!this._pendingDelegationTarget);
		this.updateWidgetLockStateFromSessionType(provider);
		this.updateAgentSessionTypeContextKey();
		this.refreshChatSessionPickers();
	}

	private ensureNotificationWidget(): void {
		if (!this._notificationWidget.value) {
			this._notificationWidget.value = this.instantiationService.createInstance(ChatInputNotificationWidget, {
				modelTargetChatSessionType: this._notificationModelTargetChatSessionType,
				sessionResource: this._currentSessionResourceObservable,
				deferredNotificationsEnabled: this._deferredNotificationsEnabled,
				isTransientChat: constObservable(this.options.isTransientChat ?? false),
				sessionStarted: this._sessionStarted,
				modelSelection: {
					state: this._notificationModelState,
					openPicker: () => this.openModelPicker(),
					selectModel: modelIdentifier => this.selectNotificationModel(modelIdentifier),
					applyModelConfiguration: (modelIdentifier, values) => this.applyNotificationModelConfiguration(modelIdentifier, values),
				},
				onDidChangeVisibility: (visible, focusTarget) => this.noticeHost.setOccupied(ChatInputNoticeLane.Notification, visible, focusTarget),
				focusInput: () => this.focus(),
			});
			this._notificationWidget.value.attachTo(this.chatInputNotificationContainer);
		}
	}

	private getNotificationContext(): IChatInputNotificationContext {
		return {
			sessionType: this._notificationModelTargetChatSessionType.get(),
			sessionResource: this._currentSessionResourceObservable.get(),
			deferredNotificationsEnabled: this._deferredNotificationsEnabled.get(),
			isTransientChat: this.options.isTransientChat ?? false,
			sessionStarted: this._sessionStarted.get(),
			modelState: this._notificationModelState.get(),
		};
	}

	private selectNotificationModel(identifier: string): boolean {
		const model = this._notificationModelState.get().models.find(model => model.identifier === identifier);
		if (!model) {
			return false;
		}
		this.setCurrentLanguageModel(model, true, !this._pendingDelegationTarget);
		return true;
	}

	private async applyNotificationModelConfiguration(modelIdentifier: string, values: IStringDictionary<unknown>): Promise<void> {
		if (this._pendingDelegationTarget) {
			return;
		}
		await this._modelConfigStore.setModelConfiguration(modelIdentifier, values);
	}

	private ensureGoalBannerWidget(): ChatGoalBannerWidget {
		if (!this._goalBannerWidget.value) {
			const widget = new ChatGoalBannerWidget();
			this._register(widget.onDismiss(() => this._onDidDismissGoalBanner.fire()));
			this._goalBannerWidget.value = widget;
			widget.attachTo(this.chatGoalBannerContainer);
		}
		return this._goalBannerWidget.value;
	}

	showGoalBannerLoading(): void {
		this.ensureGoalBannerWidget().setLoading();
	}

	setGoalBanner(summary: string): void {
		this.ensureGoalBannerWidget().setGoal(summary);
	}

	clearGoalBanner(): void {
		this._goalBannerWidget.value?.clear();
	}

	showContextUsageDetails(): boolean {
		return this.contextUsageWidget?.showDetails() ?? false;
	}

	private updateContextUsageWidget(): void {
		this._contextUsageDisposables.clear();

		const model = this._widget?.viewModel?.model;
		if (!model || !this.contextUsageWidget) {
			return;
		}

		const store = new DisposableStore();
		this._contextUsageDisposables.value = store;
		let lastRequest = model.lastRequest;
		const observePreviousResponse = (request: IChatRequestModel | undefined) => {
			if (request?.response) {
				store.add(request.response.onDidChange(() => this.contextUsageWidget?.updateSessionCost(model.sessionCost)));
			}
		};
		for (const request of model.getRequests().slice(0, -1)) {
			observePreviousResponse(request);
		}

		store.add(model.onDidChange(e => {
			if (e.kind === 'addRequest') {
				observePreviousResponse(lastRequest);
				lastRequest = e.request;
				this.contextUsageWidget?.update(model.lastRequest);
			} else if (e.kind === 'completedRequest') {
				this.contextUsageWidget?.update(model.lastRequest);
			}
		}));

		store.add(this.languageModelsService.onDidChangeLanguageModels(() => {
			const lastRequest = model.lastRequest;
			if (lastRequest?.modelId) {
				this.contextUsageWidget?.update(lastRequest);
			}
		}));

		this.contextUsageWidget.update(model.lastRequest);
	}

	private handleViewModelChange(e: IChatWidgetViewModelChangeEvent): void {
		this.updateDeferredNotificationsEligibility(e);
		transaction(observableTransaction => {
			try {
				this.updateInputEditorFontFamily();
				this.resetPendingDelegationForViewModelChange(observableTransaction);
				this.refreshViewModelScopedState();
				this.clearQuestionCarouselIfSessionChanged(e);
				this.clearPlanReviewIfSessionChanged(e);
				this.clearActiveSkills();
				this._syncToolConfirmationCarouselForSession();
				this.reconcileSessionTypeForViewModelChange(e, observableTransaction);
			} finally {
				this._restorePerTypeModel = false;
			}
		});

		this._modelSelectionController.applyConfiguredDefault();
	}

	private updateDeferredNotificationsEligibility(e?: IChatWidgetViewModelChangeEvent): void {

		this._isFirstWorkbenchSession ??= !this.chatService.hasSessions();
		if (
			this._isFirstWorkbenchSession
			&& e?.previousSessionResource
			&& e.currentSessionResource
			&& !isEqual(e.previousSessionResource, e.currentSessionResource)
			&& !isUntitledChatSession(e.previousSessionResource)
		) {
			this._isFirstWorkbenchSession = false;
		}
		this._deferredNotificationsEnabled.set(!this._isFirstWorkbenchSession, undefined);
	}

	private resetPendingDelegationForViewModelChange(transaction: ITransaction): void {
		this._pendingDelegationTargetObservable.set(undefined, transaction);
		this.chatHasPendingDelegationTargetKey.set(false);
	}

	private refreshViewModelScopedState(): void {
		this.updateAgentSessionTypeContextKey();
		this.refreshChatSessionPickers();
		this.ensureNotificationWidget();
		this.updateContextUsageWidget();
	}

	private clearQuestionCarouselIfSessionChanged(e: IChatWidgetViewModelChangeEvent): void {
		let hasMatchingResource = false;
		if (e.currentSessionResource) {
			for (const r of this._questionCarouselSessionResources.values()) {
				if (isEqual(r, e.currentSessionResource)) {
					hasMatchingResource = true;
					break;
				}
			}
		}
		if (this._questionCarouselSessionResources.size > 0 && (!e.currentSessionResource || !hasMatchingResource)) {
			this.clearQuestionCarousel();
		}
	}

	private clearPlanReviewIfSessionChanged(e: IChatWidgetViewModelChangeEvent): void {
		let hasMatchingPlanReviewResource = false;
		if (e.currentSessionResource) {
			for (const r of this._planReviewSessionResources.values()) {
				if (isEqual(r, e.currentSessionResource)) {
					hasMatchingPlanReviewResource = true;
					break;
				}
			}
		}
		if (this._planReviewSessionResources.size > 0 && (!e.currentSessionResource || !hasMatchingPlanReviewResource)) {
			this.clearPlanReview();
		}
	}

	private reconcileSessionTypeForViewModelChange(e: IChatWidgetViewModelChangeEvent, transaction: ITransaction): void {
		this._currentSessionResourceObservable.set(e.currentSessionResource, transaction);
		this._currentSessionModelObservable.set(this._widget?.viewModel?.model, transaction);
		const newSessionType = this.getCurrentSessionType();
		if (e.currentSessionResource && this._currentSessionType && newSessionType !== this._currentSessionType) {
			logChangesToStateModel(this._inputModel, `[CVVM].1 onDidChangeViewModel -> session change: ${this._currentSessionType} -> ${newSessionType} in ${this._currentSessionKey}, ${e.currentSessionResource.toString()}`, undefined, this._inputModel?.state.get(), this.logService);
			this._currentSessionTypeObservable.set(newSessionType, transaction);
			this.initSelectedModel();
			this.checkModeInSessionPool();
			this._modelSelectionController.ensureCurrentModelSupported();
		} else if (e.currentSessionResource) {
			logChangesToStateModel(this._inputModel, `[CVVM].2 onDidChangeViewModel -> session change: ${this._currentSessionType} -> ${newSessionType} in ${this._currentSessionKey}, ${e.currentSessionResource.toString()}`, undefined, this._inputModel?.state.get(), this.logService);
			this._currentSessionTypeObservable.set(newSessionType, transaction);
			this.restorePerTypeModelAfterViewModelAssignment();
			this.reinitializeIfOutsidePool(() => this.initSelectedModel());
		}
	}

	private restorePerTypeModelAfterViewModelAssignment(): void {
		if (this._restorePerTypeModel) {
			this.initSelectedModel();
			if (!this._modelSelectionController.hasPendingProgrammaticSelection() && !this._modelSelectionController.isAwaitingRememberedModel()) {
				this._modelSelectionController.ensureCurrentModelSupported();
			}
		}
	}

	render(container: HTMLElement, initialValue: string, widget: IChatWidget) {
		this._widget = widget;
		this.clearActiveSkills();
		this.updateDeferredNotificationsEligibility();
		this._currentSessionResourceObservable.set(widget.viewModel?.sessionResource, undefined);
		this._currentSessionModelObservable.set(widget.viewModel?.model, undefined);
		this.getVisibleOptionGroupsModeAndUpdateContextKeys(this.getCurrentSessionResource());

		const delegate = this.options.sessionTypePickerDelegate;
		if (delegate?.setActiveSessionProvider && delegate?.getActiveSessionProvider) {
			const initialSessionType = delegate.getActiveSessionProvider();
			if (initialSessionType) {
				this.updateWidgetLockStateFromSessionType(initialSessionType);
			}
		}

		this._register(widget.onDidChangeViewModel(e => this.handleViewModelChange(e)));

		let elements;
		if (this.options.renderStyle === 'compact') {
			elements = dom.h(`.interactive-input-part.${chatInputSurfaceStackClass}`, [
				dom.h('.chat-input-persistent-content@persistentContentContainer'),
				dom.h(`.chat-session-archive-nudge-container.${chatInputSurfaceStackSlotClass}@sessionArchiveNudgeContainer`),
				dom.h(`.interactive-input-and-edit-session.${chatInputSurfaceStackClass}`, [
					dom.h(`.chat-plan-review-widget-container.${chatInputSurfaceStackSlotClass}@chatPlanReviewContainer`),
					dom.h(`.chat-question-carousel-widget-container.${chatInputSurfaceStackSlotClass}@chatQuestionCarouselContainer`),
					dom.h(`.chat-tool-confirmation-carousel-container.${chatInputSurfaceStackSlotClass}@chatToolConfirmationCarouselContainer`),
					dom.h(`.${chatInputStackClass}`, [
						dom.h(`.chat-input-notification-container.${chatInputStackSlotClass}@chatInputNotificationContainer`),
						dom.h(`.voice-mode-onboarding-container.${chatInputStackSlotClass}@voiceModeOnboardingContainer`),
						dom.h(`.dictation-onboarding-container.${chatInputStackSlotClass}@dictationOnboardingContainer`),
						dom.h(`.chat-goal-banner-container.${chatInputStackSlotClass}@chatGoalBannerContainer`),
						dom.h('.chat-todo-list-widget-container@chatInputTodoListWidgetContainer'),
						dom.h('.chat-artifacts-widget-container@chatArtifactsWidgetContainer'),
						dom.h('.chat-editing-session@chatEditingSessionWidgetContainer'),
						dom.h(`.chat-getting-started-tip-container.${chatInputStackSlotClass}@chatGettingStartedTipContainer`),
						dom.h('.interactive-input-and-side-toolbar@inputAndSideToolbar', [
							dom.h('.chat-input-container@inputContainer', [
								dom.h('.chat-input-skill-chips@skillChipsContainer'),
								dom.h('.chat-editor-container@editorContainer'),
								dom.h('.chat-input-toolbars@inputToolbars'),
							]),
						]),
					]),
					dom.h('.chat-secondary-toolbar@secondaryToolbar', [
						dom.h('.chat-responsive-picker-container@responsivePickerContainer'),
						dom.h('.chat-context-usage-container@contextUsageWidgetContainer'),
						dom.h('.chat-input-status-container@statusToolbarContainer'),
					]),
					dom.h(`.chat-attachments-container.${chatInputSurfaceStackSlotClass}@attachmentsContainer`, [
						dom.h('.chat-attached-context@attachedContextContainer'),
					]),
					dom.h(`.interactive-input-followups.${chatInputSurfaceStackSlotClass}@followupsContainer`),
				])
			]);
		} else {
			elements = dom.h(`.interactive-input-part.${chatInputSurfaceStackClass}`, [
				dom.h('.chat-input-persistent-content@persistentContentContainer'),
				dom.h(`.chat-session-archive-nudge-container.${chatInputSurfaceStackSlotClass}@sessionArchiveNudgeContainer`),
				dom.h(`.chat-plan-review-widget-container.${chatInputSurfaceStackSlotClass}@chatPlanReviewContainer`),
				dom.h(`.chat-question-carousel-widget-container.${chatInputSurfaceStackSlotClass}@chatQuestionCarouselContainer`),
				dom.h(`.chat-tool-confirmation-carousel-container.${chatInputSurfaceStackSlotClass}@chatToolConfirmationCarouselContainer`),
				dom.h(`.interactive-input-followups.${chatInputSurfaceStackSlotClass}@followupsContainer`),
				dom.h(`.${chatInputStackClass}`, [
					dom.h(`.chat-input-notification-container.${chatInputStackSlotClass}@chatInputNotificationContainer`),
					dom.h(`.voice-mode-onboarding-container.${chatInputStackSlotClass}@voiceModeOnboardingContainer`),
					dom.h(`.dictation-onboarding-container.${chatInputStackSlotClass}@dictationOnboardingContainer`),
					dom.h(`.chat-goal-banner-container.${chatInputStackSlotClass}@chatGoalBannerContainer`),
					dom.h('.chat-todo-list-widget-container@chatInputTodoListWidgetContainer'),
					dom.h('.chat-artifacts-widget-container@chatArtifactsWidgetContainer'),
					dom.h('.chat-editing-session@chatEditingSessionWidgetContainer'),
					dom.h(`.chat-getting-started-tip-container.${chatInputStackSlotClass}@chatGettingStartedTipContainer`),
					dom.h('.interactive-input-and-side-toolbar@inputAndSideToolbar', [
						dom.h('.chat-input-container@inputContainer', [
							dom.h('.chat-attachments-container@attachmentsContainer', [
								dom.h('.chat-attached-context@attachedContextContainer'),
							]),
							dom.h('.chat-input-skill-chips@skillChipsContainer'),
							dom.h('.chat-editor-container@editorContainer'),
							dom.h('.chat-input-toolbars@inputToolbars'),
						]),
					]),
				]),
				dom.h('.chat-secondary-toolbar@secondaryToolbar', [
					dom.h('.chat-responsive-picker-container@responsivePickerContainer'),
					dom.h('.chat-context-usage-container@contextUsageWidgetContainer'),
					dom.h('.chat-input-status-container@statusToolbarContainer'),
				]),
			]);
		}
		this.container = elements.root;
		this.persistentContentContainer = elements.persistentContentContainer;
		this.sessionArchiveNudgeContainer = elements.sessionArchiveNudgeContainer;
		this.chatInputOverlay = dom.$('.chat-input-overlay');
		container.append(this.container);
		this.container.append(this.chatInputOverlay);
		this.container.classList.toggle('compact', this.options.renderStyle === 'compact');

		this._scopedContextKeyService = this._register(this.contextKeyService.createScoped(this.container));
		const archiveNudgeContextKeyService = this._register(this.contextKeyService.createScoped(this.sessionArchiveNudgeContainer));
		ChatContextKeys.inChatInput.bindTo(archiveNudgeContextKeyService).set(true);

		this.followupsContainer = elements.followupsContainer;
		const inputAndSideToolbar = elements.inputAndSideToolbar;
		this.inputAndSideToolbar = inputAndSideToolbar;
		const inputContainer = elements.inputContainer;
		this.inputContainer = inputContainer;
		const editorContainer = elements.editorContainer;
		this.attachmentsContainer = elements.attachmentsContainer;
		this.attachedContextContainer = elements.attachedContextContainer;
		this.skillChipsContainer = elements.skillChipsContainer;
		dom.hide(this.skillChipsContainer);
		const toolbarsContainer = elements.inputToolbars;
		this.secondaryToolbarContainer = elements.secondaryToolbar;
		const responsivePickerContainer = elements.responsivePickerContainer;
		if (this.options.renderStyle === 'compact') {
			this.secondaryToolbarContainer.style.display = 'none';
		}
		this.chatEditingSessionWidgetContainer = elements.chatEditingSessionWidgetContainer;
		this.chatInputTodoListWidgetContainer = elements.chatInputTodoListWidgetContainer;
		this.chatArtifactsWidgetContainer = elements.chatArtifactsWidgetContainer;
		this.chatGettingStartedTipContainer = elements.chatGettingStartedTipContainer;
		this.chatQuestionCarouselContainer = elements.chatQuestionCarouselContainer;
		this.chatPlanReviewContainer = elements.chatPlanReviewContainer;
		this.chatToolConfirmationCarouselContainer = elements.chatToolConfirmationCarouselContainer;
		dom.hide(this.chatToolConfirmationCarouselContainer);
		this._register(this.chatInputNoticeHubService.registerHost(this.noticeHost, this.container));
		this.chatInputNotificationContainer = elements.chatInputNotificationContainer;
		this._register(registerChatInputOnboardingHosts(
			this.noticeHost,
			{ voice: elements.voiceModeOnboardingContainer, dictation: elements.dictationOnboardingContainer },
			this.container,
			() => this.focus(),
			this.voiceModeOnboardingService,
			this.dictationOnboardingService,
		));
		this.chatGoalBannerContainer = elements.chatGoalBannerContainer;
		this.contextUsageWidgetContainer = elements.contextUsageWidgetContainer;
		this.statusToolbarContainer = elements.statusToolbarContainer;

		if (this.options.renderStyle === 'compact') {
			toolbarsContainer.prepend(this.contextUsageWidgetContainer);
		}

		this.contextUsageWidget = this._register(this.instantiationService.createInstance(ChatContextUsageWidget));
		this.contextUsageWidget.setChatWidget(widget);
		this.contextUsageWidget.setSelectedModel(this._currentLanguageModel.get()?.identifier);
		this.contextUsageWidget.setModelConfigurationResolver(
			modelId => this.getModelConfiguration(modelId),
			this._modelConfigStore.onDidChange,
		);
		this.contextUsageWidgetContainer.appendChild(this.contextUsageWidget.domNode);

		if (this.options.enableImplicitContext && !this._implicitContext) {
			this._implicitContext = this._register(
				this.instantiationService.createInstance(ChatImplicitContexts),
			);
			this.setImplicitContextEnablement();

			this._register(this._implicitContext.onDidChangeValue(() => {
				this._indexOfLastAttachedContextDeletedWithKeyboard = -1;
				this._handleAttachedContextChange();
			}));
		} else if (!this.options.enableImplicitContext && this._implicitContext) {
			this._implicitContext?.dispose();
			this._implicitContext = undefined;
		}

		this.ensureNotificationWidget();

		this._register(this._attachmentModel.onDidChange((e) => {
			if (e.added.length > 0) {
				this._indexOfLastAttachedContextDeletedWithKeyboard = -1;
			}
			this._handleAttachedContextChange();
		}));

		this.renderChatEditingSessionState(null);

		this.dnd.addOverlay(this.options.dndContainer ?? container, this.options.dndContainer ?? container);

		const inputScopedContextKeyService = this._register(this.contextKeyService.createScoped(inputContainer));
		ChatContextKeys.inChatInput.bindTo(inputScopedContextKeyService).set(true);
		this.currentlyEditingInputKey = ChatContextKeys.currentlyEditingInput.bindTo(inputScopedContextKeyService);
		this.editingSentRequestKey = ChatContextKeys.editingRequestType.bindTo(this.contextKeyService);
		const scopedInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, inputScopedContextKeyService])));

		const { historyNavigationBackwardsEnablement, historyNavigationForwardsEnablement } = this._register(registerAndCreateHistoryNavigationContext(inputScopedContextKeyService, this));
		this.historyNavigationBackwardsEnablement = historyNavigationBackwardsEnablement;
		this.historyNavigationForewardsEnablement = historyNavigationForwardsEnablement;

		const options: IEditorConstructionOptions = getSimpleEditorOptions(this.configurationService);
		options.overflowWidgetsDomNode = this.options.editorOverflowWidgetsDomNode;
		options.pasteAs = EditorOptions.pasteAs.defaultValue;
		options.readOnly = false;
		options.ariaLabel = this._getAriaLabel();
		options.fontFamily = DEFAULT_FONT_FAMILY;
		options.fontSize = 13;
		options.lineHeight = INPUT_EDITOR_LINE_HEIGHT;
		options.padding = this.options.renderStyle === 'compact' ? INPUT_EDITOR_PADDING.compact : INPUT_EDITOR_PADDING.default;
		options.cursorWidth = 1;
		options.wrappingStrategy = 'advanced';
		options.bracketPairColorization = { enabled: false };
		options.autoClosingBrackets = this.configurationService.getValue('editor.autoClosingBrackets');
		options.autoClosingQuotes = this.configurationService.getValue('editor.autoClosingQuotes');
		options.autoSurround = this.configurationService.getValue('editor.autoSurround');
		options.quickSuggestions = this.options.inputEditorQuickSuggestions ?? false;
		options.suggest = {
			showIcons: true,
			showSnippets: false,
			showWords: true,
			showStatusBar: false,
			insertMode: 'insert',
			fitWidthToDetails: true,
		};
		options.scrollbar = this.options.renderStyle === 'compact'
			? { ...(options.scrollbar ?? {}), vertical: 'hidden' }
			: {
				...(options.scrollbar ?? {}),
				vertical: 'auto',
				verticalScrollbarSize: 7,
			};
		options.stickyScroll = { enabled: false };

		this._inputEditorElement = dom.append(editorContainer, $(chatInputEditorContainerSelector));
		const editorOptions = getSimpleCodeEditorWidgetOptions();
		editorOptions.contributions?.push(...EditorExtensionsRegistry.getSomeEditorContributions([ContentHoverController.ID, GlyphHoverController.ID, DropIntoEditorController.ID, CopyPasteController.ID, LinkDetector.ID, InlineCompletionsController.ID, PlaceholderTextContribution.ID]));
		this._inputEditor = this._register(scopedInstantiationService.createInstance(CodeEditorWidget, this._inputEditorElement, options, editorOptions));
		this.updateInputEditorFontFamily();
		this._register(addDisposableListener(this._inputEditorElement, dom.EventType.PASTE, e => this.handleTerminalCommandPaste(e), true));
		this._register(addDisposableListener(this.inputContainer, dom.EventType.PASTE, e => this.handleTerminalCommandPaste(e), true));

		const dictationRecording = ChatContextKeys.speechToTextRecording.bindTo(this.contextKeyService);
		const dictationPreparing = ChatContextKeys.speechToTextPreparing.bindTo(this.contextKeyService);
		const isDictationInputActive = observableFromEvent(
			this,
			Event.any(this.speechToTextService.onDidChangeState, this.speechToTextService.onDidChangePreparingModel, onDidChangeDictationEditor),
			() => isDictationActiveForEditor(this._inputEditor),
		);
		const updateDictationContextKeys = () => {
			const active = isDictationActiveForEditor(this._inputEditor);
			dictationRecording.set(active && this.speechToTextService.state === ChatSpeechToTextState.Recording);
			dictationPreparing.set(active && this.speechToTextService.isPreparingModel);
		};
		this._register(Event.any(this.speechToTextService.onDidChangeState, this.speechToTextService.onDidChangePreparingModel, onDidChangeDictationEditor)(updateDictationContextKeys));
		updateDictationContextKeys();

		const suggestController = SuggestController.get(this._inputEditor);
		if (suggestController) {
			suggestController.forceRenderingAbove();
			this._register(suggestController.widget.value.onDidShow(() => {
				this._updateSuggestWidgetBounds();
			}));
		}
		options.overflowWidgetsDomNode?.classList.add('hideSuggestTextIcons');
		this._inputEditorElement.classList.add('hideSuggestTextIcons');
		this._updateSuggestWidgetBounds();

		this._register(this._inputEditor.onKeyDown((e) => {
			if (e.keyCode === KeyCode.Backspace && !hasModifierKeys(e)) {
				const model = this._inputEditor.getModel();
				if (model && model.getValueLength() === 0 && this._activeSkills.size > 0) {
					const skills = Array.from(this._activeSkills);
					const lastSkill = skills[skills.length - 1];
					if (lastSkill) {
						this.removeSkill(lastSkill);
						e.preventDefault();
						e.stopPropagation();
						return;
					}
				}
			}
			if (e.keyCode === KeyCode.Enter && !hasModifierKeys(e)) {
				const model = this._inputEditor.getModel();
				if (model) {
					this.extractSkillsFromInput(model, true);
				}
				for (const keybinding of this.keybindingService.lookupKeybindings(ChatSubmitAction.ID)) {
					const chords = keybinding.getDispatchChords();
					const isPlainEnter = chords.length === 1 && chords[0] === '[Enter]';
					if (isPlainEnter) {
						e.preventDefault();
						break;
					}
				}
			}
		}));

		this._register(this._inputEditor.onDidChangeModelContent(() => {
			const model = this._inputEditor.getModel();
			if (model) {
				this.extractSkillsFromInput(model, false);
			}

			const currentHeight = Math.min(this._inputEditor.getContentHeight(), this._effectiveInputEditorMaxHeight);
			if (currentHeight !== this.inputEditorHeight) {
				this.inputEditorHeight = currentHeight;
				if (this.cachedWidth) {
					this._layout(this.cachedWidth);
				}
			}

			this._updateInputContentContextKeys();
			this.updateInputEditorFontFamily();
			this._syncTextDebounced.schedule();
		}));
		this._register(this._inputEditor.onDidContentSizeChange(e => {
			if (e.contentHeightChanged && !this.ignoreInputEditorContentSizeChanges) {
				this.inputEditorHeight = !this.inline ? e.contentHeight : this.inputEditorHeight;
				if (this.cachedWidth) {
					this._layout(this.cachedWidth);
				}
			}
		}));
		this._register(this._inputEditor.onDidFocusEditorText(() => {
			this.inputEditorHasFocus.set(true);
			this._onDidFocus.fire();
			inputContainer.classList.toggle('focused', true);
			setChatInputStackInputFocused(inputContainer, true);
		}));
		this._register(this._inputEditor.onDidBlurEditorText(() => {
			this.inputEditorHasFocus.set(false);
			inputContainer.classList.toggle('focused', false);
			setChatInputStackInputFocused(inputContainer, false);

			this._onDidBlur.fire();
		}));
		this._register(this._inputEditor.onDidBlurEditorWidget(() => {
			CopyPasteController.get(this._inputEditor)?.clearWidgets();
			DropIntoEditorController.get(this._inputEditor)?.clearWidgets();
		}));

		const hoverDelegate = this._register(createInstantHoverDelegate());

		const { location: _location } = this.getWidgetLocationInfo(widget);
		const focusedWidget = observableFromEvent(this, this.chatWidgetService.onDidChangeFocusedSession, () => this.chatWidgetService.lastFocusedWidget);
		const voiceSessionResource = observableFromEvent(this, widget.onDidChangeViewModel, () => widget.viewModel?.sessionResource);
		const isVoiceInputActive = derived(this, reader => focusedWidget.read(reader) === widget);
		const isVoiceSessionActive = derived(this, reader => {
			const target = this.voiceSessionController.targetSession.read(reader);
			const hasDraftTarget = this.voiceSessionController.hasDraftTarget.read(reader);
			const resource = voiceSessionResource.read(reader);
			return isVoiceSessionActiveForInput(isVoiceInputActive.read(reader), target, hasDraftTarget, resource);
		});

		const inputPickerCompactStates = new Map<string, ISettableObservable<boolean>>();
		const inputPickerMinimalStates = new Map<string, ISettableObservable<boolean>>();
		const secondaryPickerCompactStates = new Map<string, ISettableObservable<boolean>>();
		const inputOverflowPickerHandlers = new Map<string, (anchor: HTMLElement) => void>();
		const secondaryOverflowPickerHandlers = new Map<string, (anchor: HTMLElement) => void>();
		const getCompactState = (states: Map<string, ISettableObservable<boolean>>, actionId: string): ISettableObservable<boolean> => {
			let state = states.get(actionId);
			if (!state) {
				state = observableValue(this, false);
				states.set(actionId, state);
			}
			return state;
		};
		const getInputPickerOptions = (actionId: string): IChatInputPickerOptions => ({
			getOverflowAnchor: () => this.inputActionsToolbar.getElement(),
			actionContext: { widget },
			compact: getCompactState(inputPickerCompactStates, actionId),
			iconOnly: actionId === OpenPermissionPickerAction.ID,
			minimal: actionId === OpenModelPickerAction.ID ? getCompactState(inputPickerMinimalStates, actionId) : undefined,
		});
		const getSecondaryPickerOptions = (actionId: string): IChatInputPickerOptions => ({
			getOverflowAnchor: () => this.secondaryToolbar.getElement(),
			actionContext: { widget },
			compact: getCompactState(secondaryPickerCompactStates, actionId),
			iconOnly: actionId === OpenPermissionPickerAction.ID,
		});
		const showOverflowPicker = (factory: () => ShowableActionViewItem | undefined, anchor: HTMLElement): void => {
			const item = factory();
			if (!item) {
				return;
			}
			this.overflowPickerWidget.value = item;
			item.render(dom.$('.chat-overflow-picker-item'));
			item.show(anchor);
		};
		const showRegisteredOverflowPicker = (factory: IActionViewItemFactory, action: IAction, anchor: HTMLElement): boolean => {
			const item = factory(action, { hoverDelegate }, this.instantiationService, dom.getWindow(anchor).vscodeWindowId);
			if (!isShowableActionViewItem(item)) {
				item?.dispose();
				return false;
			}
			this.overflowPickerWidget.value = item;
			item.render(dom.$('.chat-overflow-picker-item'));
			item.show(anchor);
			return true;
		};
		const getOverflowAction = (
			action: IAction,
			menuId: MenuId,
			handlers: ReadonlyMap<string, (anchor: HTMLElement) => void>,
			getAnchor: () => HTMLElement | undefined,
			fallbackAnchor: HTMLElement,
			hostHandler?: (actionId: string, anchor: HTMLElement) => boolean,
		): IAction => {
			const handler = handlers.get(action.id);
			const registeredFactory = this.actionViewItemService.lookUp(menuId, action.id);
			if (!handler && !hostHandler && !registeredFactory) {
				return action;
			}
			return createOverflowAction(action, () => {
				const overflowAnchor = getAnchor();
				const anchor = overflowAnchor ?? fallbackAnchor;
				dom.getWindow(anchor).setTimeout(() => {
					overflowAnchor?.focus();
					if (handler) {
						handler(anchor);
					} else if (hostHandler?.(action.id, anchor)) {
						return;
					} else if (registeredFactory && showRegisteredOverflowPicker(registeredFactory, action, anchor)) {
						return;
					} else {
						void action.run({ widget } satisfies IChatExecuteActionContext);
					}
				}, 0);
			});
		};

		const shorterChatInputActionIds = new Set<string>([
			OpenPermissionPickerAction.ID,
			ConfigureToolsAction.ID,
		]);
		const getInputActionMinWidth = (action: IAction): number | undefined => {
			if (action.id === OpenModelPickerAction.ID) {
				return this.modelWidget?.minimumWidth ?? 60;
			}
			if (shorterChatInputActionIds.has(action.id)) {
				return CHAT_INPUT_COMPACT_PICKER_WIDTH;
			}
			return inputPickerCompactStates.get(action.id)?.get() ? CHAT_INPUT_COMPACT_PICKER_WIDTH : undefined;
		};

		this._register(dom.addStandardDisposableListener(toolbarsContainer, dom.EventType.CLICK, e => this.inputEditor.focus()));
		this._register(dom.addStandardDisposableListener(this.attachmentsContainer, dom.EventType.CLICK, e => this.inputEditor.focus()));
		const inputToolbarMenu = this.options.menus.inputToolbar ?? MenuId.ChatInput;
		this.inputActionsToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, this.options.renderInputToolbarBelowInput ? this.attachmentsContainer : toolbarsContainer, inputToolbarMenu, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: { shouldForwardArgs: true },
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			hoverDelegate,
			responsiveBehavior: {
				enabled: true,
				kind: 'last',
				minItems: 2,
				actionMinWidth: 48,
				getActionMinWidth: getInputActionMinWidth,
				allowOverflow: () => this._inputPickerResponsiveLayout?.areAllItemsCompact() === true,
				getOverflowAction: (action, getAnchor) => getOverflowAction(action, inputToolbarMenu, inputOverflowPickerHandlers, getAnchor, toolbarsContainer),
			},
			actionViewItemProvider: (action, options) => {
				if (action.id === OpenModelPickerAction.ID && action instanceof MenuItemAction) {
					if (!this._currentLanguageModel.get()) {
						this._modelSelectionDiagnostics.report('no-model-at-toolbar-build', {}, 'info');
						this.setCurrentLanguageModelToDefault();
					}

					const itemDelegate: IModelPickerDelegate = this._createModelPickerDelegate();
					const createPicker = () => this.instantiationService.createInstance(ModelPickerActionItem, action, itemDelegate, getInputPickerOptions(action.id));
					inputOverflowPickerHandlers.set(action.id, anchor => showOverflowPicker(createPicker, anchor));
					return this.modelWidget = createPicker();
				} else if (action.id === OpenModePickerAction.ID && action instanceof MenuItemAction) {
					const delegate: IModePickerDelegate = this._createModePickerDelegate();
					const createPicker = () => this.instantiationService.createInstance(ModePickerActionItem, action, delegate, getInputPickerOptions(action.id));
					this.modeWidgetDisposable.value = this.modeWidget = createPicker();
					return new HiddenActionViewItem(action);
				} else if (action.id === OpenPermissionPickerAction.ID && action instanceof MenuItemAction) {
					const delegate = this._createPermissionPickerDelegate();
					const createPicker = () => this.instantiationService.createInstance(PermissionPickerActionItem, action, delegate, getInputPickerOptions(action.id));
					inputOverflowPickerHandlers.set(action.id, anchor => showOverflowPicker(createPicker, anchor));
					const permissionWidget = createPicker();
					this.permissionWidget = permissionWidget;
					this.permissionWidgetDisposeListener.value = permissionWidget.onDidDispose(() => {
						if (this.permissionWidget === permissionWidget) {
							this.permissionWidget = undefined;
						}
						this.permissionWidgetDisposeListener.clear();
					});
					return permissionWidget;
				} else if (action.id === ChatSessionPrimaryPickerAction.ID && action instanceof MenuItemAction) {
					const createPicker = () => {
						const widgets = this.createChatSessionPickerWidgets(action, getInputPickerOptions(action.id));
						return widgets.length === 0 ? undefined : this.instantiationService.createInstance(ChatSessionPickersContainerActionItem, action, widgets);
					};
					inputOverflowPickerHandlers.set(action.id, anchor => showOverflowPicker(createPicker, anchor));
					return createPicker() ?? new HiddenActionViewItem(action);
				}
				return undefined;
			}
		}));
		this.inputActionsToolbar.getElement().classList.add('chat-input-toolbar');
		this.inputActionsToolbar.context = { widget } satisfies IChatExecuteActionContext;
		this._register(this.inputActionsToolbar.onDidChangeMenuItems(() => {
			const toolbarElement = this.inputActionsToolbar.getElement();
			// eslint-disable-next-line no-restricted-syntax
			const primaryPickerContainer = toolbarElement.querySelector('.chat-sessionPicker-container');
			if (primaryPickerContainer) {
				this.chatSessionPickerContainer = primaryPickerContainer as HTMLElement;
			}
			if (this.cachedWidth && typeof this.cachedInputToolbarWidth === 'number' && this.cachedInputToolbarWidth !== this.inputActionsToolbar.getItemsWidth()) {
				this._toolbarRelayoutScheduler.schedule();
			}
		}));
		this.executeToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, toolbarsContainer, this.options.menus.executeToolbar, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: {
				shouldForwardArgs: true
			},
			hoverDelegate,
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			actionViewItemProvider: (action, options) => {
				if (action.id === ChatVoiceInputModeAction.ID) {
					return this.instantiationService.createInstance(VoiceInputModeActionViewItem, action, {
						isActive: isVoiceInputActive,
						isDictationActive: isDictationInputActive,
						isVoiceActive: isVoiceSessionActive,
					});
				}
				if ((action.id === ChatSubmitAction.ID || action.id === ChatEditingSessionSubmitAction.ID) && action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(class extends MenuEntryActionViewItem {
						override render(container: HTMLElement): void {
							super.render(container);
							container.classList.add('chat-submit-button');
						}
					}, action, options);
				}
				if ((action.id === ChatSpeechToTextPreparingAction.ID || action.id === ChatSpeechToTextConnectingAction.ID) && action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(DictationDownloadActionViewItem, action, options);
				}
				if (action.id === ToggleChatSpeechToTextAction.ID && action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(DictationActionViewItem, action, options, isDictationInputActive);
				}
				if ((action.id === 'agentsVoice.startVoiceInChat' || action.id === 'agentsVoice.pttStopInChat') && action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(VoiceModeActionViewItem, action, options);
				}
				return undefined;
			},
		}));
		this.executeToolbar.getElement().classList.add('chat-execute-toolbar');
		this.executeToolbar.context = { widget } satisfies IChatExecuteActionContext;
		const voiceInputActionIconClasses = new Set([
			Codicon.micCompact, Codicon.micFilled, Codicon.micDownloadCompact,
			Codicon.voiceModeCompact, Codicon.loadingCompact, Codicon.debugDisconnectCompact,
		].map(icon => ThemeIcon.asClassName(icon)));
		const updateVoiceInputActionBorder = () => {
			let voiceInputActionCount = 0;
			for (let i = 0; ; i++) {
				const action = this.executeToolbar.getItemAction(i);
				if (!action) {
					break;
				}
				if (action.class && voiceInputActionIconClasses.has(action.class)) {
					voiceInputActionCount++;
				}
			}
			this.executeToolbar.getElement().classList.toggle('chat-voice-input-actions-multiple', voiceInputActionCount > 1);
		};
		updateVoiceInputActionBorder();
		this._register(this.executeToolbar.onDidChangeMenuItems(() => {
			updateVoiceInputActionBorder();
			if (this.cachedWidth && typeof this.cachedExecuteToolbarWidth === 'number' && this.cachedExecuteToolbarWidth !== this.executeToolbar.getItemsWidth()) {
				this._toolbarRelayoutScheduler.schedule();
			}
		}));
		if (this.options.menus.inputSideToolbar) {
			const toolbarSide = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, inputAndSideToolbar, this.options.menus.inputSideToolbar, {
				telemetrySource: this.options.menus.telemetrySource,
				menuOptions: {
					shouldForwardArgs: true
				},
				hoverDelegate
			}));
			this.inputSideToolbarContainer = toolbarSide.getElement();
			toolbarSide.getElement().classList.add('chat-side-toolbar');
			toolbarSide.context = { widget } satisfies IChatExecuteActionContext;
		}

		const secondaryPickerMinWidths = new Map<string, number>([
			[OpenSessionTargetPickerAction.ID, CHAT_INPUT_COMPACT_PICKER_WIDTH],
			[OpenWorkspacePickerAction.ID, CHAT_INPUT_COMPACT_PICKER_WIDTH],
			[OpenPermissionPickerAction.ID, CHAT_INPUT_COMPACT_PICKER_WIDTH],
			[ChatSessionPrimaryPickerAction.ID, CHAT_INPUT_COMPACT_PICKER_WIDTH],
			['sessions.tunnelHost.toggleSharing', 16],
		]);
		const getSecondaryToolbarAvailableWidth = (): number => {
			const laneWidth = responsivePickerContainer.getBoundingClientRect().width;
			return laneWidth;
		};
		this.secondaryToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, responsivePickerContainer, MenuId.ChatInputSecondary, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: { shouldForwardArgs: true },
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			hoverDelegate,
			responsiveBehavior: {
				enabled: true,
				kind: 'all',
				minItems: 1,
				actionMinWidth: 48,
				getActionMinWidth: action => secondaryPickerMinWidths.get(action.id) ?? (secondaryPickerCompactStates.get(action.id)?.get() ? 22 : undefined),
				observedElement: responsivePickerContainer,
				getAvailableWidth: getSecondaryToolbarAvailableWidth,
				allowOverflow: () => this._secondaryPickerResponsiveLayout?.areAllItemsCompact() === true,
				getOverflowAction: (action, getAnchor) => getOverflowAction(action, MenuId.ChatInputSecondary, secondaryOverflowPickerHandlers, getAnchor, responsivePickerContainer, this.options.secondaryToolbarOverflowActionHandler),
			},
			actionViewItemProvider: (action, options) => {
				const customSecondaryItem = this.options.secondaryToolbarActionViewItemProvider?.(action, options);
				if (customSecondaryItem) {
					getCompactState(secondaryPickerCompactStates, action.id);
					return customSecondaryItem;
				}
				if (action.id === OpenWorkspacePickerAction.ID && action instanceof MenuItemAction) {
					const workspacePickerDelegate = this.options.workspacePickerDelegate;
					if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY && workspacePickerDelegate) {
						const createPicker = () => this.instantiationService.createInstance(WorkspacePickerActionItem, action, workspacePickerDelegate, getSecondaryPickerOptions(action.id));
						secondaryOverflowPickerHandlers.set(action.id, anchor => showOverflowPicker(createPicker, anchor));
						return createPicker();
					} else {
						return new HiddenActionViewItem(action);
					}
				} else if (action.id === OpenPermissionPickerAction.ID && action instanceof MenuItemAction) {
					const delegate = this._createPermissionPickerDelegate();
					const createPicker = () => this.instantiationService.createInstance(PermissionPickerActionItem, action, delegate, getSecondaryPickerOptions(action.id));
					secondaryOverflowPickerHandlers.set(action.id, anchor => showOverflowPicker(createPicker, anchor));
					const widget = createPicker();
					this.permissionWidget = widget;
					this.permissionWidgetDisposeListener.value = widget.onDidDispose(() => {
						if (this.permissionWidget === widget) {
							this.permissionWidget = undefined;
						}
						this.permissionWidgetDisposeListener.clear();
					});
					return widget;
				} else if (action.id === ChatSessionPrimaryPickerAction.ID && action instanceof MenuItemAction) {
					const createPicker = () => {
						const widgets = this.createChatSessionPickerWidgets(action, getSecondaryPickerOptions(action.id));
						return widgets.length === 0 ? undefined : this.instantiationService.createInstance(ChatSessionPickersContainerActionItem, action, widgets);
					};
					secondaryOverflowPickerHandlers.set(action.id, anchor => showOverflowPicker(createPicker, anchor));
					return createPicker() ?? new HiddenActionViewItem(action);
				}
				return undefined;
			}
		}));
		this.secondaryToolbar.getElement().classList.add('chat-secondary-input-toolbar');
		this.secondaryToolbar.context = { widget } satisfies IChatExecuteActionContext;
		this._register(this.secondaryToolbar.onDidChangeMenuItems(() => {
			const toolbarElement = this.secondaryToolbar.getElement();
			// eslint-disable-next-line no-restricted-syntax
			const container = toolbarElement.querySelector('.chat-sessionPicker-container');
			if (dom.isHTMLElement(container)) {
				this.chatSessionPickerContainer = container;
			}
		}));

		this.statusToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, this.statusToolbarContainer, MenuId.ChatInputStatus, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: { shouldForwardArgs: true },
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			hoverDelegate,
		}));
		this.statusToolbar.getElement().classList.add('chat-input-status-toolbar');
		this.statusToolbar.context = { widget } satisfies IChatExecuteActionContext;

		const inputToolbarElement = this.inputActionsToolbar.getElement();
		this._inputPickerResponsiveLayout = this._register(new ChatInputPickerResponsiveLayout('ChatInputPart.primaryPicker', inputToolbarElement, {
			getItems: () => getToolbarPickerResponsiveItems(this.inputActionsToolbar, inputPickerCompactStates, inputPickerMinimalStates),
			hasOverflow: () => this.inputActionsToolbar.hasOverflow(),
			relayout: () => this.inputActionsToolbar.relayout(),
		}));

		this._secondaryPickerResponsiveLayout = this._register(new ChatInputPickerResponsiveLayout('ChatInputPart.secondaryPicker', responsivePickerContainer, {
			getItems: () => [
				...getToolbarPickerResponsiveItems(this.secondaryToolbar, secondaryPickerCompactStates),
			],
			hasOverflow: () => this.secondaryToolbar.hasOverflow(),
			relayout: () => this.secondaryToolbar.relayout(),
		}));

		this._inputPickerResponsiveLayout.layout();
		this._secondaryPickerResponsiveLayout.layout();

		let inputModel = this.modelService.getModel(this.inputUri);
		let createdInputModel: ITextModel | undefined;
		if (!inputModel) {
			inputModel = createdInputModel = this.modelService.createModel('', null, this.inputUri, false);
		}

		const inputModelReference = this.textModelResolverService.createModelReference(this.inputUri);
		if (createdInputModel) {
			const model = createdInputModel;
			this._register(toDisposable(() => {
				void inputModelReference.then(
					() => model.dispose(),
					() => model.dispose()
				);
			}));
		}
		inputModelReference.then(ref => {
			if (this._store.isDisposed) {
				ref.dispose();
				return;
			}
			this._register(ref);
		}, error => {
			if (!this._store.isDisposed) {
				onUnexpectedError(error);
			}
		});

		this.inputModel = inputModel;
		this.inputModel.updateOptions({ bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
		this._inputEditor.setModel(this.inputModel);
		if (initialValue) {
			this.inputModel.setValue(initialValue);
			const lineNumber = this.inputModel.getLineCount();
			this._inputEditor.setPosition({ lineNumber, column: this.inputModel.getLineMaxColumn(lineNumber) });
		}

		const onDidChangeCursorPosition = () => {
			const model = this._inputEditor.getModel();
			if (!model) {
				return;
			}

			const position = this._inputEditor.getPosition();
			if (!position) {
				return;
			}

			const atTop = position.lineNumber === 1 && position.column === 1;
			this.chatCursorAtTop.set(atTop);

			this.historyNavigationBackwardsEnablement.set(atTop);
			this.historyNavigationForewardsEnablement.set(position.equals(getLastPosition(model)));

			this._syncInputStateToModel();
		};
		this._register(this._inputEditor.onDidChangeCursorPosition(e => onDidChangeCursorPosition()));
		onDidChangeCursorPosition();

		this._register(this.themeService.onDidFileIconThemeChange(() => {
			this.renderAttachedContext();
		}));

		this.renderAttachedContext();

		this.setSessionArchiveNudge(this.sessionArchiveNudgeOptions);

		const updateCarouselMaxHeightScheduler = this._register(new dom.AnimationFrameScheduler(this.container, () => this.updateToolConfirmationCarouselMaxHeight()));
		const inputResizeObserver = this._register(new dom.DisposableResizeObserver('ChatInputPart.containerHeight', () => {
			this._updateSuggestWidgetBounds();
			updateCarouselMaxHeightScheduler.schedule();
			const newHeight = this.container.offsetHeight;
			this.height.set(newHeight, undefined);
		}));
		this._register(inputResizeObserver.observe(this.container));

		if (this.options.renderStyle === 'compact') {
			const toolbarsResizeObserver = this._register(new dom.DisposableResizeObserver('ChatInputPart.compactToolbars', () => {
				this.layoutForToolbarChange();
			}));
			this._register(toolbarsResizeObserver.observe(toolbarsContainer));
		}
	}

	public toggleChatInputOverlay(editing: boolean): void {
		this.chatInputOverlay.classList.toggle('disabled', editing);
		if (editing) {
			this.overlayClickListener.value = dom.addStandardDisposableListener(this.chatInputOverlay, dom.EventType.CLICK, e => {
				e.preventDefault();
				e.stopPropagation();
				this._onDidClickOverlay.fire();
			});
		} else {
			this.overlayClickListener.clear();
		}
	}

	public renderAttachedContext() {
		const container = this.attachedContextContainer;
		const store = new DisposableStore();
		this.attachedContextDisposables.value = store;

		dom.clearNode(container);

		store.add(dom.addStandardDisposableListener(this.attachmentsContainer, dom.EventType.KEY_DOWN, (e: StandardKeyboardEvent) => {
			this.handleAttachmentNavigation(e);
		}));

		const attachments = this.getRenderableAttachments()
			.map((attachment, index): [number, IChatRequestVariableEntry] => [index, attachment]);
		const hasAttachments = Boolean(attachments.length);

		let hasImplicitContext = false;
		const isSuggestedEnabled = this.configurationService.getValue<boolean>('chat.implicitContext.suggestedContext');
		const hasVisibleImplicitContext = isSuggestedEnabled
			? this._implicitContext?.hasValue ?? false
			: this._implicitContext?.values.some(v => v.enabled || v.isSelection) ?? false;
		if (this._implicitContext && hasVisibleImplicitContext) {
			const isAttachmentAlreadyAttached = (targetUri: URI | undefined, targetRange: IRange | undefined, targetHandle: number | undefined): boolean => {
				return isImplicitContextAlreadyAttached(this._attachmentModel.attachments, targetUri, targetRange, targetHandle);
			};
			const implicitContextWidget = this.instantiationService.createInstance(
				ImplicitContextAttachmentWidget,
				() => this._widget,
				isAttachmentAlreadyAttached,
				this._implicitContext,
				this._contextResourceLabels,
				this._attachmentModel,
				container,
			);
			store.add(implicitContextWidget);
			hasImplicitContext = implicitContextWidget.hasRenderedContexts;
		}

		dom.setVisibility(Boolean(this.options.renderInputToolbarBelowInput || hasAttachments || hasImplicitContext), this.attachmentsContainer);
		dom.setVisibility(hasAttachments || hasImplicitContext, this.attachedContextContainer);
		if (!attachments.length) {
			this._indexOfLastAttachedContextDeletedWithKeyboard = -1;
			this._indexOfLastOpenedContext = -1;
		}

		const maxImagesPerRequest = getImageAttachmentLimit(this._currentLanguageModel.get()?.metadata);
		const imageAttachments = attachments.filter(([, a]) => isImageVariableEntry(a));
		if (maxImagesPerRequest !== undefined && imageAttachments.length > maxImagesPerRequest) {
			const excessCount = imageAttachments.length - maxImagesPerRequest;
			for (let i = 0; i < excessCount; i++) {
				const attachment = imageAttachments[i][1];
				if (attachment.omittedState === OmittedState.NotOmitted || attachment.omittedState === OmittedState.ImageLimitExceeded) {
					attachment.omittedState = OmittedState.ImageLimitExceeded;
				}
			}
			for (let i = excessCount; i < imageAttachments.length; i++) {
				if (imageAttachments[i][1].omittedState === OmittedState.ImageLimitExceeded) {
					imageAttachments[i][1].omittedState = OmittedState.NotOmitted;
				}
			}
		} else {
			for (const [, a] of imageAttachments) {
				if (a.omittedState === OmittedState.ImageLimitExceeded) {
					a.omittedState = OmittedState.NotOmitted;
				}
			}
		}


		for (const [index, attachment] of attachments) {
			const resource = URI.isUri(attachment.value) ? attachment.value : isLocation(attachment.value) ? attachment.value.uri : undefined;
			const range = isLocation(attachment.value) ? attachment.value.range : undefined;
			const shouldFocusClearButton = index === Math.min(this._indexOfLastAttachedContextDeletedWithKeyboard, attachments.length - 1) && this._indexOfLastAttachedContextDeletedWithKeyboard > -1;

			let attachmentWidget;
			const options = { shouldFocusClearButton, supportsDeletion: true, isCurrentInput: true };
			const lm = this._currentLanguageModel.get();
			if (attachment.kind === 'tool' || attachment.kind === 'toolset') {
				attachmentWidget = this.instantiationService.createInstance(ToolSetOrToolItemAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (resource && isNotebookOutputVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(NotebookCellOutputChatAttachmentWidget, resource, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isPromptFileVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(PromptFileAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isPromptTextVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(PromptTextAttachmentWidget, attachment, undefined, options, container, this._contextResourceLabels);
			} else if (resource && (attachment.kind === 'file' || attachment.kind === 'directory')) {
				attachmentWidget = this.instantiationService.createInstance(FileAttachmentWidget, resource, range, attachment, undefined, lm, options, container, this._contextResourceLabels);
			} else if (attachment.kind === 'terminalCommand') {
				attachmentWidget = this.instantiationService.createInstance(TerminalCommandAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isImageVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(ImageAttachmentWidget, resource, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isElementVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(ElementChatAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isPasteVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(PasteAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isSCMHistoryItemVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(SCMHistoryItemAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isSCMHistoryItemChangeVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(SCMHistoryItemChangeAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isSCMHistoryItemChangeRangeVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(SCMHistoryItemChangeRangeAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else if (isBrowserViewVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(BrowserViewAttachmentWidget, attachment, lm, options, container, this._contextResourceLabels);
			} else {
				attachmentWidget = this._chatAttachmentWidgetRegistry.createWidget(attachment, options, container)
					?? this.instantiationService.createInstance(DefaultChatAttachmentWidget, resource, range, attachment, undefined, lm, options, container, this._contextResourceLabels);
			}

			if (shouldFocusClearButton) {
				attachmentWidget.element.focus();
			}

			if (index === Math.min(this._indexOfLastOpenedContext, attachments.length - 1)) {
				attachmentWidget.element.focus();
			}

			store.add(attachmentWidget);
			store.add(attachmentWidget.onDidDelete(e => {
				this.handleAttachmentDeletion(e, index, attachment);
			}));

			store.add(attachmentWidget.onDidOpen(e => {
				this.handleAttachmentOpen(index, attachment);
			}));
		}

		this._indexOfLastOpenedContext = -1;
	}

	private removeInlineReferenceText(attachment: IChatRequestVariableEntry): void {
		if (!attachment.range || !isPastedTextArtifact(attachment)) {
			return;
		}
		const model = this._inputEditor.getModel();
		const reference = this._widget?.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID)?.variables
			.find(variable => variable.id === attachment.id);
		if (!model || !reference) {
			return;
		}
		const range = Range.lift(reference.range);
		const endColumn = model.getValueInRange(new Range(range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn + 1)) === ' '
			? range.endColumn + 1
			: range.endColumn;
		this._inputEditor.executeEdits('chatRemoveAttachmentReference', [{
			range: new Range(range.startLineNumber, range.startColumn, range.endLineNumber, endColumn),
			text: '',
		}]);
	}

	private handleAttachmentDeletion(e: KeyboardEvent | unknown, index: number, attachment: IChatRequestVariableEntry) {
		if (dom.isKeyboardEvent(e)) {
			this._indexOfLastAttachedContextDeletedWithKeyboard = index;
		}

		this._attachmentModel.delete(attachment.id);
		this.removeInlineReferenceText(attachment);


		if (this.configurationService.getValue<boolean>('chat.implicitContext.enableImplicitContext')) {
			for (const implicitContext of (this._implicitContext?.values || [])) {
				const implicitValue = URI.isUri(implicitContext?.value) && URI.isUri(attachment.value) && isEqual(implicitContext.value, attachment.value);

				if (implicitContext?.isFile && implicitValue) {
					implicitContext.enabled = false;
				}
			}
		}

		if (this.getRenderableAttachments().length === 0) {
			this.focus();
		}

		this._onDidChangeContext.fire({ removed: [attachment] });
		this.renderAttachedContext();
	}

	private getRenderableAttachments(): readonly IChatRequestVariableEntry[] {
		return this.attachmentModel.attachments;
	}

	private handleAttachmentOpen(index: number, attachment: IChatRequestVariableEntry): void {
		this._indexOfLastOpenedContext = index;
		this._indexOfLastAttachedContextDeletedWithKeyboard = -1;

		if (this.getRenderableAttachments().length === 0) {
			this.focus();
		}
	}

	private handleAttachmentNavigation(e: StandardKeyboardEvent): void {
		if (!e.equals(KeyCode.LeftArrow) && !e.equals(KeyCode.RightArrow)) {
			return;
		}

		// eslint-disable-next-line no-restricted-syntax
		const attachments = Array.from(this.attachedContextContainer.querySelectorAll('.chat-attached-context-attachment'));
		if (!attachments.length) {
			return;
		}

		const activeElement = dom.getWindow(this.attachmentsContainer).document.activeElement;
		const currentIndex = attachments.findIndex(attachment => attachment === activeElement);
		let newIndex = currentIndex;

		if (e.equals(KeyCode.LeftArrow)) {
			newIndex = currentIndex > 0 ? currentIndex - 1 : attachments.length - 1;
		} else if (e.equals(KeyCode.RightArrow)) {
			newIndex = currentIndex < attachments.length - 1 ? currentIndex + 1 : 0;
		}

		if (newIndex !== -1) {
			const nextElement = attachments[newIndex] as HTMLElement;
			nextElement.focus();
			e.preventDefault();
			e.stopPropagation();
		}
	}

	async renderChatTodoListWidget(chatSessionResource: URI) {

		const isTodoWidgetEnabled = this.configurationService.getValue<boolean>(ChatConfiguration.TodosShowWidget) !== false;
		if (!isTodoWidgetEnabled) {
			return;
		}

		if (!this._chatInputTodoListWidget.value) {
			const widget = this._chatEditingTodosDisposables.add(this.instantiationService.createInstance(ChatTodoListWidget));
			this._chatInputTodoListWidget.value = widget;

			dom.clearNode(this.chatInputTodoListWidgetContainer);
			widget.attachTo(this.chatInputTodoListWidgetContainer);
		}

		this._chatInputTodoListWidget.value.render(chatSessionResource);
	}

	clearTodoListWidget(sessionResource: URI | undefined, force: boolean): void {
		this._chatInputTodoListWidget.value?.clear(sessionResource, force);
	}

	renderArtifactsWidget(chatSessionResource: URI): void {
		if (!this.configurationService.getValue<boolean>(ChatConfiguration.ArtifactsEnabled)) {
			return;
		}

		if (!this._chatArtifactsWidget.value) {
			const widget = this._register(this.instantiationService.createInstance(ChatArtifactsWidget));
			this._chatArtifactsWidget.value = widget;
			dom.clearNode(this.chatArtifactsWidgetContainer);
			widget.attachTo(this.chatArtifactsWidgetContainer);
		}
		this._chatArtifactsWidget.value.setSessionResource(chatSessionResource);
	}

	clearArtifactsWidget(): void {
		this._chatArtifactsWidget.value?.setSessionResource(undefined);
	}

	renderQuestionCarousel(carousel: IChatQuestionCarousel, context: IChatContentPartRenderContext, options: IChatQuestionCarouselOptions): ChatQuestionCarouselPart {

		const carouselKey = carousel.resolveId ?? `${isResponseVM(context.element) ? context.element.requestId : ''}_${context.contentIndex}`;

		const existing = this._chatQuestionCarouselWidgets.get(carouselKey);
		if (existing) {
			return existing;
		}

		if (isResponseVM(context.element)) {
			this._questionCarouselResponseIds.set(carouselKey, context.element.requestId);
			this._questionCarouselSessionResources.set(carouselKey, context.element.sessionResource);
		}

		const part = this.instantiationService.createInstance(ChatQuestionCarouselPart, carousel, context, options);
		this._chatQuestionCarouselWidgets.set(carouselKey, part);
		this._hasQuestionCarouselContextKey?.set(true);

		dom.append(this.chatQuestionCarouselContainer, part.domNode);

		return part;
	}

	clearQuestionCarousel(responseId?: string, resolveId?: string): void {
		if (resolveId !== undefined) {
			const part = this._chatQuestionCarouselWidgets.get(resolveId);
			if (part) {
				part.domNode.remove();
				this._chatQuestionCarouselWidgets.deleteAndDispose(resolveId);
			}
			this._questionCarouselResponseIds.delete(resolveId);
			this._questionCarouselSessionResources.delete(resolveId);
		} else if (responseId !== undefined) {
			for (const [key, rid] of this._questionCarouselResponseIds) {
				if (rid === responseId) {
					const part = this._chatQuestionCarouselWidgets.get(key);
					if (part) {
						part.domNode.remove();
						this._chatQuestionCarouselWidgets.deleteAndDispose(key);
					}
					this._questionCarouselResponseIds.delete(key);
					this._questionCarouselSessionResources.delete(key);
				}
			}
		} else {
			this._chatQuestionCarouselWidgets.clearAndDisposeAll();
			this._questionCarouselResponseIds.clear();
			this._questionCarouselSessionResources.clear();
			dom.clearNode(this.chatQuestionCarouselContainer);
		}
		this._hasQuestionCarouselContextKey?.set(this._chatQuestionCarouselWidgets.size > 0);
	}

	get questionCarousel(): ChatQuestionCarouselPart | undefined {
		for (const part of this._chatQuestionCarouselWidgets.values()) {
			if (part.hasFocus()) {
				return part;
			}
		}
		return this._chatQuestionCarouselWidgets.size > 0 ? this._chatQuestionCarouselWidgets.values().next().value : undefined;
	}

	focusQuestionCarousel(): boolean {
		const carousel = this.questionCarousel;
		if (carousel) {
			carousel.focus();
			return true;
		}
		return false;
	}

	isQuestionCarouselFocused(): boolean {
		for (const part of this._chatQuestionCarouselWidgets.values()) {
			if (part.hasFocus()) {
				return true;
			}
		}
		return false;
	}

	navigateToPreviousQuestion(): boolean {
		const carousel = this.questionCarousel;
		return carousel?.navigateToPreviousQuestion() ?? false;
	}

	navigateToNextQuestion(): boolean {
		const carousel = this.questionCarousel;
		return carousel?.navigateToNextQuestion() ?? false;
	}

	focusQuestionCarouselTerminal(): boolean {
		const carousel = this.questionCarousel;
		return carousel?.focusTerminal() ?? false;
	}


	renderPlanReview(review: IChatPlanReview, context: IChatContentPartRenderContext, options: IChatPlanReviewPartOptions): ChatPlanReviewPart {
		const key = review.resolveId ?? `${isResponseVM(context.element) ? context.element.requestId : ''}_${context.contentIndex}`;

		const existing = this._chatPlanReviewWidgets.get(key);
		if (existing) {
			return existing;
		}

		if (isResponseVM(context.element)) {
			this._planReviewResponseIds.set(key, context.element.requestId);
			this._planReviewSessionResources.set(key, context.element.sessionResource);
		}

		const part = this.instantiationService.createInstance(ChatPlanReviewPart, review, context, options);
		this._chatPlanReviewWidgets.set(key, part);
		dom.append(this.chatPlanReviewContainer, part.domNode);

		return part;
	}

	clearPlanReview(responseId?: string, resolveId?: string): void {
		if (resolveId !== undefined) {
			const part = this._chatPlanReviewWidgets.get(resolveId);
			if (part) {
				part.domNode.remove();
				this._chatPlanReviewWidgets.deleteAndDispose(resolveId);
			}
			this._planReviewResponseIds.delete(resolveId);
			this._planReviewSessionResources.delete(resolveId);
		} else if (responseId !== undefined) {
			for (const [key, rid] of this._planReviewResponseIds) {
				if (rid === responseId) {
					const part = this._chatPlanReviewWidgets.get(key);
					if (part) {
						part.domNode.remove();
						this._chatPlanReviewWidgets.deleteAndDispose(key);
					}
					this._planReviewResponseIds.delete(key);
					this._planReviewSessionResources.delete(key);
				}
			}
		} else {
			this._chatPlanReviewWidgets.clearAndDisposeAll();
			this._planReviewResponseIds.clear();
			this._planReviewSessionResources.clear();
			dom.clearNode(this.chatPlanReviewContainer);
		}
	}

	get planReview(): ChatPlanReviewPart | undefined {
		return this._chatPlanReviewWidgets.size > 0 ? this._chatPlanReviewWidgets.values().next().value : undefined;
	}


	private get _currentSessionKey(): string | undefined {
		return this._widget?.viewModel?.model.sessionResource.toString();
	}

	private get _currentToolConfirmationCarousel(): ChatToolConfirmationCarouselPart | undefined {
		const key = this._currentSessionKey;
		return key ? this._chatToolConfirmationCarousels.get(key) : undefined;
	}

	renderToolConfirmationCarousel(tool: IChatToolInvocation, factory: ToolInvocationPartFactory, subAgentInvocationId?: string, subagentTitle?: string, revealSubagent?: RevealSubagentCallback, revealSubagentLabel?: string, toolPart?: ChatToolInvocationPart): ChatToolConfirmationCarouselPart {
		const existing = this._currentToolConfirmationCarousel;
		if (existing) {
			existing.addToolInvocation(tool, subAgentInvocationId, subagentTitle, revealSubagent, revealSubagentLabel, toolPart);
			this.updateToolConfirmationCarouselMaxHeight();
			return existing;
		}

		const key = this._currentSessionKey;
		if (!key) {
			throw new Error('Cannot render tool confirmation carousel without an active session');
		}

		const part = new ChatToolConfirmationCarouselPart(factory, [], revealSubagent, revealSubagentLabel, subAgentInvocationId, subagentTitle);
		part.addToolInvocation(tool, subAgentInvocationId, subagentTitle, revealSubagent, revealSubagentLabel, toolPart);
		this._chatToolConfirmationCarousels.set(key, part);
		const capturedKey = key;
		this._register(part.onDidChangeActiveSubagent(id => {
			if (this._currentSessionKey === capturedKey) {
				this._onDidChangeActiveConfirmationSubagent.fire(id);
			}
		}));
		if (this._currentSessionKey === capturedKey) {
			this._onDidChangeActiveConfirmationSubagent.fire(part.activeSubAgentInvocationId);
		}
		dom.append(this.chatToolConfirmationCarouselContainer, part.domNode);
		dom.show(this.chatToolConfirmationCarouselContainer);
		this.updateToolConfirmationCarouselMaxHeight();

		this._register(Event.once(part.onDidEmpty)(() => {
			this._chatToolConfirmationCarousels.deleteAndDispose(capturedKey);
			if (this._currentSessionKey === capturedKey) {
				this._onDidChangeActiveConfirmationSubagent.fire(undefined);
				dom.clearNode(this.chatToolConfirmationCarouselContainer);
				dom.hide(this.chatToolConfirmationCarouselContainer);
			}
		}));

		return part;
	}

	addToolToConfirmationCarousel(tool: IChatToolInvocation, factory: ToolInvocationPartFactory, subAgentInvocationId?: string, subagentTitle?: string, revealSubagent?: RevealSubagentCallback, revealSubagentLabel?: string, toolPart?: ChatToolInvocationPart): void {
		const existing = this._currentToolConfirmationCarousel;
		if (existing) {
			existing.addToolInvocation(tool, subAgentInvocationId, subagentTitle, revealSubagent, revealSubagentLabel, toolPart);
			this.updateToolConfirmationCarouselMaxHeight();
		} else {
			this.renderToolConfirmationCarousel(tool, factory, subAgentInvocationId, subagentTitle, revealSubagent, revealSubagentLabel, toolPart);
		}
	}

	get activeConfirmationSubagentId(): string | undefined {
		return this._currentToolConfirmationCarousel?.activeSubAgentInvocationId;
	}

	activateCarouselForSubagent(subAgentInvocationId: string): void {
		this._currentToolConfirmationCarousel?.activateFirstToolForSubagent(subAgentInvocationId);
	}

	hasToolInConfirmationCarousel(toolCallId: string): boolean {
		return this._currentToolConfirmationCarousel?.hasToolInvocation(toolCallId) ?? false;
	}

	get hasActiveToolConfirmationCarousel(): boolean {
		const carousel = this._currentToolConfirmationCarousel;
		return !!carousel && carousel.pendingCount > 0;
	}

	clearToolConfirmationCarousel(): void {
		const key = this._currentSessionKey;
		if (key) {
			this._chatToolConfirmationCarousels.deleteAndDispose(key);
		}
		this._onDidChangeActiveConfirmationSubagent.fire(undefined);
		dom.clearNode(this.chatToolConfirmationCarouselContainer);
		dom.hide(this.chatToolConfirmationCarouselContainer);
	}

	private _syncToolConfirmationCarouselForSession(): void {
		dom.clearNode(this.chatToolConfirmationCarouselContainer);
		const carousel = this._currentToolConfirmationCarousel;
		if (carousel && carousel.pendingCount > 0) {
			dom.append(this.chatToolConfirmationCarouselContainer, carousel.domNode);
			dom.show(this.chatToolConfirmationCarouselContainer);
			this.updateToolConfirmationCarouselMaxHeight();
		} else {
			dom.hide(this.chatToolConfirmationCarouselContainer);
		}
		this._onDidChangeActiveConfirmationSubagent.fire(carousel?.activeSubAgentInvocationId);
	}

	setWorkingSetCollapsed(collapsed: boolean): void {
		this._workingSetCollapsed.set(collapsed, undefined);
	}

	renderChatEditingSessionState(chatEditingSession: IChatEditingSession | null) {
		this.setChatEditingSessionVisible(Boolean(chatEditingSession));

		const modifiedEntries = derivedOpts<IModifiedFileEntry[]>({ equalsFn: arraysEqual }, r => {
			return chatEditingSession?.entries.read(r).filter(entry => entry.state.read(r) === ModifiedFileEntryState.Modified) || [];
		});

		const editSessionEntries = derived((reader): IChatCollapsibleListItem[] => {
			const seenEntries = new ResourceSet();
			const entries: IChatCollapsibleListItem[] = [];
			for (const entry of modifiedEntries.read(reader)) {
				if (entry.state.read(reader) !== ModifiedFileEntryState.Modified) {
					continue;
				}

				if (!seenEntries.has(entry.modifiedURI)) {
					seenEntries.add(entry.modifiedURI);
					const linesAdded = entry.linesAdded?.read(reader);
					const linesRemoved = entry.linesRemoved?.read(reader);
					let diffMeta = { added: linesAdded ?? 0, removed: linesRemoved ?? 0 };
					entries.push({
						reference: entry.modifiedURI,
						state: ModifiedFileEntryState.Modified,
						kind: 'reference',
						options: {
							status: undefined,
							diffMeta,
							isDeletion: !!entry.isDeletion,
							originalUri: entry.isDeletion ? entry.originalURI : undefined,
						}
					});
				}
			}

			entries.sort((a, b) => {
				if (a.kind === 'reference' && b.kind === 'reference') {
					if (a.state === b.state || a.state === undefined || b.state === undefined) {
						return a.reference.toString().localeCompare(b.reference.toString());
					}
					return a.state - b.state;
				}
				return 0;
			});

			return entries;
		});

		const sessionFileChanges = constObservable<any[]>([]);

		const sessionFiles = derived(reader =>
			sessionFileChanges.read(reader).map((entry): IChatCollapsibleListItem => ({
				reference: isIChatSessionFileChange2(entry)
					? entry.modifiedUri ?? entry.uri
					: entry.modifiedUri,
				state: ModifiedFileEntryState.Accepted,
				kind: 'reference',
				options: {
					diffMeta: { added: entry.insertions, removed: entry.deletions },
					isDeletion: entry.modifiedUri === undefined,
					originalUri: entry.originalUri,
					status: undefined
				}
			}))
		);

		const shouldRender = derived(reader =>
			editSessionEntries.read(reader).length > 0 || sessionFiles.read(reader).length > 0);

		this._renderingChatEdits.value = autorun(reader => {
			if (this.options.renderWorkingSet && shouldRender.read(reader)) {
				this.renderChatEditingSessionWithEntries(
					reader.store,
					chatEditingSession,
					editSessionEntries,
					sessionFiles
				);
			} else {
				dom.clearNode(this.chatEditingSessionWidgetContainer);
				this._chatEditsDisposables.clear();
				this._chatEditList = undefined;
				this.setChatEditingSessionVisible(false);
			}
		});
	}

	private setChatEditingSessionVisible(visible: boolean): void {
		dom.setVisibility(visible, this.chatEditingSessionWidgetContainer);
		setChatInputStackSlot(this.chatEditingSessionWidgetContainer, visible ? ChatInputStackSlot.Docked : ChatInputStackSlot.Empty);
	}

	private renderChatEditingSessionWithEntries(
		store: DisposableStore,
		chatEditingSession: IChatEditingSession | null,
		editSessionEntriesObs: IObservable<readonly IChatCollapsibleListItem[]>,
		sessionEntriesObs: IObservable<readonly IChatCollapsibleListItem[]>
	) {
		// eslint-disable-next-line no-restricted-syntax
		const innerContainer = this.chatEditingSessionWidgetContainer.querySelector('.chat-editing-session-container.show-file-icons') as HTMLElement ?? dom.append(this.chatEditingSessionWidgetContainer, $('.chat-editing-session-container.show-file-icons'));

		// eslint-disable-next-line no-restricted-syntax
		const overviewRegion = innerContainer.querySelector('.chat-editing-session-overview') as HTMLElement ?? dom.append(innerContainer, $('.chat-editing-session-overview'));
		// eslint-disable-next-line no-restricted-syntax
		const overviewTitle = overviewRegion.querySelector('.working-set-title') as HTMLElement ?? dom.append(overviewRegion, $('.working-set-title'));

		this._chatEditsActionsDisposables.clear();

		// eslint-disable-next-line no-restricted-syntax
		const actionsContainer = overviewRegion.querySelector('.chat-editing-session-actions') as HTMLElement ?? dom.append(overviewRegion, $('.chat-editing-session-actions'));

		const sessionResource = chatEditingSession?.chatSessionResource || this._widget?.viewModel?.model.sessionResource;

		const scopedContextKeyService = this._chatEditsActionsDisposables.add(this.contextKeyService.createScoped(actionsContainer));
		if (sessionResource) {
			scopedContextKeyService.createKey(ChatContextKeys.agentSessionType.key, getChatSessionType(sessionResource));


		}

		this._chatEditsActionsDisposables.add(bindContextKey(ChatContextKeys.hasAgentSessionChanges, scopedContextKeyService, r => !!sessionEntriesObs.read(r)?.length));

		const scopedInstantiationService = this._chatEditsActionsDisposables.add(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, scopedContextKeyService])));

		// eslint-disable-next-line no-restricted-syntax
		const workingSetContainer = innerContainer.querySelector('.chat-editing-session-list') as HTMLElement ?? dom.append(innerContainer, $('.chat-editing-session-list'));

		const button = this._chatEditsActionsDisposables.add(new ButtonWithIcon(overviewTitle, {
			supportIcons: true,
			secondary: true,
			ariaLabel: localize('chatEditingSession.toggleWorkingSet', 'Toggle changed files.'),
		}));

		const allCombinedEntriesObs = derived((reader): IChatCollapsibleListItem[] => {
			const editEntries = editSessionEntriesObs.read(reader);
			const sessionFileEntries = sessionEntriesObs.read(reader);

			const combined: IChatCollapsibleListItem[] = [];
			const entryMap = new ResourceMap<IChatReferenceListItem>();

			for (const entry of editEntries) {
				if (entry.kind === 'reference' && URI.isUri(entry.reference)) {
					const cloned: IChatReferenceListItem = { ...entry, options: { ...entry.options } };
					entryMap.set(entry.reference, cloned);
					combined.push(cloned);
				} else {
					combined.push(entry);
				}
			}

			for (const entry of sessionFileEntries) {
				if (entry.kind === 'reference' && URI.isUri(entry.reference)) {
					const existing = entryMap.get(entry.reference);
					if (existing) {
						const existingDiff = existing.options?.diffMeta;
						const entryDiff = entry.options?.diffMeta;
						if (entryDiff && (entryDiff.added > 0 || entryDiff.removed > 0)) {
							if (!existingDiff || (existingDiff.added === 0 && existingDiff.removed === 0)) {
								existing.options = {
									...existing.options,
									diffMeta: { added: entryDiff.added, removed: entryDiff.removed }
								};
							}
						}
					} else {
						const cloned: IChatReferenceListItem = { ...entry, options: { ...entry.options } };
						entryMap.set(entry.reference, cloned);
						combined.push(cloned);
					}
				} else {
					combined.push(entry);
				}
			}

			let chatModelDiffMap: ResourceMap<{ added: number; removed: number }> | undefined;
			const getChatModelDiff = (targetUri: URI): { added: number; removed: number } | undefined => {
				if (!chatModelDiffMap) {
					chatModelDiffMap = new ResourceMap<{ added: number; removed: number }>();
					const currentChatModel = this._widget?.viewModel?.model;
					if (currentChatModel) {
						for (const req of currentChatModel.getRequests()) {
							const response = req.response;
							if (!response) {
								continue;
							}
							for (const part of response.response.value) {
								if (part.kind === 'externalEdit' && part.diff) {
									try {
										const partUri = part.uri;
										const a = typeof part.diff.added === 'number' ? part.diff.added : (part.diff.added !== undefined ? Number(part.diff.added) : 0);
										const r = typeof part.diff.removed === 'number' ? part.diff.removed : (part.diff.removed !== undefined ? Number(part.diff.removed) : 0);
										const existing = chatModelDiffMap.get(partUri) || { added: 0, removed: 0 };
										chatModelDiffMap.set(partUri, {
											added: existing.added + (isNaN(a) ? 0 : a),
											removed: existing.removed + (isNaN(r) ? 0 : r)
										});
									} catch { }
								}
							}
						}
					}
				}
				return chatModelDiffMap.get(targetUri);
			};

			for (const item of combined) {
				if (item.kind === 'reference' && URI.isUri(item.reference)) {
					const diffMeta = item.options?.diffMeta;
					if (!diffMeta || (diffMeta.added === 0 && diffMeta.removed === 0)) {
						let reconciledDiff: { added: number; removed: number } | undefined;
						if (!reconciledDiff || (reconciledDiff.added === 0 && reconciledDiff.removed === 0)) {
							const foundDiff = getChatModelDiff(item.reference);
							if (foundDiff && (foundDiff.added > 0 || foundDiff.removed > 0)) {
								reconciledDiff = foundDiff;
							}
						}
						if (reconciledDiff && (reconciledDiff.added > 0 || reconciledDiff.removed > 0)) {
							item.options = {
								...item.options,
								diffMeta: { added: reconciledDiff.added, removed: reconciledDiff.removed }
							};
						}
					}
				}
			}

			return combined;
		});

		const topLevelStats = derived(reader => {
			const combined = allCombinedEntriesObs.read(reader);
			const editEntries = editSessionEntriesObs.read(reader);
			const sessionEntries = sessionEntriesObs.read(reader);

			let added = 0, removed = 0;

			for (const entry of combined) {
				if (entry.kind === 'reference' && entry.options?.diffMeta) {
					added += entry.options.diffMeta.added;
					removed += entry.options.diffMeta.removed;
				}
			}

			const files = combined.length;
			const topLevelIsSessionMenu = editEntries.length === 0 && sessionEntries.length > 0;
			const shouldShowEditingSession = combined.length > 0;

			return { files, added, removed, shouldShowEditingSession, topLevelIsSessionMenu };
		});

		const topLevelIsSessionMenu = topLevelStats.map(t => t.topLevelIsSessionMenu);

		store.add(autorun(reader => {
			const isSessionMenu = topLevelIsSessionMenu.read(reader);
			reader.store.add(scopedInstantiationService.createInstance(MenuWorkbenchButtonBar, actionsContainer, isSessionMenu ? MenuId.ChatEditingSessionChangesToolbar : MenuId.ChatEditingWidgetToolbar, {
				telemetrySource: this.options.menus.telemetrySource,
				small: true,
				menuOptions: sessionResource ? (isSessionMenu ? {
					args: [sessionResource, undefined],
				} : {
					arg: {
						$mid: MarshalledId.ChatViewContext,
						sessionResource,
					} satisfies IChatViewTitleActionContext,
				}) : undefined,
				disableWhileRunning: isSessionMenu,
				buttonConfigProvider: (action) => {
					if (action.id === 'chatEditing.acceptAllFiles') {
						return { showIcon: false, showLabel: true, isSecondary: false, customClass: 'chat-editing-keep-btn' };
					}
					if (action.id === 'chatEditing.discardAllFiles') {
						return { showIcon: false, showLabel: true, isSecondary: true, customClass: 'chat-editing-undo-btn' };
					}
					if (action.id === ChatEditingShowChangesAction.ID || action.id === ViewPreviousEditsAction.Id) {
						return { showIcon: true, showLabel: false, isSecondary: true, customClass: 'chat-editing-diff-btn' };
					}
					return undefined;
				}
			}));
		}));

		store.add(autorun(reader => {
			const { files, added, removed, shouldShowEditingSession } = topLevelStats.read(reader);

			const buttonLabel = files === 1
				? localize('chatEditingSession.oneFileWithChanges', '1 file changed')
				: localize('chatEditingSession.manyFilesWithChanges', '{0} files changed', files);

			button.label = buttonLabel;
			button.element.setAttribute('aria-label', localize('chatEditingSession.ariaLabelWithCounts', '{0}, {1} lines added, {2} lines removed', buttonLabel, added, removed));

			if (added > 0) {
				this._workingSetLinesAddedSpan.value.textContent = `+${added}`;
				dom.show(this._workingSetLinesAddedSpan.value);
			} else {
				dom.hide(this._workingSetLinesAddedSpan.value);
			}

			if (removed > 0) {
				this._workingSetLinesRemovedSpan.value.textContent = `-${removed}`;
				dom.show(this._workingSetLinesRemovedSpan.value);
			} else {
				dom.hide(this._workingSetLinesRemovedSpan.value);
			}

			this.setChatEditingSessionVisible(shouldShowEditingSession);
		}));

		const countsContainer = dom.$('.working-set-line-counts');
		button.element.appendChild(countsContainer);
		countsContainer.appendChild(this._workingSetLinesAddedSpan.value);
		countsContainer.appendChild(this._workingSetLinesRemovedSpan.value);

		const toggleWorkingSet = () => {
			this._workingSetCollapsed.set(!this._workingSetCollapsed.get(), undefined);
		};

		this._chatEditsActionsDisposables.add(button.onDidClick(toggleWorkingSet));
		this._chatEditsActionsDisposables.add(addDisposableListener(overviewRegion, 'click', e => {
			if (e.defaultPrevented) {
				return;
			}
			const target = e.target as HTMLElement;
			if (target.closest('.monaco-button')) {
				return;
			}
			toggleWorkingSet();
		}));

		this._chatEditsActionsDisposables.add(autorun(reader => {
			const collapsed = this._workingSetCollapsed.read(reader);
			button.icon = collapsed ? Codicon.chevronRight : Codicon.chevronDown;
			workingSetContainer.classList.toggle('collapsed', collapsed);
		}));

		if (!this._chatEditList) {
			this._chatEditList = this._chatEditsListPool.get();
			const list = this._chatEditList.object;
			this._chatEditsDisposables.add(this._chatEditList);
			this._chatEditsDisposables.add(list.onDidFocus(() => {
				this._onDidFocus.fire();
			}));
			this._chatEditsDisposables.add(list.onDidOpen(async (e) => {
				if (e.element?.kind === 'reference' && URI.isUri(e.element.reference)) {
					const modifiedFileUri = e.element.reference;
					const originalUri = e.element.options?.originalUri;

					if (e.element.options?.isDeletion && originalUri) {
						await this.editorService.openEditor({
							resource: originalUri,
							options: e.editorOptions
						}, e.sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
						return;
					}

					if (originalUri) {
						await this.editorService.openEditor({
							original: { resource: originalUri },
							modified: { resource: modifiedFileUri },
							options: e.editorOptions
						}, e.sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
						return;
					}

					const entry = chatEditingSession?.getEntry(modifiedFileUri);

					const pane = await this.editorService.openEditor({
						resource: modifiedFileUri,
						options: e.editorOptions
					}, e.sideBySide ? SIDE_GROUP : ACTIVE_GROUP);

					if (pane) {
						entry?.getEditorIntegration(pane).reveal(true, e.editorOptions.preserveFocus);
					}
				}
			}));
			this._chatEditsDisposables.add(addDisposableListener(list.getHTMLElement(), 'click', e => {
				if (!this.hasFocus()) {
					this._onDidFocus.fire();
				}
			}, true));
			dom.append(workingSetContainer, list.getHTMLElement());
			dom.append(innerContainer, workingSetContainer);
		}

		store.add(autorun(reader => {
			const allEntries = allCombinedEntriesObs.read(reader);

			const maxItemsShown = 6;
			const itemsShown = Math.min(allEntries.length, maxItemsShown);
			const height = itemsShown * 22;
			const list = this._chatEditList!.object;
			list.layout(height);
			list.getHTMLElement().style.height = `${height}px`;
			list.splice(0, list.length, allEntries);
			workingSetContainer.classList.toggle('overflowing', allEntries.length > maxItemsShown);
		}));
	}

	async renderFollowups(items: IChatFollowup[] | undefined, response: IChatResponseViewModel | undefined): Promise<void> {
		if (!this.options.renderFollowups) {
			return;
		}
		this.followupsDisposables.clear();
		dom.clearNode(this.followupsContainer);

		if (items && items.length > 0) {
			this.followupsDisposables.add(this.instantiationService.createInstance<typeof ChatFollowups<IChatFollowup>, ChatFollowups<IChatFollowup>>(ChatFollowups, this.followupsContainer, items, this.location, undefined, followup => this._onDidAcceptFollowup.fire({ followup, response })));
		}
	}

	setMaxHeight(maxHeight: number | undefined): void {
		this._maxHeight = maxHeight;
		this.updateToolConfirmationCarouselMaxHeight();
	}

	private updateToolConfirmationCarouselMaxHeight(): void {
		const carousel = this._currentToolConfirmationCarousel;
		if (!carousel) {
			return;
		}

		if (this._maxHeight === undefined) {
			carousel.setMaxHeight(undefined);
			return;
		}

		const carouselHeight = this.chatToolConfirmationCarouselContainer.offsetHeight;
		const otherInputHeight = Math.max(0, this.container.offsetHeight - carouselHeight);
		carousel.setMaxHeight(this._maxHeight - otherInputHeight);
	}

	layout(width: number) {
		this.cachedWidth = width;
		this._updateWorkingProgressAnimationDuration(width);

		const result = this._layout(width);
		this._inputPickerResponsiveLayout?.layout();
		this._secondaryPickerResponsiveLayout?.layout();
		return result;
	}

	private layoutForToolbarChange(): void {
		if (typeof this.cachedWidth === 'number') {
			this._layout(this.cachedWidth, true, true);
		}
	}

	private _lastAnimDurationS: number | undefined;
	private _updateWorkingProgressAnimationDuration(width: number): void {
		if (!this.inputContainer) {
			return;
		}
		const MIN_DURATION_S = 1.4;
		const MAX_DURATION_S = 2.5;
		const safeWidth = Math.max(50, width);
		const raw = 0.55 + 0.075 * Math.sqrt(safeWidth);
		const duration = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, raw));

		if (this._lastAnimDurationS !== undefined && Math.abs(this._lastAnimDurationS - duration) < 0.05) {
			return;
		}
		this._lastAnimDurationS = duration;
		this.inputContainer.style.setProperty('--chat-input-anim-duration', `${duration.toFixed(2)}s`);

		if (this.inputContainer.classList.contains('working')) {
			const inputContainer = this.inputContainer;
			inputContainer.classList.add('chat-input-anim-restart');
			dom.scheduleAtNextAnimationFrame(dom.getWindow(inputContainer), () => {
				inputContainer.classList.remove('chat-input-anim-restart');
			});
		}
	}

	private get _effectiveInputEditorMaxHeight(): number {
		if (this._maxHeight === undefined) {
			return this.inputEditorMaxHeight;
		}

		const currentEditorHeight = this.previousInputEditorDimension?.height ?? 0;
		const nonEditorHeight = Math.max(0, this.height.get() - currentEditorHeight);
		const budgetForEditor = this._maxHeight - nonEditorHeight;

		const minEditorHeight = this.inputEditorMinHeight ?? this.singleLineInputEditorHeight;
		return Math.max(minEditorHeight, Math.min(this.inputEditorMaxHeight, Math.max(0, budgetForEditor)));
	}

	private _updateSuggestWidgetBounds(): void {
		const overflowNode = this.options.editorOverflowWidgetsDomNode;
		if (!overflowNode || !this.inputContainer) {
			return;
		}
		const rect = this.inputContainer.getBoundingClientRect();
		if (rect.width > 0) {
			overflowNode.style.setProperty('--chat-input-left', `${rect.left}px`);
			overflowNode.style.setProperty('--chat-input-width', `${rect.width}px`);
		}
	}

	private previousInputEditorDimension: IDimension | undefined;
	private _layout(width: number, allowRecurse = true, preserveInputEditorHeight = false): void {
		this._updateSuggestWidgetBounds();
		const data = this.getLayoutData();

		const followupsWidth = width - data.inputPartHorizontalPadding;
		this.followupsContainer.style.width = `${followupsWidth}px`;

		const initialEditorScrollWidth = this._inputEditor.getScrollWidth();
		const newEditorWidth = width - data.inputPartHorizontalPadding - data.editorBorder - data.inputPartHorizontalPaddingInside - data.toolbarsWidth - data.sideToolbarWidth;
		const effectiveMaxHeight = this._effectiveInputEditorMaxHeight;
		const contentHeight = preserveInputEditorHeight && this.previousInputEditorDimension
			? this.previousInputEditorDimension.height
			: this._inputEditor.getContentHeight();
		const clampedContentHeight = Math.min(contentHeight, effectiveMaxHeight);
		const inputEditorHeight = this.inputEditorMinHeight ? Math.min(Math.max(this.inputEditorMinHeight, clampedContentHeight), effectiveMaxHeight) : clampedContentHeight;
		const newDimension = { width: newEditorWidth, height: inputEditorHeight };
		if (!this.previousInputEditorDimension || (this.previousInputEditorDimension.width !== newDimension.width || this.previousInputEditorDimension.height !== newDimension.height)) {
			this.ignoreInputEditorContentSizeChanges = preserveInputEditorHeight;
			try {
				this._inputEditor.layout(newDimension);
			} finally {
				this.ignoreInputEditorContentSizeChanges = false;
			}
			this.previousInputEditorDimension = newDimension;
		}

		if (allowRecurse && initialEditorScrollWidth < 10) {
			return this._layout(width, false, preserveInputEditorHeight);
		}
	}

	private getLayoutData() {


		const inputSideToolbarWidth = this.inputSideToolbarContainer ? dom.getTotalWidth(this.inputSideToolbarContainer) : 0;

		const getToolbarsWidthCompact = () => {
			const toolbarItemGap = 4;
			const executeToolbarWidth = this.cachedExecuteToolbarWidth = this.executeToolbar.getItemsWidth();
			const inputToolbarWidth = this.cachedInputToolbarWidth = this.inputActionsToolbar.getItemsWidth();
			const executeToolbarPadding = (this.executeToolbar.getItemsLength() - 1) * toolbarItemGap;
			const inputToolbarPadding = this.inputActionsToolbar.getItemsLength() ? (this.inputActionsToolbar.getItemsLength() - 1) * toolbarItemGap : 0;
			const contextUsageWidth = dom.getTotalWidth(this.contextUsageWidgetContainer);
			const inputToolbarsPadding = 12;
			return executeToolbarWidth + executeToolbarPadding + contextUsageWidth + (this.options.renderInputToolbarBelowInput ? 0 : inputToolbarWidth + inputToolbarPadding + inputToolbarsPadding);
		};

		return {
			editorBorder: 2,
			inputPartHorizontalPadding: this.options.inputPartHorizontalPadding ?? (this.options.renderStyle === 'compact' ? 16 : 24),
			inputPartHorizontalPaddingInside: this.options.renderStyle === 'compact' ? 12 : 10,
			toolbarsWidth: this.options.renderStyle === 'compact' ? getToolbarsWidthCompact() : 0,
			sideToolbarWidth: inputSideToolbarWidth > 0 ? inputSideToolbarWidth + 4 : 0,
		};
	}

	private getWidgetLocationInfo(widget: IChatWidget): IChatWidgetLocationInfo {
		if (isIChatResourceViewContext(widget.viewContext)) {
			return { location: ChatWidgetLocation.Editor, isMaximized: false };
		}

		if (isIChatViewViewContext(widget.viewContext)) {
			const viewLocation = this.viewDescriptorService.getViewLocationById(widget.viewContext.viewId);
			const sideBarPosition = this.layoutService.getSideBarPosition();

			switch (viewLocation) {
				case ViewContainerLocation.Panel:
					return {
						location: ChatWidgetLocation.Panel,
						isMaximized: this.layoutService.isPanelMaximized(),
					};
				case ViewContainerLocation.AuxiliaryBar:
					return {
						location: sideBarPosition === Position.LEFT ? ChatWidgetLocation.SidebarRight : ChatWidgetLocation.SidebarLeft,
						isMaximized: this.layoutService.isAuxiliaryBarMaximized(),
					};
				case ViewContainerLocation.Sidebar:
				default:
					return {
						location: sideBarPosition === Position.LEFT ? ChatWidgetLocation.SidebarLeft : ChatWidgetLocation.SidebarRight,
						isMaximized: false,
					};
			}
		}

		return { location: ChatWidgetLocation.Editor, isMaximized: false };
	}

	private getDefaultScrollbarOptions(): IEditorScrollbarOptions {
		const scrollbar = this._inputEditor.getRawOptions().scrollbar ?? {};
		return this.options.renderStyle === 'compact'
			? { ...scrollbar, vertical: 'hidden' }
			: { ...scrollbar, vertical: 'auto', verticalScrollbarSize: 7 };
	}

	private getVisibleScrollbarOptions(): IEditorScrollbarOptions {
		const scrollbar = this._inputEditor.getRawOptions().scrollbar ?? {};
		return this.options.renderStyle === 'compact'
			? { ...scrollbar, vertical: 'hidden' }
			: { ...scrollbar, vertical: 'visible', verticalScrollbarSize: 7 };
	}

	private updateInputEditorScrollbarOptions(): void {
		this._inputEditor.updateOptions({
			scrollbar: this._forceVisibleScrollbarUntilAccept
				? this.getVisibleScrollbarOptions()
				: this.getDefaultScrollbarOptions()
		});
	}

	showScrollbarUntilAccept(): void {
		this._forceVisibleScrollbarUntilAccept = true;
		this.updateInputEditorScrollbarOptions();
	}

	private resetScrollbarVisibilityAfterAccept(): void {
		if (!this._forceVisibleScrollbarUntilAccept) {
			return;
		}

		this._forceVisibleScrollbarUntilAccept = false;
		this.updateInputEditorScrollbarOptions();
	}
}


function getLastPosition(model: ITextModel): IPosition {
	return { lineNumber: model.getLineCount(), column: model.getLineLength(model.getLineCount()) + 1 };
}

const chatInputEditorContainerSelector = '.interactive-input-editor';
setupSimpleEditorSelectionStyling(chatInputEditorContainerSelector);

type ChatSessionPickerWidget = ChatSessionPickerActionItem;

class ChatSessionPickersContainerActionItem extends ActionViewItem {
	constructor(
		action: IAction,
		private readonly widgets: ChatSessionPickerWidget[],
		options?: IActionViewItemOptions
	) {
		super(null, action, options ?? {});
	}

	override render(container: HTMLElement): void {
		container.classList.add('chat-sessionPicker-container');
		for (const widget of this.widgets) {
			const itemContainer = dom.$('.action-item.chat-sessionPicker-item');
			widget.render(itemContainer);
			container.appendChild(itemContainer);
		}
	}

	show(): void {
		this.widgets[0]?.show();
	}

	override dispose(): void {
		for (const widget of this.widgets) {
			widget.dispose();
		}
		super.dispose();
	}
}

class HiddenActionViewItem extends BaseActionViewItem {
	constructor(action: IAction) {
		super(undefined, action);
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.style.display = 'none';
	}
}
