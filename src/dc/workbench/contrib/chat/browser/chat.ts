/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from '../../../../base/browser/mouseEvent.js';
import { IAnchor } from '../../../../base/browser/ui/contextview/contextview.js';
import { AnchorPosition } from '../../../../base/common/layout.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { EditDeltaInfo } from '../../../../editor/common/textModelEditSource.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PreferredGroup } from '../../../services/editor/common/editorService.js';
import { IChatRequestVariableEntry } from '../common/attachments/chatVariableEntries.js';
import { IDynamicVariable } from '../common/attachments/chatVariables.js';
import { IChatAgentAttachmentCapabilities, IChatAgentCommand, IChatAgentData } from '../common/participants/chatAgents.js';
import { IChatResponseModel, IChatModelInputState } from '../common/model/chatModel.js';
import { IChatMode } from '../common/chatModes.js';
import { IParsedChatRequest } from '../common/requestParser/chatParserTypes.js';
import { IHandOff } from '../common/promptSyntax/promptFileParser.js';
import { CHAT_PROVIDER_ID } from '../common/participants/chatParticipantContribTypes.js';
import { ChatRequestQueueKind, IChatElicitationRequest, IChatLocationData, IChatSendRequestOptions } from '../common/chatService/chatService.js';
import { IChatRequestViewModel, IChatResponseViewModel, IChatViewModel, IChatPendingDividerViewModel } from '../common/model/chatViewModel.js';
import { ChatAgentLocation, ChatModeKind, IResolvedNewChatSessionType } from '../common/constants.js';
import { ChatAttachmentModel } from './attachments/chatAttachmentModel.js';
import { IChatEditorOptions } from './widgetHosts/editor/chatEditor.js';
import { ChatInputPart } from './widget/input/chatInputPart.js';
import { IChatWidgetContrib } from './widget/chatWidget.js';
import { ICodeBlockActionContext, ICodeBlockRenderOptions } from './widget/chatContentParts/codeBlockPart.js';


export { ChatOutline } from './chatOutline.js';

export interface IWorkspacePickerItem {
	readonly uri: URI;
	readonly label: string;
	readonly isFolder: boolean;
}

export interface IWorkspacePickerDelegate {
	getWorkspaces(): IWorkspacePickerItem[];
	getSelectedWorkspace(): IWorkspacePickerItem | undefined;
	setSelectedWorkspace(workspace: IWorkspacePickerItem | undefined): void;
	onDidChangeSelectedWorkspace: Event<IWorkspacePickerItem | undefined>;
	onDidChangeWorkspaces: Event<void>;
	openFolderCommand: string;
}

export interface ISessionTypePickerDelegate {
	getActiveSessionProvider(): string | undefined;
	setActiveSessionProvider?(provider: string): void;
	getPendingDelegationTarget?(): string | undefined;
	setPendingDelegationTarget?(provider: string): void;
	onDidChangeActiveSessionProvider?: Event<string>;
	hasGitRepository?(): boolean;
}

export const IChatWidgetService = createDecorator<IChatWidgetService>('chatWidgetService');

export interface IChatWidgetService {

	readonly _serviceBrand: undefined;

	readonly lastFocusedWidget: IChatWidget | undefined;

	readonly onDidAddWidget: Event<IChatWidget>;
	readonly onDidRemoveWidget: Event<IChatWidget>;

	readonly onDidChangeWidgetVisibility: Event<IChatWidget>;

	readonly onDidBackgroundSession: Event<URI>;

	readonly onDidChangeFocusedWidget: Event<IChatWidget | undefined>;

	readonly onDidChangeFocusedSession: Event<void>;

	reveal(widget: IChatWidget, preserveFocus?: boolean): Promise<boolean>;

	revealWidget(preserveFocus?: boolean): Promise<IChatWidget | undefined>;

	getAllWidgets(): ReadonlyArray<IChatWidget>;
	getWidgetByInputUri(uri: URI): IChatWidget | undefined;
	openSession(sessionResource: URI, target?: typeof ChatViewPaneTarget, options?: IChatEditorOptions): Promise<IChatWidget | undefined>;
	openSession(sessionResource: URI, target?: PreferredGroup, options?: IChatEditorOptions): Promise<IChatWidget | undefined>;
	openSession(sessionResource: URI, target?: typeof ChatViewPaneTarget | PreferredGroup, options?: IChatEditorOptions): Promise<IChatWidget | undefined>;

	getWidgetBySessionResource(sessionResource: URI): IChatWidget | undefined;

	getWidgetsByLocations(location: ChatAgentLocation): ReadonlyArray<IChatWidget>;

	register(newWidget: IChatWidget): IDisposable;
}

export const ChatViewPaneTarget = Symbol('ChatViewPaneTarget');

export const IQuickChatService = createDecorator<IQuickChatService>('quickChatService');
export interface IQuickChatService {
	readonly _serviceBrand: undefined;
	readonly onDidClose: Event<void>;
	readonly enabled: boolean;
	readonly focused: boolean;
	readonly sessionResource?: URI;
	toggle(options?: IQuickChatOpenOptions): void;
	focus(): void;
	open(options?: IQuickChatOpenOptions): void;
	close(): void;
	openInChatView(): void;
}

export interface IQuickChatOpenOptions {
	query: string;
	isPartialQuery?: boolean;
	selection?: Selection;
}

export const IChatAccessibilityService = createDecorator<IChatAccessibilityService>('chatAccessibilityService');
export interface IChatAccessibilityService {
	readonly _serviceBrand: undefined;
	acceptRequest(uri: URI, skipRequestSignal?: boolean): void;
	disposeRequest(requestId: URI): void;
	acceptResponse(response: IChatResponseViewModel | string | undefined, requestId: URI | undefined, isVoiceInput?: boolean): void;
	acceptElicitation(message: IChatElicitationRequest): void;
}

export interface IChatCodeBlockInfo {
	readonly ownerMarkdownPartId: string;
	readonly codeBlockIndex: number;
	readonly elementId: string;
	readonly uri: URI | undefined;
	codemapperUri: URI | undefined;
	readonly chatSessionResource: URI | undefined;
	focus(): void;
	readonly languageId?: string | undefined;
	readonly editDeltaInfo?: EditDeltaInfo | undefined;
}

export interface IChatFileTreeInfo {
	treeDataId: string;
	treeIndex: number;
	focus(): void;
}

export type ChatTreeItem = IChatRequestViewModel | IChatResponseViewModel | IChatPendingDividerViewModel;

export interface IChatListItemRendererOptions {
	readonly renderStyle?: 'compact' | 'minimal';
	readonly noHeader?: boolean;
	readonly noFooter?: boolean;
	readonly renderDetectedCommandsWithRequest?: boolean;
	readonly restorable?: boolean;
	readonly supportsFork?: boolean;
	readonly editable?: boolean;
	readonly renderTextEditsAsSummary?: (uri: URI) => boolean;
	readonly referencesExpandedWhenEmptyResponse?: boolean | ((mode: ChatModeKind) => boolean);
	readonly progressMessageAtBottomOfResponse?: boolean | ((mode: ChatModeKind) => boolean);
	readonly contentHorizontalPadding?: number;
	readonly codeBlockRenderOptions?: ICodeBlockRenderOptions;
}

export interface IChatWidgetViewOptions {
	autoScroll?: boolean | ((mode: ChatModeKind) => boolean);
	renderInputOnTop?: boolean;
	readOnlyBannerAtTop?: boolean;
	renderFollowups?: boolean;
	renderStyle?: 'compact' | 'minimal';
	renderInputToolbarBelowInput?: boolean;
	renderGettingStartedTip?: boolean | (() => boolean);
	supportsFileReferences?: boolean;
	filter?: (item: ChatTreeItem) => boolean;
	clear?: (resolvedSessionType?: IResolvedNewChatSessionType | string) => Promise<void>;
	rendererOptions?: IChatListItemRendererOptions;
	menus?: {
		executeToolbar?: MenuId;
		inputSideToolbar?: MenuId;
		telemetrySource?: string;
	};
	defaultElementHeight?: number;
	editorOverflowWidgetsDomNode?: HTMLElement;
	enableImplicitContext?: boolean;
	enableWorkingSet?: 'explicit' | 'implicit';
	supportsChangingModes?: boolean;
	dndContainer?: HTMLElement;
	inputEditorMinLines?: number;
	defaultMode?: IChatMode;
	sessionTypePickerDelegate?: ISessionTypePickerDelegate;

	workspacePickerDelegate?: IWorkspacePickerDelegate;

	submitHandler?: (query: string, mode: ChatModeKind, attachedContext?: IChatRequestVariableEntry[], isVoiceModeInput?: boolean) => Promise<boolean>;

	enableSessionStateIndicator?: boolean;

	enableFind?: boolean;

	persistentContentHeight?: number;
	onDidChangeModelPickerVisibility?: (visible: boolean) => void;
	inputPickerPosition?: AnchorPosition;
	inputPickerContainer?: () => HTMLElement | undefined;
	inputPickerAnchor?: (anchor: HTMLElement) => IAnchor;
	inputPickerOpenOnMouseUp?: boolean;
}

export interface IChatViewViewContext {
	viewId: string;
}

export function isIChatViewViewContext(context: IChatWidgetViewContext): context is IChatViewViewContext {
	return typeof (context as IChatViewViewContext).viewId === 'string';
}

export interface IChatResourceViewContext {
	isQuickChat?: boolean;
	isInlineChat?: boolean;
}

export function isIChatResourceViewContext(context: IChatWidgetViewContext): context is IChatResourceViewContext {
	return !isIChatViewViewContext(context);
}

export type IChatWidgetViewContext = IChatViewViewContext | IChatResourceViewContext | {};

export interface IChatAcceptInputOptions {
	noCommandDetection?: boolean;
	isVoiceInput?: boolean;
	isVoiceModeInput?: boolean;
	enableImplicitContext?: boolean;
	storeToHistory?: boolean;
	queue?: ChatRequestQueueKind;
	cancelCurrentRequest?: boolean;
	preserveFocus?: boolean;
	preserveInput?: boolean;
	onRequestAccepted?: () => void;
}

export interface IChatWidgetViewModelChangeEvent {
	readonly previousSessionResource: URI | undefined;
	readonly currentSessionResource: URI | undefined;
}

export interface IChatWidgetViewState {
	readonly scrollTop: number;
	readonly isAtBottom?: boolean;
}

export const CHAT_WIDGET_VIEW_STATE_CACHE_LIMIT = 100;

export interface IChatWidget {
	readonly domNode: HTMLElement;
	readonly transcriptDomNode: HTMLElement;
	readonly visible: boolean;
	readonly onDidChangeViewModel: Event<IChatWidgetViewModelChangeEvent>;
	readonly onDidAcceptInput: Event<void>;
	readonly onDidHide: Event<void>;
	readonly onDidShow: Event<void>;
	readonly onDidSubmitAgent: Event<{ agent: IChatAgentData; slashCommand?: IChatAgentCommand }>;
	readonly onDidChangeAgent: Event<{ agent: IChatAgentData; slashCommand?: IChatAgentCommand }>;
	readonly onDidChangeParsedInput: Event<void>;
	readonly onDidChangeActiveInputEditor: Event<void>;
	readonly onDidFocus: Event<void>;
	readonly onDidScroll: Event<void>;
	readonly location: ChatAgentLocation;
	readonly viewContext: IChatWidgetViewContext;
	readonly viewModel: IChatViewModel | undefined;
	readonly inputEditor: ICodeEditor;
	readonly supportsFileReferences: boolean;
	readonly rendersInputOnTop: boolean;
	readonly attachmentCapabilities: IChatAgentAttachmentCapabilities;
	readonly parsedInput: IParsedChatRequest;
	readonly lockedAgentId: string | undefined;
	lastSelectedAgent: IChatAgentData | undefined;
	readonly scopedContextKeyService: IContextKeyService;
	readonly input: ChatInputPart;
	readonly inputPart: ChatInputPart;
	readonly attachmentModel: ChatAttachmentModel;
	readonly locationData?: IChatLocationData;
	readonly contribs: readonly IChatWidgetContrib[];

	readonly supportsChangingModes: boolean;

	getContrib<T extends IChatWidgetContrib>(id: string): T | undefined;
	reveal(item: ChatTreeItem): void;
	focus(item: ChatTreeItem): void;
	getSibling(item: ChatTreeItem, type: 'next' | 'previous'): ChatTreeItem | undefined;
	getFocus(): ChatTreeItem | undefined;
	setInput(query?: string): void;
	getInput(): string;
	refreshParsedInput(): void;
	setPersistentContentHeight(height: number | undefined): void;
	logInputHistory(): void;
	acceptInput(query?: string, options?: IChatAcceptInputOptions): Promise<IChatResponseModel | undefined>;
	getSelectedModelRequestOptions(): Pick<IChatSendRequestOptions, 'userSelectedModelId' | 'userSelectedModelConfiguration'>;
	startEditing(requestId: string): void;
	cancelEditing(): Promise<void>;
	finishedEditing(completedEdit?: boolean): void;
	rerunLastRequest(): Promise<void>;
	setInputPlaceholder(placeholder: string): void;
	resetInputPlaceholder(): void;
	focusResponseItem(lastFocused?: boolean): void;
	focusInput(): void;
	focusTodosView(): boolean;
	toggleTodosViewFocus(): boolean;
	focusQuestionCarousel(): boolean;
	toggleQuestionCarouselFocus(): boolean;
	navigateToPreviousQuestion(): boolean;
	navigateToNextQuestion(): boolean;
	focusQuestionCarouselTerminal(): boolean;
	hasInputFocus(): boolean;
	getModeRequestOptions(): Partial<IChatSendRequestOptions>;
	getCodeBlockInfoForEditor(uri: URI): IChatCodeBlockInfo | undefined;
	getCodeBlockInfosForResponse(response: IChatResponseViewModel): IChatCodeBlockInfo[];
	getFileTreeInfosForResponse(response: IChatResponseViewModel): IChatFileTreeInfo[];
	getLastFocusedFileTreeForResponse(response: IChatResponseViewModel): IChatFileTreeInfo | undefined;
	getElementFromNode(node: HTMLElement): ChatTreeItem | undefined;
	holdAutoScroll(): IDisposable;
	clear(resolvedSessionType?: IResolvedNewChatSessionType | string): Promise<void>;
	getInputState(): IChatModelInputState | undefined;
	getViewState(): IChatWidgetViewState;
	restoreViewState(state: IChatWidgetViewState): void;
	lockToCodingAgent(name: string, displayName: string, agentId?: string, agentHostProviderId?: string): void;
	unlockFromCodingAgent(): void;
	handleDelegationExitIfNeeded(sourceAgent: Pick<IChatAgentData, 'id' | 'name'> | undefined, targetAgent: IChatAgentData | undefined): Promise<void>;
	executeHandoff(handoff: IHandOff, agentId?: string): Promise<void>;

	delegateScrollFromMouseWheelEvent(event: IMouseWheelEvent): void;

	getFindController(): IChatFindController | undefined;
}

export interface IChatFindController {
	readonly visible: boolean;
	show(seedText?: string, focus?: boolean): void;
	hide(): void;
	next(): void;
	previous(): void;
	toggleCaseSensitive(): void;
	toggleWholeWord(): void;
	toggleRegex(): void;
	focus(): void;
}

export function setModelPreservingInputTypedWhileLoading(widget: IChatWidget, inputBeforeLoad: string, setModel: () => void): void {
	const typedWhileLoading = widget.getInput();
	setModel();
	if (typedWhileLoading && typedWhileLoading !== inputBeforeLoad && !widget.getInput()) {
		widget.setInput(typedWhileLoading);
	}
}


export interface ICodeBlockActionContextProvider {
	getCodeBlockContext(editor?: ICodeEditor): ICodeBlockActionContext | undefined;
}

export const IChatCodeBlockContextProviderService = createDecorator<IChatCodeBlockContextProviderService>('chatCodeBlockContextProviderService');
export interface IChatCodeBlockContextProviderService {
	readonly _serviceBrand: undefined;
	readonly providers: ICodeBlockActionContextProvider[];
	registerProvider(provider: ICodeBlockActionContextProvider, id: string): IDisposable;
}

export const ChatViewId = `workbench.panel.chat.view.${CHAT_PROVIDER_ID}`;
export const ChatViewContainerId = 'workbench.panel.chat';

export const HasInstalledAgentPluginsContext = new RawContextKey<boolean>('hasInstalledAgentPlugins', false);
export const InstalledAgentPluginsViewId = 'workbench.views.agentPlugins.installed';

export interface IChatAttachmentTarget {
	readonly attachments: readonly IChatRequestVariableEntry[];

	addAttachments(entries: readonly IChatRequestVariableEntry[]): void;
}

export interface IChatPasteTarget extends IChatAttachmentTarget {

	readonly sessionResource: URI;

	readonly inlineReferences: readonly IDynamicVariable[];

	removeAttachments(ids: readonly string[]): void;

	addInlineAttachment(entry: IChatRequestVariableEntry, text: string, range: IRange): void;

	addInlineReference(reference: IDynamicVariable): void;

	isTerminalCommandPaste(text: string, range: IRange): boolean;
}

export const IChatPasteTargetService = createDecorator<IChatPasteTargetService>('chatPasteTargetService');

export interface IChatPasteTargetService {
	readonly _serviceBrand: undefined;

	registerTarget(inputUri: URI, target: IChatPasteTarget): IDisposable;

	getTarget(inputUri: URI): IChatPasteTarget | undefined;
}

export const UpdateAgentPluginsCommandId = 'workbench.agentPlugins.checkForUpdates';
export const ForceUpdateAgentPluginsCommandId = 'workbench.agentPlugins.forceUpdate';
export const RefreshAgentPluginMarketplacesCommandId = 'workbench.agentPlugins.refreshMarketplaces';
export const UpdatingAgentPluginsContext = new RawContextKey<boolean>('agentPluginsUpdating', false);
