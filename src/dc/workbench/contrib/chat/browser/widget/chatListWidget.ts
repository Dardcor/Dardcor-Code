/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { IMouseWheelEvent } from '../../../../../base/browser/mouseEvent.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { ITreeContextMenuEvent, ITreeElement, ITreeFilter } from '../../../../../base/browser/ui/tree/tree.js';
import { RenderIndentGuides } from '../../../../../base/browser/ui/tree/abstractTree.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableMap, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { Mimes } from '../../../../../base/common/mime.js';
import { ScrollEvent } from '../../../../../base/common/scrollable.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { WorkbenchObjectTree } from '../../../../../platform/list/browser/listService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { asCssVariable, asCssVariableWithDefault, buttonSecondaryBackground, buttonSecondaryForeground } from '../../../../../platform/theme/common/colorRegistry.js';
import { katexContainerClassName } from '../../../markdown/common/markedKatexExtension.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { IChatFollowup, IChatSendRequestOptions, IChatService } from '../../common/chatService/chatService.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind } from '../../common/constants.js';
import { IChatRequestModeInfo } from '../../common/model/chatModel.js';
import { IChatRequestViewModel, IChatResponseViewModel, IChatViewModel, isRequestVM, isResponseVM } from '../../common/model/chatViewModel.js';
import { PROMPT_TIMELINE_STICKY_SCROLL_SETTING } from '../../common/promptTimeline.js';
import { ChatAccessibilityProvider } from '../accessibility/chatAccessibilityProvider.js';
import { ChatTreeItem, IChatAccessibilityService, IChatCodeBlockInfo, IChatFileTreeInfo, IChatListItemRendererOptions } from '../chat.js';
import { CodeBlockPart } from './chatContentParts/codeBlockPart.js';
import { ChatCollapsibleContentPart } from './chatContentParts/chatCollapsibleContentPart.js';
import { ChatListDelegate, ChatListItemRenderer, IChatListItemTemplate, IChatRendererDelegate } from './chatListRenderer.js';
import { sanitizeChatClipboardFragment } from './chatClipboard.js';
import { ChatEditorOptions } from './chatOptions.js';
import { ChatPendingDragController } from './chatPendingDragAndDrop.js';

const CHAT_STICKY_SCROLL_TOP_PADDING = 8;

export interface IChatListWidgetStyles {
	listForeground?: string;
	listBackground?: string;
	listShadow?: string;
}

export class AutoScrollHolds {

	private _count = 0;

	get isHeld(): boolean {
		return this._count > 0;
	}

	acquire(): IDisposable {
		this._count++;
		let released = false;
		return toDisposable(() => {
			if (!released) {
				released = true;
				this._count--;
			}
		});
	}
}

export class UserToggleResizeState {

	private framesUntilSettled = 0;
	private transitionInProgress = false;

	constructor(private readonly requiredStableFrames: number) { }

	get isActive(): boolean {
		return this.transitionInProgress || this.framesUntilSettled > 0;
	}

	start(): void {
		this.framesUntilSettled = this.requiredStableFrames;
	}

	markResized(): void {
		if (this.isActive) {
			this.framesUntilSettled = this.requiredStableFrames;
		}
	}

	startTransition(): void {
		this.transitionInProgress = true;
	}

	endTransition(): void {
		this.transitionInProgress = false;
		this.framesUntilSettled = this.requiredStableFrames;
	}

	advanceFrame(): void {
		if (this.isActive) {
			this.framesUntilSettled--;
		}
	}
}

export function getAnchoredScrollTop(scrollTop: number, currentTargetTop: number, anchorTargetTop: number): number {
	return scrollTop + currentTargetTop - anchorTargetTop;
}

export function computeScrollDownState(isScrolledToBottom: boolean, scrollLock: boolean): { showButton: boolean; atBottom: boolean } {
	return {
		showButton: !isScrolledToBottom,
		atBottom: isScrolledToBottom || scrollLock,
	};
}

class UserToggleResizeTracker extends Disposable {

	private readonly state = new UserToggleResizeState(2);
	private readonly pendingFrame = this._register(new MutableDisposable<IDisposable>());

	constructor(
		target: HTMLElement,
		private restoreScrollPosition: (() => void) | undefined,
		private readonly onDidSettle: () => void,
	) {
		super();

		const targetWindow = dom.getWindow(target);
		const resizeObserver = this._register(new dom.DisposableResizeObserver('ChatListWidget.userToggleResize', () => {
			this.state.markResized();
			this.scheduleFrame(targetWindow);
		}, targetWindow));
		this._register(resizeObserver.observe(target));
		this._register(dom.addDisposableListener(target, 'transitionrun', e => {
			if (e.propertyName === 'grid-template-rows') {
				this.state.startTransition();
				this.scheduleFrame(targetWindow);
			}
		}));
		const finishTransition = (e: TransitionEvent) => {
			if (e.propertyName === 'grid-template-rows') {
				this.state.endTransition();
				this.scheduleFrame(targetWindow);
			}
		};
		this._register(dom.addDisposableListener(target, 'transitionend', finishTransition));
		this._register(dom.addDisposableListener(target, 'transitioncancel', finishTransition));

		this.state.start();
		this.scheduleFrame(targetWindow);
	}

	restoreScrollAnchor(): void {
		this.restoreScrollPosition?.();
	}

	cancelScrollRestoration(): void {
		this.restoreScrollPosition = undefined;
	}

	private scheduleFrame(targetWindow: Window): void {
		if (this.pendingFrame.value) {
			return;
		}

		this.pendingFrame.value = dom.scheduleAtNextAnimationFrame(targetWindow, () => {
			this.pendingFrame.clear();
			this.restoreScrollPosition?.();
			this.state.advanceFrame();
			if (this.state.isActive) {
				this.scheduleFrame(targetWindow);
			} else {
				this.onDidSettle();
			}
		});
	}
}

export interface IChatListWidgetOptions {
	readonly rendererOptions?: IChatListItemRendererOptions;

	readonly defaultElementHeight?: number;

	readonly overflowWidgetsDomNode?: HTMLElement;

	readonly styles?: IChatListWidgetStyles;

	readonly currentChatMode?: () => ChatModeKind;

	readonly viewId?: string;

	readonly inputEditorBackground?: string;

	readonly resultEditorBackground?: string;

	readonly filter?: ITreeFilter<ChatTreeItem, FuzzyScore>;

	readonly viewModel?: IChatViewModel;

	readonly editorOptions?: ChatEditorOptions;

	readonly location?: ChatAgentLocation;

	readonly getSelectedModelRequestOptions?: () => Pick<IChatSendRequestOptions, 'userSelectedModelId' | 'userSelectedModelConfiguration'>;

	readonly getCurrentModeInfo?: () => IChatRequestModeInfo | undefined;

	readonly getEditingValue?: () => string | undefined;

	readonly paddingBottom?: number;
}

export class ChatListWidget extends Disposable {


	private readonly _onDidScroll = this._register(new Emitter<ScrollEvent>());
	readonly onDidScroll: Event<ScrollEvent> = this._onDidScroll.event;

	private readonly _onDidChangeContentHeight = this._register(new Emitter<void>());
	readonly onDidChangeContentHeight: Event<void> = this._onDidChangeContentHeight.event;

	private readonly _onDidClickFollowup = this._register(new Emitter<IChatFollowup>());
	readonly onDidClickFollowup: Event<IChatFollowup> = this._onDidClickFollowup.event;

	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus: Event<void> = this._onDidFocus.event;

	private readonly _onDidChangeItemHeight = this._register(new Emitter<{ element: ChatTreeItem; height: number }>());
	readonly onDidChangeItemHeight: Event<{ element: ChatTreeItem; height: number }> = this._onDidChangeItemHeight.event;

	get onDidClickRequest(): Event<IChatListItemTemplate> {
		return this._renderer.onDidClickRequest;
	}

	get onDidRerender(): Event<IChatListItemTemplate> {
		return this._renderer.onDidRerender;
	}

	get onDidDispose(): Event<IChatListItemTemplate> {
		return this._renderer.onDidDispose;
	}

	get onDidFocusOutside(): Event<void> {
		return this._renderer.onDidFocusOutside;
	}



	private readonly _tree: WorkbenchObjectTree<ChatTreeItem, FuzzyScore>;
	private readonly _delegate: ChatListDelegate;
	private readonly _renderer: ChatListItemRenderer;

	private _viewModel: IChatViewModel | undefined;
	private _visible = true;
	private _lastItem: ChatTreeItem | undefined;
	private _mostRecentlyFocusedItemIndex: number = -1;
	private _scrollLock: boolean = true;
	private _autoScrollHolds = new AutoScrollHolds();
	private _settingChangeCounter: number = 0;
	private _visibleChangeCount: number = 0;
	private readonly _userToggleResizeTrackers = this._register(new DisposableMap<ChatTreeItem, UserToggleResizeTracker>());

	private readonly _container: HTMLElement;
	private readonly _scrollDownButton: Button;
	private readonly _lastItemIdContextKey: IContextKey<string[]>;

	private readonly _location: ChatAgentLocation | undefined;
	private readonly _getSelectedModelRequestOptions: (() => Pick<IChatSendRequestOptions, 'userSelectedModelId' | 'userSelectedModelConfiguration'>) | undefined;
	private readonly _getCurrentModeInfo: (() => IChatRequestModeInfo | undefined) | undefined;
	private readonly _useTreeHierarchy: boolean;
	private _paddingBottom: number;



	get domNode(): HTMLElement {
		return this._container;
	}

	get scrollTop(): number {
		return this._tree.scrollTop;
	}

	set scrollTop(value: number) {
		this._tree.scrollTop = value;
	}

	get scrollHeight(): number {
		return this._tree.scrollHeight;
	}

	get renderHeight(): number {
		return this._tree.renderHeight;
	}

	get contentHeight(): number {
		return this._tree.contentHeight;
	}

	get isScrolledToBottom(): boolean {
		return this._tree.scrollTop + this._tree.renderHeight >= this._tree.scrollHeight - 2;
	}

	get lastItem(): ChatTreeItem | undefined {
		return this._lastItem;
	}

	get lastVisibleItem(): ChatTreeItem | undefined {
		const items = this._viewModel?.getItems();
		if (!items?.length) {
			return undefined;
		}
		const viewportBottom = this._tree.scrollTop + this._tree.renderHeight;
		for (let index = items.length - 1; index >= 0; index--) {
			const top = this.getElementTop(items[index]);
			if (top !== undefined && top <= viewportBottom) {
				return items[index];
			}
		}
		return items[0];
	}




	constructor(
		container: HTMLElement,
		options: IChatListWidgetOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IChatService private readonly chatService: IChatService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IChatAccessibilityService private readonly chatAccessibilityService: IChatAccessibilityService,
	) {
		super();

		this._viewModel = options.viewModel;
		this._location = options.location;
		this._getSelectedModelRequestOptions = options.getSelectedModelRequestOptions;
		this._getCurrentModeInfo = options.getCurrentModeInfo;
		this._useTreeHierarchy = !options.filter;
		this._paddingBottom = options.paddingBottom ?? 0;
		this._lastItemIdContextKey = ChatContextKeys.lastItemId.bindTo(this.contextKeyService);
		this._container = container;

		const updateInlineReferencesStyle = () => {
			const style = this.configurationService.getValue<string>(ChatConfiguration.InlineReferencesStyle);
			this._container.classList.toggle('chat-inline-references-link-style', style === 'link');
		};
		updateInlineReferencesStyle();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.InlineReferencesStyle)) {
				updateInlineReferencesStyle();
			}
		}));

		const scopedInstantiationService = this._register(this.instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this.contextKeyService])
		));

		const overflowWidgetsContainer = options.overflowWidgetsDomNode ?? document.createElement('div');
		if (!options.overflowWidgetsDomNode) {
			overflowWidgetsContainer.classList.add('chat-overflow-widget-container', 'monaco-editor');
			this._container.append(overflowWidgetsContainer);
			this._register(toDisposable(() => overflowWidgetsContainer.remove()));
		}

		const editorOptions = options.editorOptions ?? this._register(scopedInstantiationService.createInstance(
			ChatEditorOptions,
			options.viewId,
			'foreground',
			options.inputEditorBackground ?? 'chat.requestEditor.background',
			options.resultEditorBackground ?? 'chat.responseEditor.background'
		));

		this._delegate = scopedInstantiationService.createInstance(
			ChatListDelegate,
			options.defaultElementHeight ?? 200
		);

		const rendererDelegate: IChatRendererDelegate = {
			getListLength: () => this._tree.getListRenderCount(null),
			onDidScroll: this.onDidScroll,
			container: this._container,
			currentChatMode: options.currentChatMode ?? (() => ChatModeKind.Ask),
			isStickyScrollEnabled: () => this.isTreeStickyScrollEnabled(),
			refreshStickyScroll: () => this._tree.refreshStickyScroll(),
			stickyScrollTopPadding: CHAT_STICKY_SCROLL_TOP_PADDING,
			getEditingValue: options.getEditingValue,
		};

		this._renderer = this._register(scopedInstantiationService.createInstance(
			ChatListItemRenderer,
			editorOptions,
			options.rendererOptions ?? {},
			rendererDelegate,
			overflowWidgetsContainer,
			this._viewModel,
		));

		this._register(this._renderer.onDidClickFollowup(item => {
			this._onDidClickFollowup.fire(item);
		}));

		this._register(this._renderer.onDidChangeItemHeight(e => {
			this._updateElementHeight(e.element, e.height);
			this._onDidChangeItemHeight.fire(e);
		}));

		this._register(this._renderer.onDidClickRerunWithAgentOrCommandDetection(e => {
			const request = this.chatService.getSession(e.sessionResource)?.getRequests().find(candidate => candidate.id === e.requestId);
			if (request) {
				const sendOptions: IChatSendRequestOptions = {
					noCommandDetection: true,
					attempt: request.attempt + 1,
					location: this._location,
					...this._getSelectedModelRequestOptions?.(),
					modeInfo: this._getCurrentModeInfo?.(),
				};
				this.chatAccessibilityService.acceptRequest(e.sessionResource);
				this.chatService.resendRequest(request, sendOptions).catch(e => this.logService.error('FAILED to rerun request', e));
			}
		}));

		this._renderer.pendingDragController = this._register(
			scopedInstantiationService.createInstance(ChatPendingDragController, this._container, () => this._viewModel)
		);

		const styles = options.styles ?? {};
		this._tree = this._register(scopedInstantiationService.createInstance(
			WorkbenchObjectTree<ChatTreeItem, FuzzyScore>,
			'ChatList',
			this._container,
			this._delegate,
			[this._renderer],
			{
				identityProvider: { getId: (e: ChatTreeItem) => e.id },
				horizontalScrolling: false,
				alwaysConsumeMouseWheel: false,
				supportDynamicHeights: true,
				paddingBottom: this._paddingBottom,
				hideTwistiesOfChildlessElements: true,
				enableStickyScroll: this.isTreeStickyScrollEnabled(),
				stickyScrollMaxItemCount: 1,
				stickyScrollMaxNodeHeight: 150,
				stickyScrollNodeSourceRangeProvider: (element, defaultRange) => this._renderer.getStickyScrollSourceRange(element, defaultRange),
				indent: 0,
				expandOnDoubleClick: false,
				expandOnlyOnTwistieClick: true,
				allowNonCollapsibleParents: true,
				renderIndentGuides: RenderIndentGuides.None,
				findWidgetEnabled: false,
				accessibilityProvider: this.instantiationService.createInstance(ChatAccessibilityProvider),
				keyboardNavigationLabelProvider: {
					getKeyboardNavigationLabel: (e: ChatTreeItem) =>
						isRequestVM(e) ? e.message : isResponseVM(e) ? e.response.value : ''
				},
				setRowLineHeight: false,
				scrollToActiveElement: true,
				filter: options.filter,
				overrideStyles: {
					listFocusBackground: styles.listBackground,
					listInactiveFocusBackground: styles.listBackground,
					listActiveSelectionBackground: styles.listBackground,
					listFocusAndSelectionBackground: styles.listBackground,
					listInactiveSelectionBackground: styles.listBackground,
					listHoverBackground: styles.listBackground,
					listBackground: styles.listBackground,
					listFocusForeground: styles.listForeground,
					listHoverForeground: styles.listForeground,
					listInactiveFocusForeground: styles.listForeground,
					listInactiveSelectionForeground: styles.listForeground,
					listActiveSelectionForeground: styles.listForeground,
					listFocusAndSelectionForeground: styles.listForeground,
					listActiveSelectionIconForeground: undefined,
					listInactiveSelectionIconForeground: undefined,
					treeStickyScrollBackground: styles.listBackground,
					treeStickyScrollBorder: undefined,
					treeStickyScrollShadow: styles.listShadow,
				}
			}
		));

		const scrollToBottomLabel = localize('chat.scrollToBottom', "Scroll to Bottom");
		const scrollToBottomBackground = asCssVariableWithDefault('chat.list.background', asCssVariable(buttonSecondaryBackground));
		this._scrollDownButton = this._register(new Button(this._container, {
			title: scrollToBottomLabel,
			ariaLabel: scrollToBottomLabel,
			buttonBackground: scrollToBottomBackground,
			buttonForeground: asCssVariable(buttonSecondaryForeground),
			buttonHoverBackground: scrollToBottomBackground,
			buttonSecondaryBackground: undefined,
			buttonSecondaryForeground: undefined,
			buttonSecondaryHoverBackground: undefined,
			buttonSeparator: undefined,
			supportIcons: true,
		}));
		this._scrollDownButton.element.classList.add('chat-scroll-down');
		this._scrollDownButton.label = `$(${Codicon.chevronDown.id})`;
		this._scrollDownButton.element.style.display = 'none';

		this._register(this._scrollDownButton.onDidClick(() => {
			this.cancelUserToggleScrollRestoration();
			this.setScrollLock(true);
			this.scrollToEnd();
		}));


		this._register(this._tree.onDidChangeContentHeight(() => {
			this._onDidChangeContentHeight.fire();
		}));

		this._register(this._tree.onDidFocus(() => {
			this._onDidFocus.fire();
		}));

		this._register(this._tree.onDidChangeFocus(() => {
			const focused = this.getFocus();
			if (focused && focused.length > 0) {
				const focusedItem = focused[0];
				const items = this.getItems();
				const idx = items.findIndex(i => i === focusedItem);
				if (idx !== -1) {
					this._mostRecentlyFocusedItemIndex = idx;
				}
			}
		}));

		this._register(this._tree.onDidScroll((e) => {
			this._onDidScroll.fire(e);
			this.updateScrollDownButtonVisibility();
		}));

		this.updateScrollDownButtonVisibility();

		this._register(dom.addDisposableListener(this._container, ChatCollapsibleContentPart.userToggleEvent, e => {
			if (!dom.isHTMLElement(e.target)) {
				return;
			}

			const element = this._renderer.getElementFromNode(e.target);
			if (element) {
				this.trackUserToggleResize(element, e.target);
			}
		}));
		this._register(dom.addDisposableListener(this._container, dom.EventType.WHEEL, () => this.cancelUserToggleScrollRestoration()));
		this._register(dom.addDisposableListener(this._container, dom.EventType.POINTER_DOWN, () => this.cancelUserToggleScrollRestoration()));
		this._register(dom.addDisposableListener(this._container, dom.EventType.KEY_DOWN, e => {
			const keyCode = new StandardKeyboardEvent(e).keyCode;
			if (keyCode === KeyCode.UpArrow
				|| keyCode === KeyCode.DownArrow
				|| keyCode === KeyCode.PageUp
				|| keyCode === KeyCode.PageDown
				|| keyCode === KeyCode.Home
				|| keyCode === KeyCode.End) {
				this.cancelUserToggleScrollRestoration();
			}
		}, true));

		this._register(this._tree.onContextMenu(e => {
			this.handleContextMenu(e);
		}));

		this._register(dom.addDisposableListener(this._container, 'copy', e => this.handleCopy(e)));

		this._register(this.configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(ChatConfiguration.ExperimentalStickyScrollEnabled) || e.affectsConfiguration(PROMPT_TIMELINE_STICKY_SCROLL_SETTING)) {
				this._renderer.refreshStickyScrollSourceRanges(true);
				this._tree.updateOptions({ enableStickyScroll: this.isTreeStickyScrollEnabled() });
			}
			if (e.affectsConfiguration(ChatConfiguration.EditRequests)
				|| e.affectsConfiguration(ChatConfiguration.CheckpointsEnabled)
				|| e.affectsConfiguration(ChatConfiguration.RichLinks)) {
				this._settingChangeCounter++;
				this.refresh();
			}
		}));
	}


	private handleCopy(e: ClipboardEvent): void {
		const selection = dom.getWindow(this._container).getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !e.clipboardData) {
			return;
		}

		// eslint-disable-next-line no-restricted-syntax
		const touched = Array.from(this._container.querySelectorAll('a, img'))
			.filter(element => selection.containsNode(element, true));
		if (!touched.length) {
			return;
		}

		const ranges: Range[] = [];
		for (let i = 0; i < selection.rangeCount; i++) {
			const range = selection.getRangeAt(i);
			if (!dom.isAncestor(range.commonAncestorContainer, this._container)) {
				return;
			}
			ranges.push(range);
		}

		const fragments = ranges.map(range => this.cloneSelectedContents(range));
		if (!fragments.map(fragment => sanitizeChatClipboardFragment(fragment)).some(Boolean)) {
			return;
		}

		const holder = dom.$('div');
		for (const fragment of fragments) {
			holder.appendChild(fragment);
		}

		e.clipboardData.setData(Mimes.text, selection.toString());
		e.clipboardData.setData(Mimes.html, holder.innerHTML);
		e.preventDefault();
	}

	private cloneSelectedContents(range: Range): DocumentFragment {
		let content: Node = range.cloneContents();

		for (
			let ancestor = range.commonAncestorContainer;
			ancestor && ancestor !== this._container;
			ancestor = ancestor.parentNode as Node
		) {
			if (!dom.isHTMLElement(ancestor)) {
				continue;
			}

			if (ancestor.tagName === 'A') {
				content = ancestor.cloneNode(true);
				continue;
			}

			const wrapper = ancestor.cloneNode(false);
			wrapper.appendChild(content);
			content = wrapper;
		}

		if (content.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			return content as DocumentFragment;
		}

		const fragment = this._container.ownerDocument.createDocumentFragment();
		fragment.appendChild(content);
		return fragment;
	}

	private updateScrollDownButtonVisibility(): void {
		const { showButton, atBottom } = computeScrollDownState(this.isScrolledToBottom, this._scrollLock);
		this._scrollDownButton.element.style.display = showButton ? 'flex' : 'none';
		this._container.classList.toggle('chat-list-at-bottom', atBottom);
	}

	private handleContextMenu(e: ITreeContextMenuEvent<ChatTreeItem | null>): void {
		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();

		const selected = e.element;

		const target = e.browserEvent.target as HTMLElement;
		const isKatexElement = target.closest(`.${katexContainerClassName}`) !== null;

		const scopedContextKeyService = this.contextKeyService.createOverlay([
			[ChatContextKeys.isResponse.key, isResponseVM(selected)],
			[ChatContextKeys.responseIsFiltered.key, isResponseVM(selected) && !!selected.errorDetails?.responseIsFiltered],
			[ChatContextKeys.isKatexMathElement.key, isKatexElement]
		]);
		this.contextMenuService.showContextMenu({
			menuId: MenuId.ChatContext,
			menuActionOptions: { shouldForwardArgs: true },
			contextKeyService: scopedContextKeyService,
			getAnchor: () => e.anchor,
			getActionsContext: () => selected,
		});
	}



	setViewModel(viewModel: IChatViewModel | undefined): void {
		this._viewModel = viewModel;
		this._renderer.updateViewModel(viewModel);
	}

	refresh(): void {
		if (!this._viewModel) {
			this._tree.setChildren(null, []);
			this._lastItem = undefined;
			this._lastItemIdContextKey.set([]);
			return;
		}

		const items = this._viewModel.getItems();
		this._lastItem = items.at(-1);
		this._lastItemIdContextKey.set(this._lastItem ? [this._lastItem.id] : []);

		const treeItems = this._useTreeHierarchy
			? this.createRequestTreeItems(items)
			: items.map(item => ({ element: item, collapsed: false, collapsible: false }));

		const editing = this._viewModel.editing;

		this._withPersistedAutoScroll(() => {
			this._tree.setChildren(null, treeItems, {
				diffDepth: 1,
				diffIdentityProvider: {
					getId: (element) => {
						const baseId = (isRequestVM(element) || isResponseVM(element)) ? element.dataId : element.id;
						const disablement = (isRequestVM(element) || isResponseVM(element)) ? element.shouldBeRemovedOnSend : undefined;
						const isLastItem = element.id === this._lastItem?.id;
						const isEditTarget = isRequestVM(element) && editing?.id === element.id;
						const isBlocked = (isRequestVM(element) || isResponseVM(element)) ? element.shouldBeBlocked.get() : false;
						return baseId +
							`${isResponseVM(element) && element.renderData ? `_${this._visibleChangeCount}` : ''}` +
							(isResponseVM(element) ? `_${element.contentReferences.length}` : '') +
							`_${disablement ? `${disablement.afterUndoStop || '1'}` : '0'}` +
							`_${isEditTarget ? 'edit' : ''}` +
							`_${isBlocked ? 'blocked' : ''}` +
							(isRequestVM(element) ? `_${editing ? '1' : '0'}` : '') +
							`_${isLastItem ? 'last' : ''}` +
							`_setting${this._settingChangeCounter}` +
							(isRequestVM(element) && element.contentReferences ? `_${element.contentReferences?.length}` : '');
					},
				}
			});
		});
	}

	setScrollLock(value: boolean): void {
		this._scrollLock = value;
		this.updateScrollDownButtonVisibility();
	}

	get scrollLock(): boolean {
		return this._scrollLock;
	}

	setVisibleChangeCount(value: number): void {
		this._visibleChangeCount = value;
	}

	scrollToCurrentItem(currentElement: IChatRequestViewModel): void {
		if (!this._viewModel?.editing || !currentElement) {
			return;
		}
		if (!this._tree.hasElement(currentElement)) {
			return;
		}
		const relativeTop = this._tree.getRelativeTop(currentElement);
		if (relativeTop === null || relativeTop < 0 || relativeTop > 1) {
			this._tree.reveal(currentElement, 0);
		}
	}



	rerender(): void {
		this._tree.rerender();
		this._renderer.refreshStickyScrollSourceRanges(true);
		this._tree.rerenderStickyScroll();
	}

	private getItems(): ChatTreeItem[] {
		const items: ChatTreeItem[] = [];
		const root = this._tree.getNode(null);
		const collect = (children: Iterable<typeof root>) => {
			for (const child of children) {
				if (child.visible && child.element) {
					items.push(child.element);
				}
				if (!child.collapsed) {
					collect(child.children);
				}
			}
		};
		collect(root.children);
		return items;
	}

	private createRequestTreeItems(items: ChatTreeItem[]): ITreeElement<ChatTreeItem>[] {
		const treeItems: ITreeElement<ChatTreeItem>[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (isRequestVM(item)) {
				const children: ITreeElement<ChatTreeItem>[] = [];
				while (i + 1 < items.length && isResponseVM(items[i + 1])) {
					i++;
					children.push({ element: items[i], collapsed: false, collapsible: false });
				}
				treeItems.push({
					element: item,
					collapsed: false,
					collapsible: false,
					children,
				});
			} else {
				treeItems.push({ element: item, collapsed: false, collapsible: false });
			}
		}
		return treeItems;
	}

	private isTreeStickyScrollEnabled(): boolean {
		return this._useTreeHierarchy
			&& this.configurationService.getValue<boolean>(PROMPT_TIMELINE_STICKY_SCROLL_SETTING) === true
			&& this.configurationService.getValue<boolean>(ChatConfiguration.ExperimentalStickyScrollEnabled) === true;
	}


	delegateScrollFromMouseWheelEvent(event: IMouseWheelEvent): void {
		this.cancelUserToggleScrollRestoration();
		this._tree.delegateScrollFromMouseWheelEvent(event);
	}

	hasElement(element: ChatTreeItem): boolean {
		return this._tree.hasElement(element);
	}

	private _updateElementHeight(element: ChatTreeItem, height?: number): void {
		if (this._tree.hasElement(element) && this._visible) {
			const userToggleResizeTracker = this._userToggleResizeTrackers.get(element);
			if (userToggleResizeTracker) {
				this._tree.updateElementHeight(element, height);
				userToggleResizeTracker.restoreScrollAnchor();
				return;
			}
			this._withPersistedAutoScroll(() => {
				this._tree.updateElementHeight(element, height);
			});
		}
	}

	private trackUserToggleResize(element: ChatTreeItem, target: HTMLElement): void {
		const anchorTargetTop = this.isScrolledToBottom ? target.getBoundingClientRect().top : undefined;
		const restoreScrollPosition = anchorTargetTop === undefined ? undefined : () => {
			if (target.isConnected) {
				this._tree.scrollTop = getAnchoredScrollTop(this._tree.scrollTop, target.getBoundingClientRect().top, anchorTargetTop);
			}
		};
		const tracker: UserToggleResizeTracker = new UserToggleResizeTracker(target, restoreScrollPosition, () => {
			if (this._userToggleResizeTrackers.get(element) === tracker) {
				this._userToggleResizeTrackers.deleteAndDispose(element);
			}
		});
		this._userToggleResizeTrackers.set(element, tracker);
	}

	private cancelUserToggleScrollRestoration(): void {
		for (const tracker of this._userToggleResizeTrackers.values()) {
			tracker.cancelScrollRestoration();
		}
	}

	reveal(element: ChatTreeItem, relativeTop?: number): void {
		this._tree.reveal(element, relativeTop);
	}

	getElementTop(element: ChatTreeItem): number | undefined {
		if (!this._tree.hasElement(element)) {
			return undefined;
		}
		return this._tree.getElementTop(element);
	}

	getFocus(): ChatTreeItem[] {
		return this._tree.getFocus().filter((e): e is ChatTreeItem => e !== null);
	}

	setFocus(elements: ChatTreeItem[]): void {
		this._tree.setFocus(elements);
	}

	focusItem(item: ChatTreeItem): void {
		if (!this.hasElement(item)) {
			return;
		}
		this._tree.setFocus([item]);
		this._tree.domFocus();
	}

	focusLastItem(useMostRecentlyFocusedIndex?: boolean): number {
		const items = this.getItems();
		if (items.length === 0) {
			return -1;
		}

		let focusIndex: number;
		if (useMostRecentlyFocusedIndex && this._mostRecentlyFocusedItemIndex >= 0 && this._mostRecentlyFocusedItemIndex < items.length) {
			focusIndex = this._mostRecentlyFocusedItemIndex;
		} else {
			focusIndex = items.length - 1;
		}

		this._tree.setFocus([items[focusIndex]]);
		this._tree.domFocus();
		return focusIndex;
	}

	scrollToEnd(): void {
		const lastElement = this.getItems().at(-1);
		if (lastElement) {
			const offset = Math.max(lastElement.currentRenderedHeight ?? 0, 1e6);
			this._tree.reveal(lastElement, offset);
			if (this._paddingBottom) {
				this._tree.scrollTop += this._paddingBottom;
			}
		}
	}

	acquireAutoScrollHold(): IDisposable {
		return this._autoScrollHolds.acquire();
	}

	get isAutoScrollHeld(): boolean {
		return this._autoScrollHolds.isHeld;
	}

	private _withPersistedAutoScroll(fn: () => void): void {
		if (this.isAutoScrollHeld) {
			fn();
			return;
		}
		const wasScrolledToBottom = this.isScrolledToBottom;
		fn();
		if (wasScrolledToBottom) {
			this.scrollToEnd();
		}
	}

	focus(): void {
		this._tree.domFocus();
	}

	isDOMFocused(): boolean {
		return this._tree.isDOMFocused();
	}



	getCodeBlockInfosForResponse(response: IChatResponseViewModel): IChatCodeBlockInfo[] {
		return this._renderer.getCodeBlockInfosForResponse(response);
	}

	getCodeBlockInfoForEditor(uri: URI): IChatCodeBlockInfo | undefined {
		return this._renderer.getCodeBlockInfoForEditor(uri);
	}

	getFileTreeInfosForResponse(response: IChatResponseViewModel): IChatFileTreeInfo[] {
		return this._renderer.getFileTreeInfosForResponse(response);
	}

	getLastFocusedFileTreeForResponse(response: IChatResponseViewModel): IChatFileTreeInfo | undefined {
		return this._renderer.getLastFocusedFileTreeForResponse(response);
	}

	editorsInUse(): Iterable<CodeBlockPart> {
		return this._renderer.editorsInUse();
	}



	getTemplateDataForRequestId(requestId: string | undefined): IChatListItemTemplate | undefined {
		if (!requestId) {
			return undefined;
		}
		return this._renderer.getTemplateDataForRequestId(requestId);
	}

	getElementFromNode(node: HTMLElement): ChatTreeItem | undefined {
		return this._renderer.getElementFromNode(node);
	}

	updateRendererOptions(options: IChatListItemRendererOptions): void {
		this._renderer.updateOptions(options);
	}

	setPaddingBottom(paddingBottom: number): void {
		const value = Math.max(0, paddingBottom);
		if (value === this._paddingBottom) {
			return;
		}
		const wasScrolledToBottom = this.isScrolledToBottom;
		this._paddingBottom = value;
		this._tree.updateOptions({ paddingBottom: value });
		if (wasScrolledToBottom) {
			this.scrollToEnd();
		}
	}

	setStyles(styles: IChatListWidgetStyles): void {
		this._tree.updateOptions({
			overrideStyles: {
				listFocusBackground: styles.listBackground,
				listInactiveFocusBackground: styles.listBackground,
				listActiveSelectionBackground: styles.listBackground,
				listFocusAndSelectionBackground: styles.listBackground,
				listInactiveSelectionBackground: styles.listBackground,
				listHoverBackground: styles.listBackground,
				listBackground: styles.listBackground,
				listFocusForeground: styles.listForeground,
				listHoverForeground: styles.listForeground,
				listInactiveFocusForeground: styles.listForeground,
				listInactiveSelectionForeground: styles.listForeground,
				listActiveSelectionForeground: styles.listForeground,
				listFocusAndSelectionForeground: styles.listForeground,
				listActiveSelectionIconForeground: undefined,
				listInactiveSelectionIconForeground: undefined,
				treeStickyScrollBackground: styles.listBackground,
				treeStickyScrollBorder: undefined,
				treeStickyScrollShadow: styles.listShadow,
			}
		});
	}

	setVisible(visible: boolean): void {
		this._visible = visible;
		this._renderer.setVisible(visible);
	}

	layout(height: number, width: number): void {
		this._tree.layout(height, width);
		this._renderer.layout(width ?? this._container.clientWidth);
		this._tree.refreshStickyScroll();
	}


}
