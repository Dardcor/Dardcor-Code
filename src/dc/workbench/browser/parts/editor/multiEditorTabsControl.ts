/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/multieditortabscontrol.css';
import { isLinux, isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { shorten } from '../../../../base/common/labels.js';
import { EditorResourceAccessor, Verbosity, IEditorPartOptions, SideBySideEditor, DEFAULT_EDITOR_ASSOCIATION, EditorInputCapabilities, IUntypedEditorInput, preventEditorClose, EditorCloseMethod, EditorsOrder, IToolbarActions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { computeEditorAriaLabel } from '../../editor.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { EventType as TouchEventType, GestureEvent, Gesture } from '../../../../base/browser/touch.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { toAction } from '../../../../base/common/actions.js';
import { ResourceLabels, IResourceLabel, DEFAULT_LABELS_CONTAINER } from '../../labels.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { DropdownMenuActionViewItem } from '../../../../base/browser/ui/dropdown/dropdownActionViewItem.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { getFlatActionBarActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { EditorCommandsContextActionRunner, EditorTabsControl } from './editorTabsControl.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IDisposable, dispose, DisposableStore, combinedDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { getOrSet } from '../../../../base/common/map.js';
import { IThemeService, registerThemingParticipant } from '../../../../platform/theme/common/themeService.js';
import { TAB_INACTIVE_BACKGROUND, TAB_ACTIVE_BACKGROUND, TAB_BORDER, EDITOR_DRAG_AND_DROP_BACKGROUND, TAB_UNFOCUSED_ACTIVE_BACKGROUND, TAB_UNFOCUSED_ACTIVE_BORDER, TAB_ACTIVE_BORDER, TAB_HOVER_BACKGROUND, TAB_HOVER_BORDER, TAB_UNFOCUSED_HOVER_BACKGROUND, TAB_UNFOCUSED_HOVER_BORDER, EDITOR_GROUP_HEADER_TABS_BACKGROUND, WORKBENCH_BACKGROUND, TAB_ACTIVE_BORDER_TOP, TAB_UNFOCUSED_ACTIVE_BORDER_TOP, TAB_ACTIVE_MODIFIED_BORDER, TAB_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_BACKGROUND, TAB_HOVER_FOREGROUND, TAB_UNFOCUSED_HOVER_FOREGROUND, EDITOR_GROUP_HEADER_TABS_BORDER, TAB_LAST_PINNED_BORDER, TAB_SELECTED_BORDER_TOP } from '../../../common/theme.js';
import { activeContrastBorder, contrastBorder, editorBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { ResourcesDropHandler, DraggedEditorIdentifier, DraggedEditorGroupIdentifier, extractTreeDropData, isWindowDraggedOver } from '../../dnd.js';
import { Color } from '../../../../base/common/color.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { MergeGroupMode, IMergeGroupOptions } from '../../../services/editor/common/editorGroupsService.js';
import { addDisposableListener, EventType, EventHelper, Dimension, scheduleAtNextAnimationFrame, findParentWithClass, clearNode, DragAndDropObserver, isMouseEvent, getWindow, $ } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { IEditorGroupMenuIds, IEditorGroupsView, EditorServiceImpl, IEditorGroupView, IInternalEditorOpenOptions, IEditorPartsView, prepareMoveCopyEditors } from './editor.js';
import { CloseEditorTabAction, UnpinEditorAction } from './editorActions.js';
import { assertReturnsAllDefined, assertReturnsDefined } from '../../../../base/common/types.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { basenameOrAuthority } from '../../../../base/common/resources.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IPath, win32, posix } from '../../../../base/common/path.js';
import { coalesce, insert } from '../../../../base/common/arrays.js';
import { isHighContrast } from '../../../../platform/theme/common/theme.js';
import { isSafari } from '../../../../base/browser/browser.js';
import { equals } from '../../../../base/common/objects.js';
import { EditorActivation, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { UNLOCK_GROUP_COMMAND_ID } from './editorCommands.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { ITreeViewsDnDService } from '../../../../editor/common/services/treeViewsDndService.js';
import { DraggedTreeItemsIdentifier } from '../../../../editor/common/services/treeViewsDnd.js';
import { IEditorResolverService } from '../../../services/editor/common/editorResolverService.js';
import { IEditorTitleControlDimensions } from './editorTitleControl.js';
import { StickyEditorGroupModel, UnstickyEditorGroupModel } from '../../../common/editor/filteredEditorGroupModel.js';
import { IReadonlyEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { BugIndicatingError } from '../../../../base/common/errors.js';
import { applyDragImage } from '../../../../base/browser/ui/dnd/dnd.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

interface IEditorInputLabel {
	readonly editor: EditorInput;

	readonly name?: string;
	description?: string;
	readonly forceDescription?: boolean;
	readonly title?: string;
	readonly ariaLabel?: string;
}

interface IMultiEditorTabsControlLayoutOptions {

	readonly forceRevealActiveTab?: true;
}

interface IScheduledMultiEditorTabsControlLayout extends IDisposable {

	options?: IMultiEditorTabsControlLayoutOptions;
}

export class MultiEditorTabsControl extends EditorTabsControl {

	private static readonly SCROLLBAR_SIZES = {
		default: 3 as const,
		large: 10 as const
	};

	private static readonly TAB_WIDTH = {
		compact: 38 as const,
		shrink: 80 as const,
		fit: 120 as const
	};
	private static readonly MODERN_UI_COMPACT_PINNED_TAB_WIDTH = 28 as const;

	private static readonly DRAG_OVER_OPEN_TAB_THRESHOLD = 1500;

	private static readonly MOUSE_WHEEL_EVENT_THRESHOLD = 150;
	private static readonly MOUSE_WHEEL_DISTANCE_THRESHOLD = 1.5;

	private titleContainer: HTMLElement | undefined;
	private tabsAndActionsContainer: HTMLElement | undefined;
	private stickyTabsBackground: HTMLElement | undefined;
	private tabsContainer: HTMLElement | undefined;
	private tabsScrollbar: ScrollableElement | undefined;
	private addTabContainer: HTMLElement | undefined;
	private tabSizingFixedDisposables: DisposableStore | undefined;

	private readonly closeEditorAction = this._register(this.instantiationService.createInstance(CloseEditorTabAction, CloseEditorTabAction.ID, CloseEditorTabAction.LABEL));
	private readonly unpinEditorAction = this._register(this.instantiationService.createInstance(UnpinEditorAction, UnpinEditorAction.ID, UnpinEditorAction.LABEL));

	private readonly tabResourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
	private tabLabels: IEditorInputLabel[] = [];
	private activeTabLabel: IEditorInputLabel | undefined;

	private tabActionBars: ActionBar[] = [];
	private tabDisposables: IDisposable[] = [];

	private dimensions: IEditorTitleControlDimensions & { used?: Dimension } = {
		container: Dimension.None,
		available: Dimension.None
	};

	private readonly layoutScheduler = this._register(new MutableDisposable<IScheduledMultiEditorTabsControlLayout>());
	private blockRevealActiveTab: boolean | undefined;

	private path: IPath = isWindows ? win32 : posix;

	private lastMouseWheelEventTime = 0;
	private isMouseOverTabs = false;

	constructor(
		parent: HTMLElement,
		editorPartsView: IEditorPartsView,
		groupsView: IEditorGroupsView,
		groupView: IEditorGroupView,
		tabsModel: IReadonlyEditorGroupModel,
		menuIds: IEditorGroupMenuIds | undefined,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IThemeService themeService: IThemeService,
		@IEditorService private readonly editorService: EditorServiceImpl,
		@IPathService private readonly pathService: IPathService,
		@ITreeViewsDnDService private readonly treeViewsDragAndDropService: ITreeViewsDnDService,
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IHostService hostService: IHostService,
		@IMenuService menuService: IMenuService,
	) {
		super(parent, editorPartsView, groupsView, groupView, tabsModel, menuIds, contextMenuService, instantiationService, contextKeyService, keybindingService, notificationService, quickInputService, themeService, editorResolverService, hostService, menuService);

		(async () => this.path = await this.pathService.path)();

		this._register(this.tabResourceLabels.onDidChangeDecorations(() => this.doHandleDecorationsChange()));
	}

	protected override create(parent: HTMLElement): HTMLElement {
		super.create(parent);

		this.titleContainer = parent;

		this.tabsAndActionsContainer = $('.tabs-and-actions-container');
		this.titleContainer.appendChild(this.tabsAndActionsContainer);

		this.stickyTabsBackground = $('.sticky-tabs-background', { 'aria-hidden': true });

		this.tabsContainer = $('.tabs-container', {
			role: 'tablist',
			'aria-multiselectable': 'true',
			draggable: true
		});
		this._register(Gesture.addTarget(this.tabsContainer));

		this.tabSizingFixedDisposables = this._register(new DisposableStore());
		this.updateTabSizing(false);

		this.tabsScrollbar = this.createTabsScrollbar(this.tabsContainer);
		this.tabsAndActionsContainer.appendChild(this.tabsScrollbar.getDomNode());
		this.tabsScrollbar.getDomNode().appendChild(this.stickyTabsBackground);

		this.registerTabsContainerListeners(this.tabsContainer, this.tabsScrollbar);

		if (this.menuIds?.tabsBarAddTab) {
			this.createAddTabControl(this.menuIds.tabsBarAddTab);
		}

		this.createEditorActionsToolBar(this.tabsAndActionsContainer, ['editor-actions']);

		this.updateTabsControlVisibility();

		return this.tabsAndActionsContainer;
	}

	private createAddTabControl(menuId: MenuId): void {
		const tabsContainer = assertReturnsDefined(this.tabsContainer);
		const container = $('.tabs-bar-add-tab');
		tabsContainer.appendChild(container);
		this.addTabContainer = container;

		const menu = this._register(this.menuService.createMenu(menuId, this.contextKeyService));
		const getActions = () => getFlatActionBarActions(menu.getActions({ shouldForwardArgs: true }));

		const addTabAction = toAction({
			id: 'editor.tabs.addTab',
			label: localize('addTab', "Add Tab"),
			class: ThemeIcon.asClassName(Codicon.add),
			run: () => { }
		});

		const dropdown = this._register(new DropdownMenuActionViewItem(addTabAction, { getActions }, this.contextMenuService, {
			classNames: ThemeIcon.asClassNameArray(Codicon.add),
			keybindingProvider: action => this.getKeybinding(action)
		}));
		dropdown.render(container);

		const updateVisibility = () => this.addTabContainer?.classList.toggle('hidden', getActions().length === 0);
		updateVisibility();
		this._register(menu.onDidChange(() => updateVisibility()));
	}

	private get tabCount(): number {
		const tabsContainer = assertReturnsDefined(this.tabsContainer);
		return this.addTabContainer ? tabsContainer.children.length - 1 : tabsContainer.children.length;
	}

	private appendTab(tab: HTMLElement, tabsContainer: HTMLElement): void {
		if (this.addTabContainer) {
			tabsContainer.insertBefore(tab, this.addTabContainer);
		} else {
			tabsContainer.appendChild(tab);
		}
	}

	private removeLastTab(tabsContainer: HTMLElement): void {
		if (this.addTabContainer) {
			this.addTabContainer.previousElementSibling?.remove();
		} else {
			tabsContainer.lastChild?.remove();
		}
	}

	private createTabsScrollbar(scrollable: HTMLElement): ScrollableElement {
		const tabsScrollbar = this._register(new ScrollableElement(scrollable, {
			horizontal: this.getTabsScrollbarVisibility(),
			horizontalScrollbarSize: this.getTabsScrollbarSizing(),
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false
		}));

		this._register(tabsScrollbar.onScroll(e => {
			if (e.scrollLeftChanged) {
				scrollable.scrollLeft = e.scrollLeft;
			}
		}));

		return tabsScrollbar;
	}

	private updateTabsScrollbarSizing(): void {
		this.tabsScrollbar?.updateOptions({
			horizontalScrollbarSize: this.getTabsScrollbarSizing()
		});
	}

	private updateTabsScrollbarVisibility(): void {
		this.tabsScrollbar?.updateOptions({
			horizontal: this.getTabsScrollbarVisibility()
		});
	}

	private updateTabSizing(fromEvent: boolean): void {
		const [tabsContainer, tabSizingFixedDisposables] = assertReturnsAllDefined(this.tabsContainer, this.tabSizingFixedDisposables);

		tabSizingFixedDisposables.clear();

		const options = this.groupsView.partOptions;
		if (options.tabSizing === 'fixed') {
			tabsContainer.style.setProperty('--tab-sizing-fixed-min-width', `${options.tabSizingFixedMinWidth}px`);
			tabsContainer.style.setProperty('--tab-sizing-fixed-max-width', `${options.tabSizingFixedMaxWidth}px`);


			tabSizingFixedDisposables.add(addDisposableListener(tabsContainer, EventType.MOUSE_ENTER, () => {
				this.isMouseOverTabs = true;
			}));
			tabSizingFixedDisposables.add(addDisposableListener(tabsContainer, EventType.MOUSE_LEAVE, () => {
				this.isMouseOverTabs = false;
				this.updateTabsFixedWidth(false);
			}));
		} else if (fromEvent) {
			tabsContainer.style.removeProperty('--tab-sizing-fixed-min-width');
			tabsContainer.style.removeProperty('--tab-sizing-fixed-max-width');
			this.updateTabsFixedWidth(false);
		}
	}

	private updateTabsFixedWidth(fixed: boolean): void {
		this.forEachTab((editor, tabIndex, tabContainer) => {
			if (fixed) {
				const { width } = tabContainer.getBoundingClientRect();
				tabContainer.style.setProperty('--tab-sizing-current-width', `${width}px`);
			} else {
				tabContainer.style.removeProperty('--tab-sizing-current-width');
			}
		});
	}

	private getTabsScrollbarSizing(): number {
		if (this.groupsView.partOptions.titleScrollbarSizing !== 'large') {
			return MultiEditorTabsControl.SCROLLBAR_SIZES.default;
		}

		return MultiEditorTabsControl.SCROLLBAR_SIZES.large;
	}

	private getTabsScrollbarVisibility(): ScrollbarVisibility {
		switch (this.groupsView.partOptions.titleScrollbarVisibility) {
			case 'visible': return ScrollbarVisibility.Visible;
			case 'hidden': return ScrollbarVisibility.Hidden;
			default: return ScrollbarVisibility.Auto;
		}
	}

	private registerTabsContainerListeners(tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): void {

		this._register(addDisposableListener(tabsContainer, EventType.SCROLL, () => {
			if (tabsContainer.classList.contains('scroll')) {
				tabsScrollbar.setScrollPosition({
					scrollLeft: tabsContainer.scrollLeft
				});
			}
		}));

		for (const eventType of [TouchEventType.Tap, EventType.DBLCLICK]) {
			this._register(addDisposableListener(tabsContainer, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					if (e.target !== tabsContainer) {
						return;
					}
				} else {
					if ((<GestureEvent>e).tapCount !== 2) {
						return;
					}

					if ((<GestureEvent>e).initialTarget !== tabsContainer) {
						return;
					}
				}

				EventHelper.stop(e);

				this.editorService.openEditor({
					resource: undefined,
					options: {
						pinned: true,
						index: this.groupView.count,
						override: DEFAULT_EDITOR_ASSOCIATION.id
					}
				}, this.groupView.id);
			}));
		}

		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_DOWN, e => {
			if (e.button === 1) {
				e.preventDefault();
			}
		}));

		if (isLinux) {
			this._register(addDisposableListener(tabsContainer, EventType.MOUSE_UP, e => {
				if (e.button === 1) {
					e.preventDefault();
				}
			}));
		}

		let lastDragEvent: DragEvent | undefined = undefined;
		let isNewWindowOperation = false;
		this._register(new DragAndDropObserver(tabsContainer, {
			onDragStart: e => {
				isNewWindowOperation = this.onGroupDragStart(e, tabsContainer);
			},

			onDrag: e => {
				lastDragEvent = e;
			},

			onDragEnter: e => {

				tabsContainer.classList.add('scroll');

				if (e.target !== tabsContainer) {
					return;
				}

				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				if (!this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tabsContainer, true, e);
			},

			onDragLeave: e => {
				this.updateDropFeedback(tabsContainer, false, e);
				tabsContainer.classList.remove('scroll');
			},

			onDragEnd: e => {
				this.updateDropFeedback(tabsContainer, false, e);
				tabsContainer.classList.remove('scroll');

				this.onGroupDragEnd(e, lastDragEvent, tabsContainer, isNewWindowOperation);
			},

			onDrop: e => {
				this.updateDropFeedback(tabsContainer, false, e);
				tabsContainer.classList.remove('scroll');

				if (e.target === tabsContainer) {
					const isGroupTransfer = this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype);
					this.onDrop(e, isGroupTransfer ? this.groupView.count : this.tabsModel.count, tabsContainer);
				}
			}
		}));

		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_WHEEL, (e: WheelEvent) => {
			const activeEditor = this.groupView.activeEditor;
			if (!activeEditor || this.groupView.count < 2) {
				return;
			}

			if (this.groupsView.partOptions.scrollToSwitchTabs === true) {
				if (e.shiftKey) {
					return;
				}
			} else {
				if (!e.shiftKey) {
					return;
				}
			}

			const now = Date.now();
			if (now - this.lastMouseWheelEventTime < MultiEditorTabsControl.MOUSE_WHEEL_EVENT_THRESHOLD - 2 * (Math.abs(e.deltaX) + Math.abs(e.deltaY))) {
				return;
			}

			this.lastMouseWheelEventTime = now;

			let tabSwitchDirection: number;
			if (e.deltaX + e.deltaY < - MultiEditorTabsControl.MOUSE_WHEEL_DISTANCE_THRESHOLD) {
				tabSwitchDirection = -1;
			} else if (e.deltaX + e.deltaY > MultiEditorTabsControl.MOUSE_WHEEL_DISTANCE_THRESHOLD) {
				tabSwitchDirection = 1;
			} else {
				return;
			}

			const nextEditor = this.groupView.getEditorByIndex(this.groupView.getIndexOfEditor(activeEditor) + tabSwitchDirection);
			if (!nextEditor) {
				return;
			}

			this.groupView.openEditor(nextEditor);

			EventHelper.stop(e, true);
		}));

		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			let anchor: HTMLElement | StandardMouseEvent = tabsContainer;
			if (isMouseEvent(e)) {
				anchor = new StandardMouseEvent(getWindow(this.parent), e);
			}

			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				menuId: this.menuIds?.tabsBarContext ?? MenuId.EditorTabsBarContext,
				contextKeyService: this.contextKeyService,
				menuActionOptions: { shouldForwardArgs: true },
				getActionsContext: () => ({ groupId: this.groupView.id }),
				getKeyBinding: action => this.getKeybinding(action),
				onHide: () => this.groupView.focus()
			});
		};

		this._register(addDisposableListener(tabsContainer, TouchEventType.Contextmenu, e => showContextMenu(e)));
		this._register(addDisposableListener(tabsContainer, EventType.CONTEXT_MENU, e => showContextMenu(e)));
	}

	private doHandleDecorationsChange(): void {

		this.layout(this.dimensions);
	}

	protected override updateEditorActionsToolbar(): void {
		super.updateEditorActionsToolbar();

		this.layout(this.dimensions);
	}

	openEditor(editor: EditorInput, options?: IInternalEditorOpenOptions): boolean {
		const changed = this.handleOpenedEditors();

		if (options?.focusTabControl) {
			this.withTab(editor, (editor, tabIndex, tabContainer) => tabContainer.focus());
		}

		return changed;
	}

	openEditors(editors: EditorInput[]): boolean {
		return this.handleOpenedEditors();
	}

	private handleOpenedEditors(): boolean {

		this.updateTabsControlVisibility();

		const [tabsContainer, tabsScrollbar] = assertReturnsAllDefined(this.tabsContainer, this.tabsScrollbar);
		for (let i = this.tabCount; i < this.tabsModel.count; i++) {
			this.appendTab(this.createTab(i, tabsContainer, tabsScrollbar), tabsContainer);
		}


		const activeEditorChanged = this.didActiveEditorChange();
		const oldTabLabels = this.tabLabels;
		this.computeTabLabels();

		let didChange = false;
		if (
			activeEditorChanged ||
			oldTabLabels.length !== this.tabLabels.length ||
			oldTabLabels.some((label, index) => !this.equalsEditorInputLabel(label, this.tabLabels.at(index)))
		) {
			this.redraw({ forceRevealActiveTab: true });
			didChange = true;
		}

		else {
			this.layout(this.dimensions, { forceRevealActiveTab: true });
		}

		return didChange;
	}

	private didActiveEditorChange(): boolean {
		if (
			!this.activeTabLabel?.editor && this.tabsModel.activeEditor ||
			this.activeTabLabel?.editor && !this.tabsModel.activeEditor ||
			(!this.activeTabLabel?.editor || !this.tabsModel.isActive(this.activeTabLabel.editor))
		) {
			return true;
		}

		return false;
	}

	private equalsEditorInputLabel(labelA: IEditorInputLabel | undefined, labelB: IEditorInputLabel | undefined): boolean {
		if (labelA === labelB) {
			return true;
		}

		if (!labelA || !labelB) {
			return false;
		}

		return labelA.name === labelB.name &&
			labelA.description === labelB.description &&
			labelA.forceDescription === labelB.forceDescription &&
			labelA.title === labelB.title &&
			labelA.ariaLabel === labelB.ariaLabel;
	}

	beforeCloseEditor(editor: EditorInput): void {


		if (this.isMouseOverTabs && this.groupsView.partOptions.tabSizing === 'fixed') {
			const closingLastTab = this.tabsModel.isLast(editor);
			this.updateTabsFixedWidth(!closingLastTab);
		}
	}

	closeEditor(editor: EditorInput): void {
		this.handleClosedEditors();
	}

	closeEditors(editors: EditorInput[]): void {
		this.handleClosedEditors();
	}

	private handleClosedEditors(): void {

		if (this.tabsModel.count) {

			const tabsContainer = assertReturnsDefined(this.tabsContainer);
			while (this.tabCount > this.tabsModel.count) {

				this.removeLastTab(tabsContainer);

				dispose(this.tabDisposables.pop());
			}

			this.computeTabLabels();

			this.redraw({ forceRevealActiveTab: true });
		}

		else {
			if (this.tabsContainer) {
				clearNode(this.tabsContainer);
				if (this.addTabContainer) {
					this.tabsContainer.appendChild(this.addTabContainer);
				}
			}

			this.tabDisposables = dispose(this.tabDisposables);
			this.tabResourceLabels.clear();
			this.tabLabels = [];
			this.activeTabLabel = undefined;
			this.tabActionBars = [];

			this.clearEditorActionsToolbar();
			this.updateTabsControlVisibility();
		}
	}

	moveEditor(editor: EditorInput, fromTabIndex: number, targetTabIndex: number): void {

		const editorLabel = this.tabLabels[fromTabIndex];
		this.tabLabels.splice(fromTabIndex, 1);
		this.tabLabels.splice(targetTabIndex, 0, editorLabel);

		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTab(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		},
			Math.min(fromTabIndex, targetTabIndex),
			Math.max(fromTabIndex, targetTabIndex)
		);

		this.layout(this.dimensions, { forceRevealActiveTab: true });
	}

	pinEditor(editor: EditorInput): void {
		this.withTab(editor, (editor, tabIndex, tabContainer, tabLabelWidget, tabLabel) => this.redrawTabLabel(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel));
	}

	stickEditor(editor: EditorInput): void {
		this.doHandleStickyEditorChange(editor);
	}

	unstickEditor(editor: EditorInput): void {
		this.doHandleStickyEditorChange(editor);
	}

	private doHandleStickyEditorChange(editor: EditorInput): void {

		this.withTab(editor, (editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.redrawTab(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar));

		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabBorders(tabIndex, tabContainer);
		});

		this.layout(this.dimensions, { forceRevealActiveTab: true });
	}

	setActive(isGroupActive: boolean): void {

		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTabSelectedActiveAndDirty(isGroupActive, editor, tabContainer, tabActionBar);
		});

		this.updateEditorActionsToolbar();
		this.layout(this.dimensions, { forceRevealActiveTab: true });
	}

	updateEditorSelections(): void {
		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTabSelectedActiveAndDirty(this.groupsView.activeGroup === this.groupView, editor, tabContainer, tabActionBar);
		});
	}

	private updateEditorLabelScheduler = this._register(new RunOnceScheduler(() => this.doUpdateEditorLabels(), 0));

	updateEditorLabel(editor: EditorInput): void {

		this.updateEditorLabelScheduler.schedule();
	}

	private doUpdateEditorLabels(): void {

		this.computeTabLabels();

		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabLabel(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel);
		});

		this.layout(this.dimensions);
	}

	updateEditorDirty(editor: EditorInput): void {
		this.withTab(editor, (editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.redrawTabSelectedActiveAndDirty(this.groupsView.activeGroup === this.groupView, editor, tabContainer, tabActionBar));
	}

	updateEditorCapabilities(editor: EditorInput): void {
		this.withTab(editor, (editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.redrawTab(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar));
	}

	override updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {
		super.updateOptions(oldOptions, newOptions);

		if (oldOptions.labelFormat !== newOptions.labelFormat) {
			this.computeTabLabels();
		}

		if (oldOptions.titleScrollbarSizing !== newOptions.titleScrollbarSizing) {
			this.updateTabsScrollbarSizing();
		}

		if (oldOptions.titleScrollbarVisibility !== newOptions.titleScrollbarVisibility) {
			this.updateTabsScrollbarVisibility();
		}

		if (oldOptions.alwaysShowEditorActions !== newOptions.alwaysShowEditorActions) {
			this.updateEditorActionsToolbar();
		}

		if (
			oldOptions.tabSizingFixedMinWidth !== newOptions.tabSizingFixedMinWidth ||
			oldOptions.tabSizingFixedMaxWidth !== newOptions.tabSizingFixedMaxWidth ||
			oldOptions.tabSizing !== newOptions.tabSizing
		) {
			this.updateTabSizing(true);
		}

		if (
			oldOptions.labelFormat !== newOptions.labelFormat ||
			oldOptions.tabActionLocation !== newOptions.tabActionLocation ||
			oldOptions.tabActionCloseVisibility !== newOptions.tabActionCloseVisibility ||
			oldOptions.tabActionUnpinVisibility !== newOptions.tabActionUnpinVisibility ||
			oldOptions.tabSizing !== newOptions.tabSizing ||
			oldOptions.pinnedTabSizing !== newOptions.pinnedTabSizing ||
			oldOptions.showIcons !== newOptions.showIcons ||
			oldOptions.hasIcons !== newOptions.hasIcons ||
			oldOptions.highlightModifiedTabs !== newOptions.highlightModifiedTabs ||
			oldOptions.wrapTabs !== newOptions.wrapTabs ||
			oldOptions.showTabIndex !== newOptions.showTabIndex ||
			!equals(oldOptions.decorations, newOptions.decorations)
		) {
			this.redraw();
		}
	}

	override updateStyles(): void {
		this.redraw();
	}

	private forEachTab(fn: (editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void, fromTabIndex?: number, toTabIndex?: number): void {
		this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).forEach((editor: EditorInput, tabIndex: number) => {
			if (typeof fromTabIndex === 'number' && fromTabIndex > tabIndex) {
				return;
			}

			if (typeof toTabIndex === 'number' && toTabIndex < tabIndex) {
				return;
			}

			this.doWithTab(tabIndex, editor, fn);
		});
	}

	private withTab(editor: EditorInput, fn: (editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		this.doWithTab(this.tabsModel.indexOf(editor), editor, fn);
	}

	private doWithTab(tabIndex: number, editor: EditorInput, fn: (editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		const tabsContainer = assertReturnsDefined(this.tabsContainer);
		const tabContainer = tabsContainer.children[tabIndex] as HTMLElement;
		const tabResourceLabel = this.tabResourceLabels.get(tabIndex);
		const tabLabel = this.tabLabels[tabIndex];
		const tabActionBar = this.tabActionBars[tabIndex];
		if (tabContainer && tabResourceLabel && tabLabel) {
			fn(editor, tabIndex, tabContainer, tabResourceLabel, tabLabel, tabActionBar);
		}
	}

	private createTab(tabIndex: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): HTMLElement {

		const tabContainer = $('.tab', {
			draggable: true,
			role: 'tab'
		});

		const gestureDisposable = Gesture.addTarget(tabContainer);

		const tabFillContainer = $('.tab-fill', { 'aria-hidden': true });
		tabContainer.appendChild(tabFillContainer);

		const tabBorderTopContainer = $('.tab-border-top-container');
		tabContainer.appendChild(tabBorderTopContainer);

		const editorLabel = this.tabResourceLabels.create(tabContainer, { hoverTargetOverride: tabContainer });

		const tabActionsContainer = $('.tab-actions');
		tabContainer.appendChild(tabActionsContainer);

		const that = this;
		const tabActionRunner = new EditorCommandsContextActionRunner({
			groupId: this.groupView.id,
			get editorIndex() { return that.toEditorIndex(tabIndex); }
		});

		const tabActionBar = new ActionBar(tabActionsContainer, { ariaLabel: localize('ariaLabelTabActions', "Tab actions"), actionRunner: tabActionRunner });
		const tabActionListener = tabActionBar.onWillRun(e => {
			if (e.action.id === this.closeEditorAction.id) {
				this.blockRevealActiveTabOnce();
			}
		});

		const tabActionBarDisposable = combinedDisposable(tabActionRunner, tabActionBar, tabActionListener, toDisposable(insert(this.tabActionBars, tabActionBar)));

		const tabShadowHider = $('.tab-fade-hider');
		tabContainer.appendChild(tabShadowHider);

		const tabBorderBottomContainer = $('.tab-border-bottom-container');
		tabContainer.appendChild(tabBorderBottomContainer);

		const eventsDisposable = this.registerTabListeners(tabContainer, tabIndex, tabsContainer, tabsScrollbar);

		this.tabDisposables.push(combinedDisposable(gestureDisposable, eventsDisposable, tabActionBarDisposable, editorLabel));

		return tabContainer;
	}

	private toEditorIndex(tabIndex: number): number {


		const editor = assertReturnsDefined(this.tabsModel.getEditorByIndex(tabIndex));

		return this.groupView.getIndexOfEditor(editor);
	}

	private lastSingleSelectSelectedEditor: EditorInput | undefined;
	private registerTabListeners(tab: HTMLElement, tabIndex: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): IDisposable {
		const disposables = new DisposableStore();

		const handleClickOrTouch = async (e: MouseEvent | GestureEvent, preserveFocus: boolean): Promise<void> => {
			tab.blur();

			if (isMouseEvent(e) && (e.button !== 0 || (isMacintosh && e.ctrlKey ))) {
				if (e.button === 1) {
					e.preventDefault();
				}

				return;
			}

			if (this.originatesFromTabActionBar(e)) {
				return;
			}

			const editor = this.tabsModel.getEditorByIndex(tabIndex);
			if (editor) {
				if (e.shiftKey) {
					let anchor: EditorInput;
					if (this.lastSingleSelectSelectedEditor && this.tabsModel.isSelected(this.lastSingleSelectSelectedEditor)) {
						anchor = this.lastSingleSelectSelectedEditor;
					} else {
						const activeEditor = assertReturnsDefined(this.groupView.activeEditor);
						this.lastSingleSelectSelectedEditor = activeEditor;
						anchor = activeEditor;
					}
					await this.selectEditorsBetween(editor, anchor);
				} else if ((e.ctrlKey && !isMacintosh) || (e.metaKey && isMacintosh)) {
					if (this.tabsModel.isSelected(editor)) {
						await this.unselectEditor(editor);
					} else {
						await this.selectEditor(editor);
						this.lastSingleSelectSelectedEditor = editor;
					}
				} else {
					const inactiveSelection = this.tabsModel.isSelected(editor) ? this.groupView.selectedEditors.filter(e => !e.matches(editor)) : [];
					await this.groupView.openEditor(editor, { preserveFocus, activation: EditorActivation.ACTIVATE }, { inactiveSelection, focusTabControl: true });
				}
			}
		};

		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			const editor = this.tabsModel.getEditorByIndex(tabIndex);
			if (editor) {
				this.onTabContextMenu(editor, e, tab);
			}
		};

		disposables.add(addDisposableListener(tab, EventType.MOUSE_DOWN, e => handleClickOrTouch(e, false)));
		disposables.add(addDisposableListener(tab, TouchEventType.Tap, (e: GestureEvent) => handleClickOrTouch(e, true)));

		disposables.add(addDisposableListener(tab, TouchEventType.Change, (e: GestureEvent) => {
			tabsScrollbar.setScrollPosition({ scrollLeft: tabsScrollbar.getScrollPosition().scrollLeft - e.translationX });
		}));

		disposables.add(addDisposableListener(tab, EventType.MOUSE_UP, async e => {
			EventHelper.stop(e);

			tab.blur();

			if (isMouseEvent(e) && (e.button !== 0 || (isMacintosh && e.ctrlKey ))) {
				return;
			}

			if (this.originatesFromTabActionBar(e)) {
				return;
			}

			const isCtrlCmd = (e.ctrlKey && !isMacintosh) || (e.metaKey && isMacintosh);
			if (!isCtrlCmd && !e.shiftKey && this.groupView.selectedEditors.length > 1) {
				await this.unselectAllEditors();
			}
		}));

		disposables.add(addDisposableListener(tab, EventType.AUXCLICK, e => {
			if (e.button === 1 ) {
				EventHelper.stop(e, true );

				const editor = this.tabsModel.getEditorByIndex(tabIndex);
				if (editor) {
					if (editor.hasCapability(EditorInputCapabilities.CannotClose) || preventEditorClose(this.tabsModel, editor, EditorCloseMethod.MOUSE, this.groupsView.partOptions)) {
						return;
					}

					this.blockRevealActiveTabOnce();
					this.closeEditorAction.run({ groupId: this.groupView.id, editorIndex: this.groupView.getIndexOfEditor(editor) });
				}
			}
		}));

		disposables.add(addDisposableListener(tab, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.shiftKey && event.keyCode === KeyCode.F10) {
				showContextMenu(e);
			}
		}));

		disposables.add(addDisposableListener(tab, TouchEventType.Contextmenu, (e: GestureEvent) => {
			showContextMenu(e);
		}));

		disposables.add(addDisposableListener(tab, EventType.KEY_UP, e => {
			const event = new StandardKeyboardEvent(e);
			let handled = false;

			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				handled = true;
				const editor = this.tabsModel.getEditorByIndex(tabIndex);
				if (editor) {
					this.groupView.openEditor(editor);
				}
			}

			else if ([KeyCode.LeftArrow, KeyCode.RightArrow, KeyCode.UpArrow, KeyCode.DownArrow, KeyCode.Home, KeyCode.End].some(kb => event.equals(kb))) {
				let editorIndex = this.toEditorIndex(tabIndex);
				if (event.equals(KeyCode.LeftArrow) || event.equals(KeyCode.UpArrow)) {
					editorIndex = editorIndex - 1;
				} else if (event.equals(KeyCode.RightArrow) || event.equals(KeyCode.DownArrow)) {
					editorIndex = editorIndex + 1;
				} else if (event.equals(KeyCode.Home)) {
					editorIndex = 0;
				} else {
					editorIndex = this.groupView.count - 1;
				}

				const target = this.groupView.getEditorByIndex(editorIndex);
				if (target) {
					handled = true;
					this.groupView.openEditor(target, { preserveFocus: true }, { focusTabControl: true });
				}
			}

			if (handled) {
				EventHelper.stop(e, true);
			}

			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainer.scrollLeft
			});
		}));

		for (const eventType of [TouchEventType.Tap, EventType.DBLCLICK]) {
			disposables.add(addDisposableListener(tab, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					EventHelper.stop(e);
				} else if ((<GestureEvent>e).tapCount !== 2) {
					return;
				}

				const editor = this.tabsModel.getEditorByIndex(tabIndex);
				if (editor && this.tabsModel.isPinned(editor)) {
					switch (this.groupsView.partOptions.doubleClickTabToToggleEditorGroupSizes) {
						case 'maximize':
							this.groupsView.toggleMaximizeGroup(this.groupView);
							break;
						case 'expand':
							this.groupsView.toggleExpandGroup(this.groupView);
							break;
						case 'off':
							break;
					}

				} else {
					this.groupView.pinEditor(editor);
				}
			}));
		}

		disposables.add(addDisposableListener(tab, EventType.CONTEXT_MENU, e => {
			EventHelper.stop(e, true);

			const editor = this.tabsModel.getEditorByIndex(tabIndex);
			if (editor) {
				this.onTabContextMenu(editor, e, tab);
			}
		}, true ));

		let lastDragEvent: DragEvent | undefined = undefined;
		let isNewWindowOperation = false;
		disposables.add(new DragAndDropObserver(tab, {
			onDragStart: e => {
				const editor = this.tabsModel.getEditorByIndex(tabIndex);
				if (!editor) {
					return;
				}

				isNewWindowOperation = this.isNewWindowOperation(e);
				const selectedEditors = this.groupView.selectedEditors;
				this.editorTransfer.setData(selectedEditors.map(e => new DraggedEditorIdentifier({ editor: e, groupId: this.groupView.id })), DraggedEditorIdentifier.prototype);

				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'copyMove';
					if (selectedEditors.length > 1) {
						const label = `${editor.getName()} + ${selectedEditors.length - 1}`;
						applyDragImage(e, tab, label);
					} else {
						const options = this.groupsView.partOptions;
						const isTabSticky = this.tabsModel.isSticky(tabIndex);
						const isShrinkSizing = options.tabSizing === 'shrink' || (isTabSticky && options.pinnedTabSizing === 'shrink');
						if (isShrinkSizing) {
							applyDragImage(e, tab, editor.getName());
						} else {
							e.dataTransfer.setDragImage(tab, 0, 0);
						}
					}
				}

				this.doFillResourceDataTransfers(selectedEditors, e, isNewWindowOperation);

				scheduleAtNextAnimationFrame(getWindow(this.parent), () => this.updateDropFeedback(tab, false, e, tabIndex));
			},

			onDrag: e => {
				lastDragEvent = e;
			},

			onDragEnter: e => {

				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				if (!this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tab, true, e, tabIndex);
			},

			onDragOver: (e, dragDuration) => {
				if (dragDuration >= MultiEditorTabsControl.DRAG_OVER_OPEN_TAB_THRESHOLD) {
					const draggedOverTab = this.tabsModel.getEditorByIndex(tabIndex);
					if (draggedOverTab && this.tabsModel.activeEditor !== draggedOverTab) {
						this.groupView.openEditor(draggedOverTab, { preserveFocus: true });
					}
				}

				this.updateDropFeedback(tab, true, e, tabIndex);
			},

			onDragEnd: async e => {
				this.updateDropFeedback(tab, false, e, tabIndex);
				const draggedEditors = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
				this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);

				if (
					!isNewWindowOperation ||
					isWindowDraggedOver() ||
					!draggedEditors ||
					draggedEditors.length === 0
				) {
					return;
				}

				const auxiliaryEditorPart = await this.maybeCreateAuxiliaryEditorPartAt(e, tab);
				if (!auxiliaryEditorPart) {
					return;
				}

				const targetGroup = auxiliaryEditorPart.activeGroup;
				const editorsWithOptions = prepareMoveCopyEditors(this.groupView, draggedEditors.map(editor => editor.identifier.editor));
				if (this.isMoveOperation(lastDragEvent ?? e, targetGroup.id, draggedEditors[0].identifier.editor)) {
					this.groupView.moveEditors(editorsWithOptions, targetGroup);
				} else {
					this.groupView.copyEditors(editorsWithOptions, targetGroup);
				}

				targetGroup.focus();
			},

			onDrop: e => {
				this.updateDropFeedback(tab, false, e, tabIndex);

				let targetIndex = tabIndex;
				if (this.getTabDragOverLocation(e, tab) === 'right') {
					targetIndex++;
				}

				this.onDrop(e, targetIndex, tabsContainer);
			}
		}));

		return disposables;
	}

	private isSupportedDropTransfer(e: DragEvent): boolean {
		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data) && data.length > 0) {
				const group = data[0];
				if (group.identifier === this.groupView.id) {
					return false;
				}
			}

			return true;
		}

		if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			return true;
		}

		if (e.dataTransfer && e.dataTransfer.types.length > 0) {
			return true;
		}

		return false;
	}

	private updateDropFeedback(element: HTMLElement, isDND: boolean, e: DragEvent, tabIndex?: number): void {
		const isTab = (typeof tabIndex === 'number');

		let dropTarget;
		if (isDND) {
			if (isTab) {
				dropTarget = this.computeDropTarget(e, tabIndex, element);
			} else {
				dropTarget = { leftElement: element.lastElementChild as HTMLElement, rightElement: undefined };
			}
		} else {
			dropTarget = undefined;
		}

		this.updateDropTarget(dropTarget);
	}

	private dropTarget: { leftElement: HTMLElement | undefined; rightElement: HTMLElement | undefined } | undefined;
	private updateDropTarget(newTarget: { leftElement: HTMLElement | undefined; rightElement: HTMLElement | undefined } | undefined): void {
		const oldTargets = this.dropTarget;
		if (oldTargets === newTarget || oldTargets && newTarget && oldTargets.leftElement === newTarget.leftElement && oldTargets.rightElement === newTarget.rightElement) {
			return;
		}

		const dropClassLeft = 'drop-target-left';
		const dropClassRight = 'drop-target-right';

		if (oldTargets) {
			oldTargets.leftElement?.classList.remove(dropClassLeft);
			oldTargets.rightElement?.classList.remove(dropClassRight);
		}

		if (newTarget) {
			newTarget.leftElement?.classList.add(dropClassLeft);
			newTarget.rightElement?.classList.add(dropClassRight);
		}

		this.dropTarget = newTarget;
	}

	private getTabDragOverLocation(e: DragEvent, tab: HTMLElement): 'left' | 'right' {
		const rect = tab.getBoundingClientRect();
		const offsetXRelativeToParent = e.clientX - rect.left;

		return offsetXRelativeToParent <= rect.width / 2 ? 'left' : 'right';
	}

	private computeDropTarget(e: DragEvent, tabIndex: number, targetTab: HTMLElement): { leftElement: HTMLElement | undefined; rightElement: HTMLElement | undefined } | undefined {
		const isLeftSideOfTab = this.getTabDragOverLocation(e, targetTab) === 'left';
		const isLastTab = tabIndex === this.tabsModel.count - 1;
		const isFirstTab = tabIndex === 0;

		if (isLeftSideOfTab && isFirstTab) {
			return { leftElement: undefined, rightElement: targetTab };
		}

		if (!isLeftSideOfTab && isLastTab) {
			return { leftElement: targetTab, rightElement: undefined };
		}

		const tabBefore = isLeftSideOfTab ? targetTab.previousElementSibling : targetTab;
		const tabAfter = isLeftSideOfTab ? targetTab : targetTab.nextElementSibling;

		return { leftElement: tabBefore as HTMLElement, rightElement: tabAfter as HTMLElement };
	}

	private async selectEditor(editor: EditorInput): Promise<void> {
		if (this.groupView.isActive(editor)) {
			return;
		}

		await this.groupView.setSelection(editor, this.groupView.selectedEditors);
	}

	private async selectEditorsBetween(target: EditorInput, anchor: EditorInput): Promise<void> {
		const editorIndex = this.groupView.getIndexOfEditor(target);
		if (editorIndex === -1) {
			throw new BugIndicatingError();
		}

		const anchorEditorIndex = this.groupView.getIndexOfEditor(anchor);
		if (anchorEditorIndex === -1) {
			throw new BugIndicatingError();
		}

		let selection = this.groupView.selectedEditors;

		let currentEditorIndex = anchorEditorIndex;
		while (currentEditorIndex >= 0 && currentEditorIndex <= this.groupView.count - 1) {
			currentEditorIndex = anchorEditorIndex < editorIndex ? currentEditorIndex - 1 : currentEditorIndex + 1;

			const currentEditor = this.groupView.getEditorByIndex(currentEditorIndex);
			if (!currentEditor) {
				break;
			}

			if (!this.groupView.isSelected(currentEditor)) {
				break;
			}

			selection = selection.filter(editor => !editor.matches(currentEditor));
		}

		const fromEditorIndex = anchorEditorIndex < editorIndex ? anchorEditorIndex : editorIndex;
		const toEditorIndex = anchorEditorIndex < editorIndex ? editorIndex : anchorEditorIndex;

		const editorsToSelect = this.groupView.getEditors(EditorsOrder.SEQUENTIAL).slice(fromEditorIndex, toEditorIndex + 1);
		for (const editor of editorsToSelect) {
			if (!this.groupView.isSelected(editor)) {
				selection.push(editor);
			}
		}

		const inactiveSelectedEditors = selection.filter(editor => !editor.matches(target));
		await this.groupView.setSelection(target, inactiveSelectedEditors);
	}

	private async unselectEditor(editor: EditorInput): Promise<void> {
		const isUnselectingActiveEditor = this.groupView.isActive(editor);

		if (isUnselectingActiveEditor && this.groupView.selectedEditors.length === 1) {
			return;
		}

		let newActiveEditor = assertReturnsDefined(this.groupView.activeEditor);

		if (isUnselectingActiveEditor) {
			const recentEditors = this.groupView.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);
			for (let i = 1; i < recentEditors.length; i++) {
				const recentEditor = recentEditors[i];
				if (this.groupView.isSelected(recentEditor)) {
					newActiveEditor = recentEditor;
					break;
				}
			}
		}

		const inactiveSelectedEditors = this.groupView.selectedEditors.filter(e => !e.matches(editor) && !e.matches(newActiveEditor));
		await this.groupView.setSelection(newActiveEditor, inactiveSelectedEditors);
	}

	private async unselectAllEditors(): Promise<void> {
		if (this.groupView.selectedEditors.length > 1) {
			const activeEditor = assertReturnsDefined(this.groupView.activeEditor);
			await this.groupView.setSelection(activeEditor, []);
		}
	}

	private computeTabLabels(): void {
		const { labelFormat } = this.groupsView.partOptions;
		const { verbosity, shortenDuplicates } = this.getLabelConfigFlags(labelFormat);

		const labels: IEditorInputLabel[] = [];
		let activeEditorTabIndex = -1;
		this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).forEach((editor: EditorInput, tabIndex: number) => {
			labels.push({
				editor,
				name: editor.getName(),
				description: editor.getDescription(verbosity),
				forceDescription: editor.hasCapability(EditorInputCapabilities.ForceDescription),
				title: editor.getTitle(Verbosity.LONG),
				ariaLabel: computeEditorAriaLabel(editor, tabIndex, this.groupView, this.editorPartsView.count)
			});

			if (editor === this.tabsModel.activeEditor) {
				activeEditorTabIndex = tabIndex;
			}
		});

		if (shortenDuplicates) {
			this.shortenTabLabels(labels);
		}

		this.tabLabels = labels;
		this.activeTabLabel = labels[activeEditorTabIndex];
	}

	private shortenTabLabels(labels: IEditorInputLabel[]): void {

		const mapNameToDuplicates = new Map<string, IEditorInputLabel[]>();
		for (const label of labels) {
			if (typeof label.description === 'string') {
				getOrSet(mapNameToDuplicates, label.name, []).push(label);
			} else {
				label.description = '';
			}
		}

		for (const [, duplicateLabels] of mapNameToDuplicates) {

			if (duplicateLabels.length === 1 && !duplicateLabels[0].forceDescription) {
				duplicateLabels[0].description = '';

				continue;
			}

			const mapDescriptionToDuplicates = new Map<string, IEditorInputLabel[]>();
			for (const duplicateLabel of duplicateLabels) {
				getOrSet(mapDescriptionToDuplicates, duplicateLabel.description, []).push(duplicateLabel);
			}

			let useLongDescriptions = false;
			for (const [, duplicateLabels] of mapDescriptionToDuplicates) {
				if (!useLongDescriptions && duplicateLabels.length > 1) {
					const [first, ...rest] = duplicateLabels.map(({ editor }) => editor.getDescription(Verbosity.LONG));
					useLongDescriptions = rest.some(description => description !== first);
				}
			}

			if (useLongDescriptions) {
				mapDescriptionToDuplicates.clear();
				for (const duplicateLabel of duplicateLabels) {
					duplicateLabel.description = duplicateLabel.editor.getDescription(Verbosity.LONG);
					getOrSet(mapDescriptionToDuplicates, duplicateLabel.description, []).push(duplicateLabel);
				}
			}

			const descriptions: string[] = [];
			for (const [description] of mapDescriptionToDuplicates) {
				descriptions.push(description);
			}

			if (descriptions.length === 1) {
				for (const label of mapDescriptionToDuplicates.get(descriptions[0]) || []) {
					if (!label.forceDescription) {
						label.description = '';
					}
				}

				continue;
			}

			const shortenedDescriptions = shorten(descriptions, this.path.sep);
			descriptions.forEach((description, tabIndex) => {
				for (const label of mapDescriptionToDuplicates.get(description) || []) {
					label.description = shortenedDescriptions[tabIndex];
				}
			});
		}
	}

	private getLabelConfigFlags(value: string | undefined) {
		switch (value) {
			case 'short':
				return { verbosity: Verbosity.SHORT, shortenDuplicates: false };
			case 'medium':
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: false };
			case 'long':
				return { verbosity: Verbosity.LONG, shortenDuplicates: false };
			default:
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: true };
		}
	}

	private redraw(options?: IMultiEditorTabsControlLayoutOptions): void {

		if (this.tabsAndActionsContainer) {
			let tabsContainerBorderColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BORDER);
			if (!tabsContainerBorderColor && isHighContrast(this.theme.type)) {
				tabsContainerBorderColor = this.getColor(TAB_BORDER) || this.getColor(contrastBorder);
			}

			if (tabsContainerBorderColor) {
				this.tabsAndActionsContainer.classList.add('tabs-border-bottom');
				this.tabsAndActionsContainer.style.setProperty('--tabs-border-bottom-color', tabsContainerBorderColor.toString());
			} else {
				this.tabsAndActionsContainer.classList.remove('tabs-border-bottom');
				this.tabsAndActionsContainer.style.removeProperty('--tabs-border-bottom-color');
			}
		}

		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTab(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		});

		this.updateEditorActionsToolbar();

		this.layout(this.dimensions, options);
	}

	private redrawTab(editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar): void {
		const isTabSticky = this.tabsModel.isSticky(tabIndex);
		const isCloseable = !editor.hasCapability(EditorInputCapabilities.CannotClose);
		const options = this.groupsView.partOptions;

		this.redrawTabLabel(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel);

		const hasUnpinAction = isTabSticky && options.tabActionUnpinVisibility;
		const hasCloseAction = isCloseable && !hasUnpinAction && options.tabActionCloseVisibility;
		const hasAction = hasUnpinAction || hasCloseAction;

		let tabAction;
		if (hasAction) {
			tabAction = hasUnpinAction ? this.unpinEditorAction : this.closeEditorAction;
		} else {
			tabAction = isTabSticky ? this.unpinEditorAction : this.closeEditorAction;
		}

		if (!tabActionBar.hasAction(tabAction)) {
			if (!tabActionBar.isEmpty()) {
				tabActionBar.clear();
			}

			tabActionBar.push(tabAction, { icon: true, label: false, keybinding: this.getKeybindingLabel(tabAction) });
		}

		tabContainer.classList.toggle(`pinned-action-off`, isTabSticky && !hasUnpinAction);
		tabContainer.classList.toggle(`close-action-off`, !hasUnpinAction && !hasCloseAction);
		tabContainer.classList.toggle('cannot-close', !isCloseable);

		for (const option of ['left', 'right']) {
			tabContainer.classList.toggle(`tab-actions-${option}`, hasAction && options.tabActionLocation === option);
		}

		const tabSizing = isTabSticky && options.pinnedTabSizing === 'shrink' ? 'shrink' : options.tabSizing;
		for (const option of ['fit', 'shrink', 'fixed']) {
			tabContainer.classList.toggle(`sizing-${option}`, tabSizing === option);
		}

		tabContainer.classList.toggle('has-icon', options.showIcons && options.hasIcons);

		tabContainer.classList.toggle('sticky', isTabSticky);
		for (const option of ['normal', 'compact', 'shrink']) {
			tabContainer.classList.toggle(`sticky-${option}`, isTabSticky && options.pinnedTabSizing === option);
		}

		if (!options.wrapTabs && isTabSticky && options.pinnedTabSizing !== 'normal') {
			tabContainer.style.left = `${tabIndex * this.getStickyTabWidth(options.pinnedTabSizing)}px`;
		} else {
			tabContainer.style.left = 'auto';
		}

		this.redrawTabBorders(tabIndex, tabContainer);

		this.redrawTabSelectedActiveAndDirty(this.groupsView.activeGroup === this.groupView, editor, tabContainer, tabActionBar);
	}

	private redrawTabLabel(editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel): void {
		const options = this.groupsView.partOptions;

		let name: string | undefined;
		let namePrefix: string | undefined;
		let forceLabel = false;
		let fileDecorationBadges = Boolean(options.decorations?.badges);
		const fileDecorationColors = Boolean(options.decorations?.colors);
		let description: string;
		if (options.pinnedTabSizing === 'compact' && this.tabsModel.isSticky(tabIndex)) {
			const isShowingIcons = options.showIcons && options.hasIcons;
			name = isShowingIcons ? '' : tabLabel.name?.charAt(0).toUpperCase();
			description = '';
			forceLabel = true;
			fileDecorationBadges = false;
		} else {
			name = tabLabel.name;
			namePrefix = options.showTabIndex ? `${this.toEditorIndex(tabIndex) + 1}: ` : undefined;
			description = tabLabel.description || '';
		}

		if (tabLabel.ariaLabel) {
			tabContainer.setAttribute('aria-label', tabLabel.ariaLabel);
			tabContainer.setAttribute('aria-description', '');
		}

		tabLabelWidget.setResource(
			{ name, description, resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }) },
			{
				title: this.getHoverTitle(editor),
				extraClasses: coalesce(['tab-label', fileDecorationBadges ? 'tab-label-has-badge' : undefined].concat(editor.getLabelExtraClasses())),
				italic: !this.tabsModel.isPinned(editor),
				forceLabel,
				fileDecorations: {
					colors: fileDecorationColors,
					badges: fileDecorationBadges
				},
				icon: editor.getIcon(),
				hideIcon: options.showIcons === false,
				namePrefix,
			}
		);

		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			tabContainer.setAttribute('data-resource-name', basenameOrAuthority(resource));
		} else {
			tabContainer.removeAttribute('data-resource-name');
		}
	}

	private redrawTabSelectedActiveAndDirty(isGroupActive: boolean, editor: EditorInput, tabContainer: HTMLElement, tabActionBar: ActionBar): void {
		const isTabActive = this.tabsModel.isActive(editor);
		const hasModifiedBorderTop = this.doRedrawTabDirty(isGroupActive, isTabActive, editor, tabContainer);

		this.doRedrawTabActive(isGroupActive, !hasModifiedBorderTop, editor, tabContainer, tabActionBar);
	}

	private doRedrawTabActive(isGroupActive: boolean, allowBorderTop: boolean, editor: EditorInput, tabContainer: HTMLElement, tabActionBar: ActionBar): void {
		const isActive = this.tabsModel.isActive(editor);
		const isSelected = this.tabsModel.isSelected(editor);

		tabContainer.classList.toggle('active', isActive);
		tabContainer.classList.toggle('selected', isSelected);
		tabContainer.classList.toggle('multi-selected', isSelected && this.groupView.selectedEditors.length > 1);
		tabContainer.setAttribute('aria-selected', isSelected ? 'true' : 'false');
		tabContainer.tabIndex = isActive ? 0 : -1;
		tabActionBar.setFocusable(isActive);

		if (isActive) {
			const activeTabBorderColorBottom = this.getColor(isGroupActive ? TAB_ACTIVE_BORDER : TAB_UNFOCUSED_ACTIVE_BORDER);
			tabContainer.classList.toggle('tab-border-bottom', !!activeTabBorderColorBottom);
			tabContainer.style.setProperty('--tab-border-bottom-color', activeTabBorderColorBottom ?? '');
		}

		let tabBorderColorTop: string | null = null;
		if (allowBorderTop) {
			if (isActive) {
				tabBorderColorTop = this.getColor(isGroupActive ? TAB_ACTIVE_BORDER_TOP : TAB_UNFOCUSED_ACTIVE_BORDER_TOP);
			}

			if (tabBorderColorTop === null && isSelected) {
				tabBorderColorTop = this.getColor(TAB_SELECTED_BORDER_TOP);
			}
		}

		tabContainer.classList.toggle('tab-border-top', !!tabBorderColorTop);
		tabContainer.style.setProperty('--tab-border-top-color', tabBorderColorTop ?? '');
	}

	private doRedrawTabDirty(isGroupActive: boolean, isTabActive: boolean, editor: EditorInput, tabContainer: HTMLElement): boolean {
		let hasModifiedBorderColor = false;

		if (editor.isDirty() && !editor.isSaving()) {
			tabContainer.classList.add('dirty');

			if (this.groupsView.partOptions.highlightModifiedTabs) {
				let modifiedBorderColor: string | null;
				if (isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_ACTIVE_MODIFIED_BORDER);
				} else if (isGroupActive && !isTabActive) {
					modifiedBorderColor = this.getColor(TAB_INACTIVE_MODIFIED_BORDER);
				} else if (!isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER);
				} else {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER);
				}

				if (modifiedBorderColor) {
					hasModifiedBorderColor = true;

					tabContainer.classList.add('dirty-border-top');
					tabContainer.style.setProperty('--tab-dirty-border-top-color', modifiedBorderColor);
				} else {
					tabContainer.classList.remove('dirty-border-top');
					tabContainer.style.removeProperty('--tab-dirty-border-top-color');
				}
			} else {
				tabContainer.classList.remove('dirty-border-top');
				tabContainer.style.removeProperty('--tab-dirty-border-top-color');
			}
		}

		else {
			tabContainer.classList.remove('dirty', 'dirty-border-top');
			tabContainer.style.removeProperty('--tab-dirty-border-top-color');
		}

		return hasModifiedBorderColor;
	}

	private redrawTabBorders(tabIndex: number, tabContainer: HTMLElement): void {
		const isTabSticky = this.tabsModel.isSticky(tabIndex);
		const isTabLastSticky = isTabSticky && this.tabsModel.stickyCount === tabIndex + 1;
		const showLastStickyTabBorderColor = this.tabsModel.stickyCount !== this.tabsModel.count;

		const borderRightColor = ((isTabLastSticky && showLastStickyTabBorderColor ? this.getColor(TAB_LAST_PINNED_BORDER) : undefined) || this.getColor(TAB_BORDER) || this.getColor(contrastBorder));
		tabContainer.style.borderRight = borderRightColor ? `1px solid ${borderRightColor}` : '';
		tabContainer.style.outlineColor = this.getColor(activeContrastBorder) || '';
	}

	protected override prepareEditorActions(editorActions: IToolbarActions): IToolbarActions {
		const isGroupActive = this.groupsView.activeGroup === this.groupView;

		if (isGroupActive) {
			return editorActions;
		}

		else {
			return {
				primary: this.groupsView.partOptions.alwaysShowEditorActions ? editorActions.primary : editorActions.primary.filter(action => action.id === UNLOCK_GROUP_COMMAND_ID),
				secondary: editorActions.secondary
			};
		}
	}

	protected override prepareEditorLayoutActions(editorActions: IToolbarActions): IToolbarActions {
		return editorActions;
	}

	getHeight(): number {

		if (this.dimensions.used) {
			return this.dimensions.used.height;
		}

		else {
			return this.computeHeight();
		}
	}

	private computeHeight(): number {
		let height: number;

		if (!this.visible) {
			height = 0;
		} else if (this.groupsView.partOptions.wrapTabs && this.tabsAndActionsContainer?.classList.contains('wrapping')) {
			height = this.tabsAndActionsContainer.offsetHeight;
		} else {
			height = this.tabHeight;
		}

		return height;
	}

	layout(dimensions: IEditorTitleControlDimensions, options?: IMultiEditorTabsControlLayoutOptions): Dimension {

		Object.assign(this.dimensions, dimensions);

		if (this.visible) {
			if (!this.layoutScheduler.value) {


				const disposable = scheduleAtNextAnimationFrame(getWindow(this.parent), () => {
					this.doLayout(this.dimensions, this.layoutScheduler.value?.options );

					this.layoutScheduler.clear();
				});
				this.layoutScheduler.value = { options, dispose: () => disposable.dispose() };
			}

			if (options?.forceRevealActiveTab) {
				this.layoutScheduler.value.options = {
					...this.layoutScheduler.value.options,
					forceRevealActiveTab: true
				};
			}
		}

		if (!this.dimensions.used) {
			this.dimensions.used = new Dimension(dimensions.container.width, this.computeHeight());
		}

		return this.dimensions.used;
	}

	private doLayout(dimensions: IEditorTitleControlDimensions, options?: IMultiEditorTabsControlLayoutOptions): void {

		if (dimensions.container !== Dimension.None && dimensions.available !== Dimension.None) {
			this.doLayoutTabs(dimensions, options);
		}

		const oldDimension = this.dimensions.used;
		const newDimension = this.dimensions.used = new Dimension(dimensions.container.width, this.computeHeight());

		if (oldDimension && oldDimension.height !== newDimension.height) {
			this.groupView.relayout();
		}
	}

	private doLayoutTabs(dimensions: IEditorTitleControlDimensions, options?: IMultiEditorTabsControlLayoutOptions): void {

		const tabsWrapMultiLine = this.doLayoutTabsWrapping(dimensions);
		if (!tabsWrapMultiLine) {
			this.doLayoutTabsNonWrapping(options);
		} else {
			assertReturnsDefined(this.stickyTabsBackground).style.width = '0px';
		}
	}

	private doLayoutTabsWrapping(dimensions: IEditorTitleControlDimensions): boolean {
		const [tabsAndActionsContainer, tabsContainer, editorToolbarContainer, tabsScrollbar] = assertReturnsAllDefined(this.tabsAndActionsContainer, this.tabsContainer, this.editorActionsToolbarContainer, this.tabsScrollbar);

		const layoutActionsContainer = this.editorLayoutActionsToolbarContainer;
		const editorToolbarWidth = () => editorToolbarContainer.offsetWidth + (layoutActionsContainer?.offsetWidth ?? 0);


		const didTabsWrapMultiLine = tabsAndActionsContainer.classList.contains('wrapping');
		let tabsWrapMultiLine = didTabsWrapMultiLine;

		function updateTabsWrapping(enabled: boolean): void {
			tabsWrapMultiLine = enabled;

			tabsAndActionsContainer.classList.toggle('wrapping', tabsWrapMultiLine);

			tabsContainer.style.setProperty('--last-tab-margin-right', tabsWrapMultiLine ? `${editorToolbarWidth()}px` : '0');
			tabsAndActionsContainer.style.setProperty('--last-tab-layout-actions-width', `${layoutActionsContainer?.offsetWidth ?? 0}px`);

			for (const tab of tabsContainer.children) {
				tab.classList.remove('last-in-row');
			}
		}

		if (this.groupsView.partOptions.wrapTabs) {
			const visibleTabsWidth = tabsContainer.offsetWidth;
			const allTabsWidth = tabsContainer.scrollWidth;
			const lastTabFitsWrapped = () => {
				const lastTab = this.getLastTab();
				if (!lastTab) {
					return true;
				}

				const lastTabOverlapWithToolbarWidth = lastTab.offsetWidth + editorToolbarWidth() - dimensions.available.width;
				if (lastTabOverlapWithToolbarWidth > 1) {
					return false;
				}

				return true;
			};

			if (tabsWrapMultiLine || (allTabsWidth > visibleTabsWidth && lastTabFitsWrapped())) {
				updateTabsWrapping(true);
			}

			if (tabsWrapMultiLine) {
				if (
					(tabsContainer.offsetHeight > dimensions.available.height) ||
					(allTabsWidth === visibleTabsWidth && tabsContainer.offsetHeight === this.tabHeight) ||
					(!lastTabFitsWrapped())
				) {
					updateTabsWrapping(false);
				}
			}
		}

		else if (didTabsWrapMultiLine) {
			updateTabsWrapping(false);
		}

		if (tabsWrapMultiLine && !didTabsWrapMultiLine) {
			const visibleTabsWidth = tabsContainer.offsetWidth;
			tabsScrollbar.setScrollDimensions({
				width: visibleTabsWidth,
				scrollWidth: visibleTabsWidth
			});
		}

		if (tabsWrapMultiLine) {

			const tabs = new Map<HTMLElement, boolean >();

			let currentTabsPosY: number | undefined = undefined;
			let lastTab: HTMLElement | undefined = undefined;
			for (const child of tabsContainer.children) {
				if (child === this.addTabContainer) {
					continue;
				}
				const tab = child as HTMLElement;
				const tabPosY = tab.offsetTop;

				if (tabPosY !== currentTabsPosY) {
					currentTabsPosY = tabPosY;
					if (lastTab) {
						tabs.set(lastTab, true);
					}
				}

				lastTab = tab;
				tabs.set(tab, false);
			}

			if (lastTab) {
				tabs.set(lastTab, true);
			}

			for (const [tab, lastInRow] of tabs) {
				tab.classList.toggle('last-in-row', lastInRow);
			}
		}

		return tabsWrapMultiLine;
	}

	private doLayoutTabsNonWrapping(options?: IMultiEditorTabsControlLayoutOptions): void {
		const [tabsContainer, tabsScrollbar] = assertReturnsAllDefined(this.tabsContainer, this.tabsScrollbar);


		const visibleTabsWidth = tabsContainer.offsetWidth;
		const allTabsWidth = tabsContainer.scrollWidth;

		let stickyTabsWidth = 0;
		if (this.tabsModel.stickyCount > 0) {
			const stickyTabWidth = this.getStickyTabWidth(this.groupsView.partOptions.pinnedTabSizing);
			stickyTabsWidth = this.tabsModel.stickyCount * stickyTabWidth;

			for (let tabIndex = 0; tabIndex < this.tabsModel.stickyCount; tabIndex++) {
				const tab = this.getTabAtIndex(tabIndex);
				if (tab) {
					tab.style.left = `${tabIndex * stickyTabWidth}px`;
				}
			}
		}

		const activeTabAndIndex = this.tabsModel.activeEditor ? this.getTabAndIndex(this.tabsModel.activeEditor) : undefined;
		const [activeTab, activeTabIndex] = activeTabAndIndex ?? [undefined, undefined];

		let activeTabPositionStatic = this.groupsView.partOptions.pinnedTabSizing !== 'normal' && typeof activeTabIndex === 'number' && this.tabsModel.isSticky(activeTabIndex);

		let availableTabsContainerWidth = visibleTabsWidth - stickyTabsWidth;
		if (this.tabsModel.stickyCount > 0 && availableTabsContainerWidth < MultiEditorTabsControl.TAB_WIDTH.fit) {
			tabsContainer.classList.add('disable-sticky-tabs');

			availableTabsContainerWidth = visibleTabsWidth;
			stickyTabsWidth = 0;
			activeTabPositionStatic = false;
		} else {
			tabsContainer.classList.remove('disable-sticky-tabs');
		}
		assertReturnsDefined(this.stickyTabsBackground).style.width = `${stickyTabsWidth}px`;

		let activeTabPosX: number | undefined;
		let activeTabWidth: number | undefined;

		if (!this.blockRevealActiveTab && activeTab) {
			activeTabPosX = activeTab.offsetLeft;
			activeTabWidth = activeTab.offsetWidth;
		}

		const { width: oldVisibleTabsWidth, scrollWidth: oldAllTabsWidth } = tabsScrollbar.getScrollDimensions();
		tabsScrollbar.setScrollDimensions({
			width: visibleTabsWidth,
			scrollWidth: allTabsWidth
		});
		const dimensionsChanged = oldVisibleTabsWidth !== visibleTabsWidth || oldAllTabsWidth !== allTabsWidth;

		if (
			this.blockRevealActiveTab ||
			typeof activeTabPosX !== 'number' ||
			typeof activeTabWidth !== 'number' ||
			activeTabPositionStatic ||
			(!dimensionsChanged && !options?.forceRevealActiveTab)
		) {
			this.blockRevealActiveTab = false;
			return;
		}

		const tabsContainerScrollPosX = tabsScrollbar.getScrollPosition().scrollLeft;
		const activeTabFits = activeTabWidth <= availableTabsContainerWidth;
		const adjustedActiveTabPosX = activeTabPosX - stickyTabsWidth;

		if (activeTabFits && tabsContainerScrollPosX + availableTabsContainerWidth < adjustedActiveTabPosX + activeTabWidth) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainerScrollPosX + ((adjustedActiveTabPosX + activeTabWidth) - (tabsContainerScrollPosX + availableTabsContainerWidth) )
			});
		}

		else if (tabsContainerScrollPosX > adjustedActiveTabPosX || !activeTabFits) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: adjustedActiveTabPosX
			});
		}
	}

	private getStickyTabWidth(pinnedTabSizing: IEditorPartOptions['pinnedTabSizing']): number {
		const hasModernUITabs = Boolean(this.parent.closest('.modern-ui-tabs'));

		switch (pinnedTabSizing) {
			case 'compact':
				return hasModernUITabs ? MultiEditorTabsControl.MODERN_UI_COMPACT_PINNED_TAB_WIDTH : MultiEditorTabsControl.TAB_WIDTH.compact;
			case 'shrink':
				return MultiEditorTabsControl.TAB_WIDTH.shrink;
			default:
				return 0;
		}
	}

	private updateTabsControlVisibility(): void {
		const tabsAndActionsContainer = assertReturnsDefined(this.tabsAndActionsContainer);
		tabsAndActionsContainer.classList.toggle('empty', !this.visible);

		if (!this.visible && this.dimensions) {
			this.dimensions.used = undefined;
		}
	}

	private get visible(): boolean {
		return this.tabsModel.count > 0;
	}

	private getTabAndIndex(editor: EditorInput): [HTMLElement, number ] | undefined {
		const tabIndex = this.tabsModel.indexOf(editor);
		const tab = this.getTabAtIndex(tabIndex);
		if (tab) {
			return [tab, tabIndex];
		}

		return undefined;
	}

	private getTabAtIndex(tabIndex: number): HTMLElement | undefined {
		if (tabIndex >= 0) {
			const tabsContainer = assertReturnsDefined(this.tabsContainer);

			return tabsContainer.children[tabIndex] as HTMLElement | undefined;
		}

		return undefined;
	}

	private getLastTab(): HTMLElement | undefined {
		return this.getTabAtIndex(this.tabsModel.count - 1);
	}

	private blockRevealActiveTabOnce(): void {

		this.blockRevealActiveTab = true;
	}

	private originatesFromTabActionBar(e: MouseEvent | GestureEvent): boolean {
		let element: HTMLElement;
		if (isMouseEvent(e)) {
			element = (e.target || e.srcElement) as HTMLElement;
		} else {
			element = (e as GestureEvent).initialTarget as HTMLElement;
		}

		return !!findParentWithClass(element, 'action-item', 'tab');
	}

	private async onDrop(e: DragEvent, targetTabIndex: number, tabsContainer: HTMLElement): Promise<void> {
		EventHelper.stop(e, true);

		this.updateDropFeedback(tabsContainer, false, e, targetTabIndex);
		tabsContainer.classList.remove('scroll');

		let targetEditorIndex = this.tabsModel instanceof UnstickyEditorGroupModel ? targetTabIndex + this.groupView.stickyCount : targetTabIndex;
		const options: IEditorOptions = {
			sticky: this.tabsModel instanceof StickyEditorGroupModel && this.tabsModel.stickyCount === targetEditorIndex,
			index: targetEditorIndex
		};

		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data) && data.length > 0) {
				const sourceGroup = this.editorPartsView.getGroup(data[0].identifier);
				if (sourceGroup) {
					const mergeGroupOptions: IMergeGroupOptions = { index: targetEditorIndex };
					if (!this.isMoveOperation(e, sourceGroup.id)) {
						mergeGroupOptions.mode = MergeGroupMode.COPY_EDITORS;
					}

					this.groupsView.mergeGroup(sourceGroup, this.groupView, mergeGroupOptions);
				}

				this.groupView.focus();
				this.groupTransfer.clearData(DraggedEditorGroupIdentifier.prototype);
			}
		}

		else if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
			if (Array.isArray(data) && data.length > 0) {
				const sourceGroup = this.editorPartsView.getGroup(data[0].identifier.groupId);
				if (sourceGroup) {
					for (const de of data) {
						const editor = de.identifier.editor;

						if (sourceGroup.id !== de.identifier.groupId) {
							continue;
						}

						const sourceEditorIndex = sourceGroup.getIndexOfEditor(editor);
						if (sourceGroup === this.groupView && sourceEditorIndex < targetEditorIndex) {
							targetEditorIndex--;
						}

						if (this.isMoveOperation(e, de.identifier.groupId, editor)) {
							sourceGroup.moveEditor(editor, this.groupView, { ...options, index: targetEditorIndex });

							if (this.tabsModel instanceof UnstickyEditorGroupModel && this.groupView.isSticky(editor)) {
								this.groupView.unstickEditor(editor);
							}
						} else {
							sourceGroup.copyEditor(editor, this.groupView, { ...options, index: targetEditorIndex });
						}

						targetEditorIndex++;
					}
				}
			}

			this.groupView.focus();
			this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
		}

		else if (this.treeItemsTransfer.hasData(DraggedTreeItemsIdentifier.prototype)) {
			const data = this.treeItemsTransfer.getData(DraggedTreeItemsIdentifier.prototype);
			if (Array.isArray(data) && data.length > 0) {
				const editors: IUntypedEditorInput[] = [];
				for (const id of data) {
					const dataTransferItem = await this.treeViewsDragAndDropService.removeDragOperationTransfer(id.identifier);
					if (dataTransferItem) {
						const treeDropData = await extractTreeDropData(dataTransferItem);
						editors.push(...treeDropData.map(editor => ({ ...editor, options: { ...editor.options, pinned: true, index: targetEditorIndex } })));
					}
				}

				this.editorService.openEditors(editors, this.groupView, { validateTrust: true });
			}

			this.treeItemsTransfer.clearData(DraggedTreeItemsIdentifier.prototype);
		}

		else {
			const dropHandler = this.instantiationService.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: false });
			dropHandler.handleDrop(e, getWindow(this.parent), () => this.groupView, () => this.groupView.focus(), options);
		}
	}

	override dispose(): void {
		super.dispose();

		this.tabDisposables = dispose(this.tabDisposables);
	}
}

registerThemingParticipant((theme, collector) => {

	const borderColor = theme.getColor(TAB_BORDER);
	if (borderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title > .tabs-and-actions-container.wrapping .tabs-container > .tab {
				border-bottom: 1px solid ${borderColor};
			}
		`);
	}

	const activeContrastBorderColor = theme.getColor(activeContrastBorder);
	if (activeContrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab.active,
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab.active:hover  {
				outline: 1px solid;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.selected:not(.active):not(:hover)  {
				outline: 1px dotted;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab.active:focus {
				outline-style: dashed;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active {
				outline: 1px dashed;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				outline: 1px dashed;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active:hover > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.dirty > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.sticky > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover > .tab-actions .action-label {
				opacity: 1 !important;
			}
		`);
	}

	const contrastBorderColor = theme.getColor(contrastBorder);
	if (contrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .editor-actions {
				outline: 1px solid ${contrastBorderColor}
			}
		`);
	}

	const tabHoverBackground = theme.getColor(TAB_HOVER_BACKGROUND);
	if (tabHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:not(.selected):hover {
				background-color: ${tabHoverBackground} !important;
			}
		`);
	}

	const tabUnfocusedHoverBackground = theme.getColor(TAB_UNFOCUSED_HOVER_BACKGROUND);
	if (tabUnfocusedHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:not(.selected):hover  {
				background-color: ${tabUnfocusedHoverBackground} !important;
			}
		`);
	}

	const tabHoverForeground = theme.getColor(TAB_HOVER_FOREGROUND);
	if (tabHoverForeground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:not(.selected):hover  {
				color: ${tabHoverForeground} !important;
			}
		`);
	}

	const tabUnfocusedHoverForeground = theme.getColor(TAB_UNFOCUSED_HOVER_FOREGROUND);
	if (tabUnfocusedHoverForeground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:not(.selected):hover  {
				color: ${tabUnfocusedHoverForeground} !important;
			}
		`);
	}

	const tabHoverBorder = theme.getColor(TAB_HOVER_BORDER);
	if (tabHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover > .tab-border-bottom-container {
				display: block;
				position: absolute;
				left: 0;
				pointer-events: none;
				width: 100%;
				z-index: 10;
				bottom: 0;
				height: 1px;
				background-color: ${tabHoverBorder};
			}
		`);
	}

	const tabUnfocusedHoverBorder = theme.getColor(TAB_UNFOCUSED_HOVER_BORDER);
	if (tabUnfocusedHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover > .tab-border-bottom-container  {
				display: block;
				position: absolute;
				left: 0;
				pointer-events: none;
				width: 100%;
				z-index: 10;
				bottom: 0;
				height: 1px;
				background-color: ${tabUnfocusedHoverBorder};
			}
		`);
	}

	if (!isHighContrast(theme.type) && !isSafari && !activeContrastBorderColor) {
		const workbenchBackground = WORKBENCH_BACKGROUND(theme);
		const editorBackgroundColor = theme.getColor(editorBackground);
		const editorGroupHeaderTabsBackground = theme.getColor(EDITOR_GROUP_HEADER_TABS_BACKGROUND);
		const editorDragAndDropBackground = theme.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND);

		let adjustedTabBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor) {
			adjustedTabBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorBackgroundColor, workbenchBackground);
		}

		let adjustedTabDragBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor && editorDragAndDropBackground && editorBackgroundColor) {
			adjustedTabDragBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorDragAndDropBackground, editorBackgroundColor, workbenchBackground);
		}

		const makeTabHoverBackgroundRule = (color: Color, colorDrag: Color, hasFocus = false) => `
			.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after,
			.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-fixed:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after {
				background: linear-gradient(to left, ${color}, transparent) !important;
			}

			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after,
			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-fixed:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after {
				background: linear-gradient(to left, ${colorDrag}, transparent) !important;
			}
		`;

		if (tabHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag, true));
		}

		if (tabUnfocusedHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag));
		}

		if (editorDragAndDropBackground && adjustedTabDragBackground) {
			const adjustedColorDrag = editorDragAndDropBackground.flatten(adjustedTabDragBackground);
			collector.addRule(`
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container.active > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.active):not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container:not(.active) > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container.active > .title .tabs-container > .tab.sizing-fixed.dragged-over:not(.active):not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container:not(.active) > .title .tabs-container > .tab.sizing-fixed.dragged-over:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after {
					background: linear-gradient(to left, ${adjustedColorDrag}, transparent) !important;
				}
		`);
		}

		const makeTabBackgroundRule = (color: Color, colorDrag: Color, focused: boolean, active: boolean) => `
				.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-fixed${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after {
					background: linear-gradient(to left, ${color}, transparent);
				}

				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-fixed${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after {
					background: linear-gradient(to left, ${colorDrag}, transparent);
				}
		`;

		const tabActiveBackground = theme.getColor(TAB_ACTIVE_BACKGROUND);
		if (tabActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, true, true));
		}

		const tabUnfocusedActiveBackground = theme.getColor(TAB_UNFOCUSED_ACTIVE_BACKGROUND);
		if (tabUnfocusedActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, false, true));
		}

		const tabInactiveBackground = theme.getColor(TAB_INACTIVE_BACKGROUND);
		if (tabInactiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabInactiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabInactiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, true, false));
		}

		const tabUnfocusedInactiveBackground = theme.getColor(TAB_UNFOCUSED_INACTIVE_BACKGROUND);
		if (tabUnfocusedInactiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedInactiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedInactiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, false, false));
		}
	}
});
