/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/editorgroupview.css';
import { EditorGroupModel, IEditorOpenOptions, IGroupModelChangeEvent, ISerializedEditorGroupModel, isGroupEditorCloseEvent, isGroupEditorOpenEvent, isSerializedEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { GroupIdentifier, CloseDirection, IEditorCloseEvent, IEditorPane, SaveReason, IEditorPartOptionsChangeEvent, EditorsOrder, IVisibleEditorPane, EditorResourceAccessor, EditorInputCapabilities, IUntypedEditorInput, DEFAULT_EDITOR_ASSOCIATION, SideBySideEditor, EditorCloseContext, IEditorWillMoveEvent, IEditorWillOpenEvent, IMatchEditorOptions, GroupModelChangeKind, IActiveEditorChangeEvent, IFindEditorOptions, TEXT_DIFF_EDITOR_ID } from '../../../common/editor.js';
import { ActiveEditorGroupLockedContext, ActiveEditorDirtyContext, EditorGroupEditorsCountContext, ActiveEditorStickyContext, ActiveEditorPinnedContext, ActiveEditorLastInGroupContext, ActiveEditorFirstInGroupContext, ResourceContextKey, applyAvailableEditorIds, ActiveEditorAvailableEditorIdsContext, ActiveEditorCanSplitInGroupContext, SideBySideEditorActiveContext, TextCompareEditorVisibleContext, TextCompareEditorActiveContext, ActiveEditorContext, ActiveEditorReadonlyContext, ActiveEditorCanRevertContext, ActiveEditorCanToggleReadonlyContext, ActiveCompareEditorCanSwapContext, MultipleEditorsSelectedInGroupContext, TwoEditorsSelectedInGroupContext, SelectedEditorsInGroupFileOrUntitledResourceContextKey, ActiveEditorCannotCloseContext } from '../../../common/contextkeys.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { SideBySideEditorInput } from '../../../common/editor/sideBySideEditorInput.js';
import { Emitter, Event, Relay } from '../../../../base/common/event.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Dimension, trackFocus, addDisposableListener, EventType, EventHelper, findParentWithClass, isAncestor, IDomNodePagePosition, isMouseEvent, isActiveElement, getWindow, getActiveElement, $ } from '../../../../base/browser/dom.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ProgressBar } from '../../../../base/browser/ui/progressbar/progressbar.js';
import { IThemeService, Themable } from '../../../../platform/theme/common/themeService.js';
import { editorBackground, contrastBorder } from '../../../../platform/theme/common/colorRegistry.js';
import { EDITOR_GROUP_HEADER_TABS_BACKGROUND, EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND, EDITOR_GROUP_EMPTY_BACKGROUND, EDITOR_GROUP_HEADER_BORDER } from '../../../common/theme.js';
import { ICloseEditorsFilter, GroupsOrder, ICloseEditorOptions, ICloseAllEditorsOptions, IEditorReplacement, IActiveEditorActions } from '../../../services/editor/common/editorGroupsService.js';
import { EditorPanes } from './editorPanes.js';
import { IEditorProgressService } from '../../../../platform/progress/common/progress.js';
import { EditorProgressIndicator } from '../../../services/progress/browser/progressIndicator.js';
import { localize } from '../../../../nls.js';
import { coalesce } from '../../../../base/common/arrays.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ITelemetryData, ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { DeferredPromise, Promises, RunOnceWorker } from '../../../../base/common/async.js';
import { EventType as TouchEventType, GestureEvent } from '../../../../base/browser/touch.js';
import { IEditorGroupsView, IEditorGroupView, fillActiveEditorViewState, EditorServiceImpl, IEditorGroupTitleHeight, IInternalEditorOpenOptions, IInternalMoveCopyOptions, IInternalEditorCloseOptions, IInternalEditorTitleControlOptions, IEditorPartsView, IEditorGroupViewOptions } from './editor.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { Separator, SubmenuAction } from '../../../../base/common/actions.js';
import { IMenuChangeEvent, IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { getActionBarActions, PrimaryAndSecondaryActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { createEditorTypeActions, getAvailableEditorTypes } from './editorTypePicker.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { hash } from '../../../../base/common/hash.js';
import { getMimeTypes } from '../../../../editor/common/services/languagesAssociations.js';
import { extname, isEqual } from '../../../../base/common/resources.js';
import { Schemas } from '../../../../base/common/network.js';
import { EditorActivation, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileDialogService, ConfirmResult, IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFilesConfigurationService, AutoSaveMode } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { URI } from '../../../../base/common/uri.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { isLinux, isMacintosh, isNative, isWindows } from '../../../../base/common/platform.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { TelemetryTrustedValue } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { defaultProgressBarStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IBoundarySashes } from '../../../../base/browser/ui/sash/sash.js';
import { EditorGroupWatermark } from './editorGroupWatermark.js';
import { EditorTitleControl } from './editorTitleControl.js';
import { EditorPane } from './editorPane.js';
import { IEditorResolverService } from '../../../services/editor/common/editorResolverService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { DiffEditorInput } from '../../../common/editor/diffEditorInput.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';

export class EditorGroupView extends Themable implements IEditorGroupView {


	static createNew(editorPartsView: IEditorPartsView, groupsView: IEditorGroupsView, groupsLabel: string, groupIndex: number, instantiationService: IInstantiationService, options?: IEditorGroupViewOptions): IEditorGroupView {
		return instantiationService.createInstance(EditorGroupView, null, editorPartsView, groupsView, groupsLabel, groupIndex, options);
	}

	static createFromSerialized(serialized: ISerializedEditorGroupModel, editorPartsView: IEditorPartsView, groupsView: IEditorGroupsView, groupsLabel: string, groupIndex: number, instantiationService: IInstantiationService, options?: IEditorGroupViewOptions): IEditorGroupView {
		return instantiationService.createInstance(EditorGroupView, serialized, editorPartsView, groupsView, groupsLabel, groupIndex, options);
	}

	static createCopy(copyFrom: IEditorGroupView, editorPartsView: IEditorPartsView, groupsView: IEditorGroupsView, groupsLabel: string, groupIndex: number, instantiationService: IInstantiationService, options?: IEditorGroupViewOptions): IEditorGroupView {
		return instantiationService.createInstance(EditorGroupView, copyFrom, editorPartsView, groupsView, groupsLabel, groupIndex, options);
	}


	readonly scopedContextKeyService: IContextKeyService;


	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	private readonly _onDidModelChange = this._register(new Emitter<IGroupModelChangeEvent>());
	readonly onDidModelChange = this._onDidModelChange.event;

	private readonly _onDidActiveEditorChange = this._register(new Emitter<IActiveEditorChangeEvent>());
	readonly onDidActiveEditorChange = this._onDidActiveEditorChange.event;

	private readonly _onDidOpenEditorFail = this._register(new Emitter<EditorInput>());
	readonly onDidOpenEditorFail = this._onDidOpenEditorFail.event;

	private readonly _onWillCloseEditor = this._register(new Emitter<IEditorCloseEvent>());
	readonly onWillCloseEditor = this._onWillCloseEditor.event;

	private readonly _onDidCloseEditor = this._register(new Emitter<IEditorCloseEvent>());
	readonly onDidCloseEditor = this._onDidCloseEditor.event;

	private readonly _onWillMoveEditor = this._register(new Emitter<IEditorWillMoveEvent>());
	readonly onWillMoveEditor = this._onWillMoveEditor.event;

	private readonly _onWillOpenEditor = this._register(new Emitter<IEditorWillOpenEvent>());
	readonly onWillOpenEditor = this._onWillOpenEditor.event;


	private readonly model: EditorGroupModel;

	private active: boolean | undefined;
	private lastLayout: IDomNodePagePosition | undefined;

	private readonly scopedInstantiationService: IInstantiationService;

	private readonly resourceContext: ResourceContextKey;

	private readonly titleContainer: HTMLElement;
	private readonly titleControl: EditorTitleControl;

	private readonly progressBar: ProgressBar;

	private readonly editorContainer: HTMLElement;
	private readonly editorPane: EditorPanes;

	private _contentRightInset = 0;

	private readonly _onDidRelayout = this._register(new Emitter<void>());
	readonly onDidRelayout = this._onDidRelayout.event;

	private readonly disposedEditorsWorker = this._register(new RunOnceWorker<EditorInput>(editors => this.handleDisposedEditors(editors), 0));

	private readonly mapEditorToPendingConfirmation = new Map<EditorInput, Promise<boolean>>();

	private readonly containerToolBarMenuDisposable = this._register(new MutableDisposable());

	private readonly whenRestoredPromise = new DeferredPromise<void>();
	readonly whenRestored = this.whenRestoredPromise.p;

	constructor(
		from: IEditorGroupView | ISerializedEditorGroupModel | null,
		private readonly editorPartsView: IEditorPartsView,
		readonly groupsView: IEditorGroupsView,
		private groupsLabel: string,
		private _index: number,
		options: IEditorGroupViewOptions | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IEditorService private readonly editorService: EditorServiceImpl,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService,
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IHostService private readonly hostService: IHostService,
		@IDialogService private readonly dialogService: IDialogService,
		@IFileService private readonly fileService: IFileService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(themeService);

		if (from instanceof EditorGroupView) {
			this.model = this._register(from.model.clone());
		} else if (isSerializedEditorGroupModel(from)) {
			this.model = this._register(instantiationService.createInstance(EditorGroupModel, from));
		} else {
			this.model = this._register(instantiationService.createInstance(EditorGroupModel, undefined));
		}

		{
			this.scopedContextKeyService = this._register(this.contextKeyService.createScoped(this.element));

			this.element.classList.add(...coalesce(['editor-group-container', this.model.isLocked ? 'locked' : undefined]));

			this.registerContainerListeners();

			this.createContainerToolbar();

			this.createContainerContextMenu();

			this._register(this.instantiationService.createInstance(EditorGroupWatermark, this.element));

			this.progressBar = this._register(new ProgressBar(this.element, defaultProgressBarStyles));
			this.progressBar.hide();

			this.scopedInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection(
				[IContextKeyService, this.scopedContextKeyService],
				[IEditorProgressService, this._register(new EditorProgressIndicator(this.progressBar, this))]
			)));

			this.resourceContext = this._register(this.scopedInstantiationService.createInstance(ResourceContextKey));
			this.handleGroupContextKeys();

			this.titleContainer = $('.title');
			this.element.appendChild(this.titleContainer);

			this.titleControl = this._register(this.scopedInstantiationService.createInstance(EditorTitleControl, this.titleContainer, this.editorPartsView, this.groupsView, this, this.model, options?.menuIds, options?.showHeader === true));

			this.editorContainer = $('.editor-container');
			this.element.appendChild(this.editorContainer);

			this.editorPane = this._register(this.scopedInstantiationService.createInstance(EditorPanes, this.element, this.editorContainer, this));
			this._onDidChange.input = this.editorPane.onDidChangeSizeConstraints;

			this.doTrackFocus();

			this.updateTitleContainer();
			this.updateContainer();

			this.updateStyles();
		}

		const restoreEditorsPromise = this.restoreEditors(from, options) ?? Promise.resolve();

		restoreEditorsPromise.finally(() => {
			this.whenRestoredPromise.complete();
		});

		this.registerListeners();
	}

	private handleGroupContextKeys(): void {
		const groupActiveEditorDirtyContext = this.editorPartsView.bind(ActiveEditorDirtyContext, this);
		const groupActiveEditorPinnedContext = this.editorPartsView.bind(ActiveEditorPinnedContext, this);
		const groupActiveEditorFirstContext = this.editorPartsView.bind(ActiveEditorFirstInGroupContext, this);
		const groupActiveEditorLastContext = this.editorPartsView.bind(ActiveEditorLastInGroupContext, this);
		const groupActiveEditorStickyContext = this.editorPartsView.bind(ActiveEditorStickyContext, this);
		const groupEditorsCountContext = this.editorPartsView.bind(EditorGroupEditorsCountContext, this);
		const groupLockedContext = this.editorPartsView.bind(ActiveEditorGroupLockedContext, this);

		const multipleEditorsSelectedContext = MultipleEditorsSelectedInGroupContext.bindTo(this.scopedContextKeyService);
		const twoEditorsSelectedContext = TwoEditorsSelectedInGroupContext.bindTo(this.scopedContextKeyService);
		const selectedEditorsHaveFileOrUntitledResourceContext = SelectedEditorsInGroupFileOrUntitledResourceContextKey.bindTo(this.scopedContextKeyService);

		const groupActiveEditorContext = this.editorPartsView.bind(ActiveEditorContext, this);
		const groupActiveEditorIsReadonly = this.editorPartsView.bind(ActiveEditorReadonlyContext, this);
		const groupActiveEditorCanRevert = this.editorPartsView.bind(ActiveEditorCanRevertContext, this);
		const groupActiveEditorCanToggleReadonly = this.editorPartsView.bind(ActiveEditorCanToggleReadonlyContext, this);
		const groupActiveCompareEditorCanSwap = this.editorPartsView.bind(ActiveCompareEditorCanSwapContext, this);
		const groupTextCompareEditorVisibleContext = this.editorPartsView.bind(TextCompareEditorVisibleContext, this);
		const groupTextCompareEditorActiveContext = this.editorPartsView.bind(TextCompareEditorActiveContext, this);

		const groupActiveEditorAvailableEditorIds = this.editorPartsView.bind(ActiveEditorAvailableEditorIdsContext, this);
		const groupActiveEditorCanSplitInGroupContext = this.editorPartsView.bind(ActiveEditorCanSplitInGroupContext, this);
		const groupActiveEditorCannotCloseContext = this.editorPartsView.bind(ActiveEditorCannotCloseContext, this);
		const groupActiveEditorIsSideBySideEditorContext = this.editorPartsView.bind(SideBySideEditorActiveContext, this);

		const activeEditorListener = this._register(new MutableDisposable());

		const observeActiveEditor = () => {
			activeEditorListener.clear();

			this.scopedContextKeyService.bufferChangeEvents(() => {
				const activeEditor = this.activeEditor;
				const activeEditorPane = this.activeEditorPane;

				this.resourceContext.set(EditorResourceAccessor.getOriginalUri(activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY }));

				applyAvailableEditorIds(groupActiveEditorAvailableEditorIds, activeEditor, this.editorResolverService);

				if (activeEditor) {
					groupActiveEditorCanSplitInGroupContext.set(activeEditor.hasCapability(EditorInputCapabilities.CanSplitInGroup));
					groupActiveEditorCannotCloseContext.set(activeEditor.hasCapability(EditorInputCapabilities.CannotClose));
					groupActiveEditorIsSideBySideEditorContext.set(activeEditor.typeId === SideBySideEditorInput.ID);

					groupActiveEditorDirtyContext.set(activeEditor.isDirty() && !activeEditor.isSaving());
					activeEditorListener.value = activeEditor.onDidChangeDirty(() => {
						groupActiveEditorDirtyContext.set(activeEditor.isDirty() && !activeEditor.isSaving());
					});
				} else {
					groupActiveEditorCanSplitInGroupContext.set(false);
					groupActiveEditorCannotCloseContext.set(false);
					groupActiveEditorIsSideBySideEditorContext.set(false);
					groupActiveEditorDirtyContext.set(false);
				}

				if (activeEditorPane) {
					groupActiveEditorContext.set(activeEditorPane.getId());
					groupActiveEditorCanRevert.set(!activeEditorPane.input.hasCapability(EditorInputCapabilities.Untitled));
					groupActiveEditorIsReadonly.set(!!activeEditorPane.input.isReadonly());

					const primaryEditorResource = EditorResourceAccessor.getOriginalUri(activeEditorPane.input, { supportSideBySide: SideBySideEditor.PRIMARY });
					const secondaryEditorResource = EditorResourceAccessor.getOriginalUri(activeEditorPane.input, { supportSideBySide: SideBySideEditor.SECONDARY });
					groupActiveCompareEditorCanSwap.set(activeEditorPane.input instanceof DiffEditorInput && !activeEditorPane.input.original.isReadonly() && !!primaryEditorResource && (this.fileService.hasProvider(primaryEditorResource) || primaryEditorResource.scheme === Schemas.untitled) && !!secondaryEditorResource && (this.fileService.hasProvider(secondaryEditorResource) || secondaryEditorResource.scheme === Schemas.untitled));
					groupActiveEditorCanToggleReadonly.set(!!primaryEditorResource && this.fileService.hasProvider(primaryEditorResource) && !this.fileService.hasCapability(primaryEditorResource, FileSystemProviderCapabilities.Readonly));

					const activePaneDiffEditor = activeEditorPane?.getId() === TEXT_DIFF_EDITOR_ID;
					groupTextCompareEditorActiveContext.set(activePaneDiffEditor);
					groupTextCompareEditorVisibleContext.set(activePaneDiffEditor);
				} else {
					groupActiveEditorContext.reset();
					groupActiveEditorCanRevert.reset();
					groupActiveEditorIsReadonly.reset();
					groupActiveCompareEditorCanSwap.reset();
					groupActiveEditorCanToggleReadonly.reset();
				}
			});
		};

		const updateGroupContextKeys = (e: IGroupModelChangeEvent) => {
			switch (e.kind) {
				case GroupModelChangeKind.GROUP_LOCKED:
					groupLockedContext.set(this.isLocked);
					break;
				case GroupModelChangeKind.EDITOR_ACTIVE:
					groupActiveEditorFirstContext.set(this.model.isFirst(this.model.activeEditor));
					groupActiveEditorLastContext.set(this.model.isLast(this.model.activeEditor));
					groupActiveEditorPinnedContext.set(this.model.activeEditor ? this.model.isPinned(this.model.activeEditor) : false);
					groupActiveEditorStickyContext.set(this.model.activeEditor ? this.model.isSticky(this.model.activeEditor) : false);
					break;
				case GroupModelChangeKind.EDITOR_CLOSE:
					groupActiveEditorPinnedContext.set(this.model.activeEditor ? this.model.isPinned(this.model.activeEditor) : false);
					groupActiveEditorStickyContext.set(this.model.activeEditor ? this.model.isSticky(this.model.activeEditor) : false);
					break;
				case GroupModelChangeKind.EDITOR_OPEN:
				case GroupModelChangeKind.EDITOR_MOVE:
					groupActiveEditorFirstContext.set(this.model.isFirst(this.model.activeEditor));
					groupActiveEditorLastContext.set(this.model.isLast(this.model.activeEditor));
					break;
				case GroupModelChangeKind.EDITOR_PIN:
					if (e.editor && e.editor === this.model.activeEditor) {
						groupActiveEditorPinnedContext.set(this.model.isPinned(this.model.activeEditor));
					}
					break;
				case GroupModelChangeKind.EDITOR_STICKY:
					if (e.editor && e.editor === this.model.activeEditor) {
						groupActiveEditorStickyContext.set(this.model.isSticky(this.model.activeEditor));
					}
					break;
				case GroupModelChangeKind.EDITOR_CAPABILITIES:
					if (e.editor && e.editor === this.model.activeEditor) {
						observeActiveEditor();
					}
					break;
				case GroupModelChangeKind.EDITORS_SELECTION:
					multipleEditorsSelectedContext.set(this.model.selectedEditors.length > 1);
					twoEditorsSelectedContext.set(this.model.selectedEditors.length === 2);
					selectedEditorsHaveFileOrUntitledResourceContext.set(this.model.selectedEditors.every(e => e.resource && (this.fileService.hasProvider(e.resource) || e.resource.scheme === Schemas.untitled)));
					break;
			}

			groupEditorsCountContext.set(this.count);
		};

		this._register(this.onDidModelChange(e => updateGroupContextKeys(e)));

		this._register(this.onDidActiveEditorChange(() => observeActiveEditor()));

		observeActiveEditor();
		updateGroupContextKeys({ kind: GroupModelChangeKind.EDITOR_ACTIVE });
		updateGroupContextKeys({ kind: GroupModelChangeKind.GROUP_LOCKED });
	}

	private registerContainerListeners(): void {

		this._register(addDisposableListener(this.element, EventType.DBLCLICK, e => {
			if (this.isEmpty) {
				EventHelper.stop(e);

				this.editorService.openEditor({
					resource: undefined,
					options: {
						pinned: true,
						override: DEFAULT_EDITOR_ASSOCIATION.id
					}
				}, this.id);
			}
		}));

		this._register(addDisposableListener(this.element, EventType.AUXCLICK, e => {
			if (this.isEmpty && e.button === 1 ) {
				EventHelper.stop(e, true);

				this.groupsView.removeGroup(this);
			}
		}));
	}

	private createContainerToolbar(): void {

		const toolbarContainer = $('.editor-group-container-toolbar');
		this.element.appendChild(toolbarContainer);

		const containerToolbar = this._register(new ActionBar(toolbarContainer, {
			ariaLabel: localize('ariaLabelGroupActions', "Empty editor group actions"),
			highlightToggledItems: true
		}));

		const containerToolbarMenu = this._register(this.menuService.createMenu(MenuId.EmptyEditorGroup, this.scopedContextKeyService));
		const updateContainerToolbar = () => {

			this.containerToolBarMenuDisposable.value = toDisposable(() => containerToolbar.clear());

			const actions = getActionBarActions(
				containerToolbarMenu.getActions({ arg: { groupId: this.id }, shouldForwardArgs: true }),
				'navigation'
			);

			for (const action of [...actions.primary, ...actions.secondary]) {
				const keybinding = this.keybindingService.lookupKeybinding(action.id);
				containerToolbar.push(action, { icon: true, label: false, keybinding: keybinding?.getLabel() });
			}
		};
		updateContainerToolbar();
		this._register(containerToolbarMenu.onDidChange(updateContainerToolbar));
	}

	private createContainerContextMenu(): void {
		this._register(addDisposableListener(this.element, EventType.CONTEXT_MENU, e => this.onShowContainerContextMenu(e)));
		this._register(addDisposableListener(this.element, TouchEventType.Contextmenu, () => this.onShowContainerContextMenu()));
	}

	private onShowContainerContextMenu(e?: MouseEvent): void {
		if (!this.isEmpty) {
			return;
		}

		let anchor: HTMLElement | StandardMouseEvent = this.element;
		if (e) {
			anchor = new StandardMouseEvent(getWindow(this.element), e);
		}

		this.contextMenuService.showContextMenu({
			menuId: MenuId.EmptyEditorGroupContext,
			contextKeyService: this.contextKeyService,
			getAnchor: () => anchor,
			onHide: () => this.focus()
		});
	}

	private doTrackFocus(): void {

		const containerFocusTracker = this._register(trackFocus(this.element));
		this._register(containerFocusTracker.onDidFocus(() => {
			if (this.isEmpty) {
				this._onDidFocus.fire();
			}
		}));

		const handleTitleClickOrTouch = (e: MouseEvent | GestureEvent): void => {
			let target: HTMLElement;
			if (isMouseEvent(e)) {
				if (e.button !== 0 || (isMacintosh && e.ctrlKey )) {
					return undefined;
				}

				target = e.target as HTMLElement;
			} else {
				target = (e as GestureEvent).initialTarget as HTMLElement;
			}

			if (findParentWithClass(target, 'monaco-action-bar', this.titleContainer) ||
				findParentWithClass(target, 'monaco-breadcrumb-item', this.titleContainer)
			) {
				return;
			}

			setTimeout(() => {
				this.focus();
			});
		};

		this._register(addDisposableListener(this.titleContainer, EventType.MOUSE_DOWN, e => handleTitleClickOrTouch(e)));
		this._register(addDisposableListener(this.titleContainer, TouchEventType.Tap, e => handleTitleClickOrTouch(e)));

		this._register(this.editorPane.onDidFocus(() => {
			this._onDidFocus.fire();
		}));
	}

	private updateContainer(): void {

		if (this.isEmpty) {
			this.element.classList.add('empty');
			this.element.tabIndex = 0;
			this.element.setAttribute('aria-label', localize('emptyEditorGroup', "{0} (empty)", this.ariaLabel));
		}

		else {
			this.element.classList.remove('empty');
			this.element.removeAttribute('tabIndex');
			this.element.removeAttribute('aria-label');
		}

		this.updateStyles();
	}

	private updateTitleContainer(): void {
		this.titleContainer.classList.toggle('tabs', this.groupsView.partOptions.showTabs === 'multiple');
		this.titleContainer.classList.toggle('show-file-icons', this.groupsView.partOptions.showIcons);
	}

	private restoreEditors(from: IEditorGroupView | ISerializedEditorGroupModel | null, groupViewOptions?: IEditorGroupViewOptions): Promise<void> | undefined {
		if (this.count === 0) {
			return;
		}

		let options: IEditorOptions;
		if (from instanceof EditorGroupView) {
			options = fillActiveEditorViewState(from);
		} else {
			options = Object.create(null);
		}

		const activeEditor = this.model.activeEditor;
		if (!activeEditor) {
			return;
		}

		options.pinned = this.model.isPinned(activeEditor);
		options.sticky = this.model.isSticky(activeEditor);
		options.preserveFocus = true;

		const internalOptions: IInternalEditorOpenOptions = {
			preserveWindowOrder: true,
			skipTitleUpdate: true,
		};

		const activeElement = getActiveElement();

		const result = this.doShowEditor(activeEditor, { active: true, isNew: false }, options, internalOptions).then(() => {


			if (this.groupsView.activeGroup === this && activeElement && isActiveElement(activeElement) && !groupViewOptions?.preserveFocus) {
				this.focus();
			}
		});

		this.titleControl.openEditors(this.editors);

		return result;
	}


	private registerListeners(): void {

		this._register(this.model.onDidModelChange(e => this.onDidGroupModelChange(e)));

		this._register(this.groupsView.onDidChangeEditorPartOptions(e => this.onDidChangeEditorPartOptions(e)));

		this._register(this.groupsView.onDidVisibilityChange(e => this.onDidVisibilityChange(e)));

		this._register(this.onDidFocus(() => this.onDidGainFocus()));
	}

	private onDidGroupModelChange(e: IGroupModelChangeEvent): void {

		this._onDidModelChange.fire(e);


		switch (e.kind) {
			case GroupModelChangeKind.GROUP_LOCKED:
				this.element.classList.toggle('locked', this.isLocked);
				break;
			case GroupModelChangeKind.EDITORS_SELECTION:
				this.onDidChangeEditorSelection();
				break;
		}

		if (!e.editor) {
			return;
		}

		switch (e.kind) {
			case GroupModelChangeKind.EDITOR_OPEN:
				if (isGroupEditorOpenEvent(e)) {
					this.onDidOpenEditor(e.editor, e.editorIndex);
				}
				break;
			case GroupModelChangeKind.EDITOR_CLOSE:
				if (isGroupEditorCloseEvent(e)) {
					this.handleOnDidCloseEditor(e.editor, e.editorIndex, e.context, e.sticky);
				}
				break;
			case GroupModelChangeKind.EDITOR_WILL_DISPOSE:
				this.onWillDisposeEditor(e.editor);
				break;
			case GroupModelChangeKind.EDITOR_DIRTY:
				this.onDidChangeEditorDirty(e.editor);
				break;
			case GroupModelChangeKind.EDITOR_TRANSIENT:
				this.onDidChangeEditorTransient(e.editor);
				break;
			case GroupModelChangeKind.EDITOR_LABEL:
				this.onDidChangeEditorLabel(e.editor);
				break;
			case GroupModelChangeKind.EDITOR_CAPABILITIES:
				this.onDidChangeEditorCapabilities(e.editor);
				break;
		}
	}

	private onDidOpenEditor(editor: EditorInput, editorIndex: number): void {

		this.telemetryService.publicLog('editorOpened', this.toEditorTelemetryDescriptor(editor));

		this.updateContainer();
	}

	private handleOnDidCloseEditor(editor: EditorInput, editorIndex: number, context: EditorCloseContext, sticky: boolean): void {

		this._onWillCloseEditor.fire({ groupId: this.id, editor, context, index: editorIndex, sticky });

		const editorsToClose: EditorInput[] = [editor];

		if (editor instanceof SideBySideEditorInput) {
			editorsToClose.push(editor.primary, editor.secondary);
		}

		for (const editor of editorsToClose) {
			if (this.canDispose(editor)) {
				editor.dispose();
			}
		}

		this.updateContainer();

		this._onDidCloseEditor.fire({ groupId: this.id, editor, context, index: editorIndex, sticky });
	}

	private canDispose(editor: EditorInput): boolean {
		for (const groupView of this.editorPartsView.groups) {
			if (groupView instanceof EditorGroupView && groupView.model.contains(editor, {
				strictEquals: true,
				supportSideBySide: SideBySideEditor.ANY
			})) {
				return false;
			}
		}

		return true;
	}

	private toResourceTelemetryDescriptor(resource: URI): object | undefined {
		if (!resource) {
			return undefined;
		}

		const path = resource ? resource.scheme === Schemas.file ? resource.fsPath : resource.path : undefined;
		if (!path) {
			return undefined;
		}

		let resourceExt = extname(resource);
		const queryStringLocation = resourceExt.indexOf('?');
		resourceExt = queryStringLocation !== -1 ? resourceExt.substr(0, queryStringLocation) : resourceExt;

		return {
			mimeType: new TelemetryTrustedValue(getMimeTypes(resource).join(', ')),
			scheme: resource.scheme,
			ext: resourceExt,
			path: hash(path)
		};
	}

	private toEditorTelemetryDescriptor(editor: EditorInput): ITelemetryData {
		const descriptor = editor.getTelemetryDescriptor();

		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH });
		if (URI.isUri(resource)) {
			descriptor['resource'] = this.toResourceTelemetryDescriptor(resource);

			return descriptor;
		} else if (resource) {
			if (resource.primary) {
				descriptor['resource'] = this.toResourceTelemetryDescriptor(resource.primary);
			}
			if (resource.secondary) {
				descriptor['resourceSecondary'] = this.toResourceTelemetryDescriptor(resource.secondary);
			}
			return descriptor;
		}

		return descriptor;
	}

	private onWillDisposeEditor(editor: EditorInput): void {

		this.disposedEditorsWorker.work(editor);
	}

	private handleDisposedEditors(disposedEditors: EditorInput[]): void {

		let activeEditor: EditorInput | undefined;
		const inactiveEditors: EditorInput[] = [];
		for (const disposedEditor of disposedEditors) {
			const editorFindResult = this.model.findEditor(disposedEditor);
			if (!editorFindResult) {
				continue;
			}

			const editor = editorFindResult[0];
			if (!editor.isDisposed()) {
				continue;
			}

			if (this.model.isActive(editor)) {
				activeEditor = editor;
			} else {
				inactiveEditors.push(editor);
			}
		}

		for (const inactiveEditor of inactiveEditors) {
			this.doCloseEditor(inactiveEditor, true);
		}

		if (activeEditor) {
			this.doCloseEditor(activeEditor, true);
		}
	}

	private onDidChangeEditorPartOptions(event: IEditorPartOptionsChangeEvent): void {

		this.updateTitleContainer();

		this.titleControl.updateOptions(event.oldPartOptions, event.newPartOptions);

		if (
			event.oldPartOptions.showTabs !== event.newPartOptions.showTabs ||
			event.oldPartOptions.tabHeight !== event.newPartOptions.tabHeight ||
			(event.oldPartOptions.showTabs === 'multiple' && event.oldPartOptions.pinnedTabsOnSeparateRow !== event.newPartOptions.pinnedTabsOnSeparateRow)
		) {

			this.relayout();

			if (this.model.activeEditor) {
				this.titleControl.openEditors(this.model.getEditors(EditorsOrder.SEQUENTIAL));
			}
		}

		this.updateStyles();

		if (event.oldPartOptions.enablePreview && !event.newPartOptions.enablePreview) {
			if (this.model.previewEditor) {
				this.pinEditor(this.model.previewEditor);
			}
		}
	}

	private onDidChangeEditorDirty(editor: EditorInput): void {

		this.pinEditor(editor);

		this.titleControl.updateEditorDirty(editor);
	}

	private onDidChangeEditorTransient(editor: EditorInput): void {
		const transient = this.model.isTransient(editor);

		if (!transient && !this.groupsView.partOptions.enablePreview) {
			this.pinEditor(editor);
		}
	}

	private onDidChangeEditorLabel(editor: EditorInput): void {

		this.titleControl.updateEditorLabel(editor);
	}

	private onDidChangeEditorCapabilities(editor: EditorInput): void {
		this.titleControl.updateEditorCapabilities(editor);
	}

	private onDidChangeEditorSelection(): void {

		this.titleControl.updateEditorSelections();
	}

	private onDidVisibilityChange(visible: boolean): void {

		this.editorPane.setVisible(visible);
	}

	private onDidGainFocus(): void {
		if (this.activeEditor) {


			this.model.setTransient(this.activeEditor, false);
		}
	}



	get index(): number {
		return this._index;
	}

	get label(): string {
		if (this.groupsLabel) {
			return localize('groupLabelLong', "{0}: Group {1}", this.groupsLabel, this._index + 1);
		}

		return localize('groupLabel', "Group {0}", this._index + 1);
	}

	get ariaLabel(): string {
		if (this.groupsLabel) {
			return localize('groupAriaLabelLong', "{0}: Editor Group {1}", this.groupsLabel, this._index + 1);
		}

		return localize('groupAriaLabel', "Editor Group {0}", this._index + 1);
	}

	private _disposed = false;
	get disposed(): boolean {
		return this._disposed;
	}

	get isEmpty(): boolean {
		return this.count === 0;
	}

	get titleHeight(): IEditorGroupTitleHeight {
		return this.titleControl.getHeight();
	}

	notifyIndexChanged(newIndex: number): void {
		if (this._index !== newIndex) {
			this._index = newIndex;
			this.model.setIndex(newIndex);
		}
	}

	notifyLabelChanged(newLabel: string): void {
		if (this.groupsLabel !== newLabel) {
			this.groupsLabel = newLabel;
			this.model.setLabel(newLabel);
		}
	}

	setActive(isActive: boolean): void {
		this.active = isActive;

		if (!isActive && this.activeEditor && this.selectedEditors.length > 1) {
			this.setSelection(this.activeEditor, []);
		}

		this.element.classList.toggle('active', isActive);
		this.element.classList.toggle('inactive', !isActive);

		this.titleControl.setActive(isActive);

		this.updateStyles();

		this.model.setActive(undefined );
	}



	get id(): GroupIdentifier {
		return this.model.id;
	}

	get windowId(): number {
		return this.groupsView.windowId;
	}

	get editors(): EditorInput[] {
		return this.model.getEditors(EditorsOrder.SEQUENTIAL);
	}

	get count(): number {
		return this.model.count;
	}

	get stickyCount(): number {
		return this.model.stickyCount;
	}

	get editorPaneContainer(): HTMLElement {
		return this.editorContainer;
	}

	get activeEditorPane(): IVisibleEditorPane | undefined {
		return this.editorPane ? this.editorPane.activeEditorPane ?? undefined : undefined;
	}

	get activeEditor(): EditorInput | null {
		return this.model.activeEditor;
	}

	get selectedEditors(): EditorInput[] {
		return this.model.selectedEditors;
	}

	get previewEditor(): EditorInput | null {
		return this.model.previewEditor;
	}

	isPinned(editorOrIndex: EditorInput | number): boolean {
		return this.model.isPinned(editorOrIndex);
	}

	isSticky(editorOrIndex: EditorInput | number): boolean {
		return this.model.isSticky(editorOrIndex);
	}

	isSelected(editor: EditorInput): boolean {
		return this.model.isSelected(editor);
	}

	isTransient(editorOrIndex: EditorInput | number): boolean {
		return this.model.isTransient(editorOrIndex);
	}

	isActive(editor: EditorInput | IUntypedEditorInput): boolean {
		return this.model.isActive(editor);
	}

	async setSelection(activeSelectedEditor: EditorInput, inactiveSelectedEditors: EditorInput[]): Promise<void> {
		if (!this.isActive(activeSelectedEditor)) {
			await this.openEditor(activeSelectedEditor, { activation: EditorActivation.ACTIVATE }, { inactiveSelection: inactiveSelectedEditors });
		} else {
			this.model.setSelection(activeSelectedEditor, inactiveSelectedEditors);
		}
	}

	contains(candidate: EditorInput | IUntypedEditorInput, options?: IMatchEditorOptions): boolean {
		return this.model.contains(candidate, options);
	}

	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): EditorInput[] {
		return this.model.getEditors(order, options);
	}

	findEditors(resource: URI, options?: IFindEditorOptions): EditorInput[] {
		const canonicalResource = this.uriIdentityService.asCanonicalUri(resource);
		return this.getEditors(options?.order ?? EditorsOrder.SEQUENTIAL).filter(editor => {
			if (editor.resource && isEqual(editor.resource, canonicalResource)) {
				return true;
			}

			if (options?.supportSideBySide === SideBySideEditor.PRIMARY || options?.supportSideBySide === SideBySideEditor.ANY) {
				const primaryResource = EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
				if (primaryResource && isEqual(primaryResource, canonicalResource)) {
					return true;
				}
			}

			if (options?.supportSideBySide === SideBySideEditor.SECONDARY || options?.supportSideBySide === SideBySideEditor.ANY) {
				const secondaryResource = EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.SECONDARY });
				if (secondaryResource && isEqual(secondaryResource, canonicalResource)) {
					return true;
				}
			}

			return false;
		});
	}

	getEditorByIndex(index: number): EditorInput | undefined {
		return this.model.getEditorByIndex(index);
	}

	getIndexOfEditor(editor: EditorInput): number {
		return this.model.indexOf(editor);
	}

	isFirst(editor: EditorInput): boolean {
		return this.model.isFirst(editor);
	}

	isLast(editor: EditorInput): boolean {
		return this.model.isLast(editor);
	}

	focus(): void {

		if (this.activeEditorPane) {
			this.activeEditorPane.focus();
		} else {
			this.element.focus();
		}

		this._onDidFocus.fire();
	}

	pinEditor(candidate: EditorInput | undefined = this.activeEditor || undefined): void {
		if (candidate && !this.model.isPinned(candidate)) {

			const editor = this.model.pin(candidate);

			if (editor) {
				this.titleControl.pinEditor(editor);
			}
		}
	}

	stickEditor(candidate: EditorInput | undefined = this.activeEditor || undefined): void {
		this.doStickEditor(candidate, true);
	}

	unstickEditor(candidate: EditorInput | undefined = this.activeEditor || undefined): void {
		this.doStickEditor(candidate, false);
	}

	private doStickEditor(candidate: EditorInput | undefined, sticky: boolean): void {
		if (candidate && this.model.isSticky(candidate) !== sticky) {
			const oldIndexOfEditor = this.getIndexOfEditor(candidate);

			const editor = sticky ? this.model.stick(candidate) : this.model.unstick(candidate);
			if (!editor) {
				return;
			}

			const newIndexOfEditor = this.getIndexOfEditor(editor);
			if (newIndexOfEditor !== oldIndexOfEditor) {
				this.titleControl.moveEditor(editor, oldIndexOfEditor, newIndexOfEditor, true);
			}

			if (sticky) {
				this.titleControl.stickEditor(editor);
			} else {
				this.titleControl.unstickEditor(editor);
			}
		}
	}



	async openEditor(editor: EditorInput, options?: IEditorOptions, internalOptions?: IInternalEditorOpenOptions): Promise<IEditorPane | undefined> {
		return this.doOpenEditor(editor, options, {
			...internalOptions,
			supportSideBySide: SideBySideEditor.BOTH
		});
	}

	private async doOpenEditor(editor: EditorInput, options?: IEditorOptions, internalOptions?: IInternalEditorOpenOptions): Promise<IEditorPane | undefined> {

		if (!editor || editor.isDisposed()) {
			return;
		}

		this._onWillOpenEditor.fire({ editor, groupId: this.id });

		const pinned = options?.sticky
			|| (!this.groupsView.partOptions.enablePreview && !options?.transient)
			|| editor.isDirty()
			|| (options?.pinned ?? typeof options?.index === 'number' )
			|| (typeof options?.index === 'number' && this.model.isSticky(options.index))
			|| editor.hasCapability(EditorInputCapabilities.Scratchpad);
		const openEditorOptions: IEditorOpenOptions = {
			index: options ? options.index : undefined,
			pinned,
			sticky: options?.sticky || (typeof options?.index === 'number' && this.model.isSticky(options.index)),
			transient: !!options?.transient,
			inactiveSelection: internalOptions?.inactiveSelection,
			active: this.count === 0 || !options?.inactive,
			supportSideBySide: internalOptions?.supportSideBySide
		};

		if (!openEditorOptions.active && !openEditorOptions.pinned && this.model.activeEditor && !this.model.isPinned(this.model.activeEditor)) {
			openEditorOptions.active = true;
		}

		let activateGroup = false;
		let restoreGroup = false;

		if (options?.activation === EditorActivation.ACTIVATE) {
			activateGroup = true;
		} else if (options?.activation === EditorActivation.RESTORE) {
			restoreGroup = true;
		} else if (options?.activation === EditorActivation.PRESERVE) {
			activateGroup = false;
			restoreGroup = false;
		} else if (openEditorOptions.active) {
			activateGroup = !options?.preserveFocus;
			restoreGroup = !activateGroup;
		}

		if (typeof openEditorOptions.index === 'number') {
			const indexOfEditor = this.model.indexOf(editor);
			if (indexOfEditor !== -1 && indexOfEditor !== openEditorOptions.index) {
				this.doMoveEditorInsideGroup(editor, openEditorOptions);
			}
		}

		const { editor: openedEditor, isNew } = this.model.openEditor(editor, openEditorOptions);

		if (
			isNew &&
			this.count === 1 &&
			this.editorPartsView.groups.length > 1
		) {
			if (openedEditor.editorId && this.groupsView.partOptions.autoLockGroups?.has(openedEditor.editorId)) {
				this.lock(true);
			}
		}

		const showEditorResult = this.doShowEditor(openedEditor, { active: !!openEditorOptions.active, isNew }, options, internalOptions);

		if (activateGroup) {
			this.groupsView.activateGroup(this);
		} else if (restoreGroup) {
			this.groupsView.restoreGroup(this);
		}

		return showEditorResult;
	}

	private doShowEditor(editor: EditorInput, context: { active: boolean; isNew: boolean }, options?: IEditorOptions, internalOptions?: IInternalEditorOpenOptions): Promise<IEditorPane | undefined> {

		let openEditorPromise: Promise<IEditorPane | undefined>;
		if (context.active) {
			openEditorPromise = (async () => {
				const { pane, changed, cancelled, error } = await this.editorPane.openEditor(editor, options, internalOptions, { newInGroup: context.isNew });

				if (cancelled) {
					return undefined;
				}

				if (changed) {
					this._onDidActiveEditorChange.fire({ editor, isExplicit: options?.isExplicit });
				}

				if (error) {
					this._onDidOpenEditorFail.fire(editor);
				}

				if (!pane && this.activeEditor === editor) {
					this.doCloseEditor(editor, options?.preserveFocus, { fromError: true });
				}

				return pane;
			})();
		} else {
			openEditorPromise = Promise.resolve(undefined);
		}

		if (!internalOptions?.skipTitleUpdate) {
			this.titleControl.openEditor(editor, internalOptions);
		}

		return openEditorPromise;
	}



	async openEditors(editors: { editor: EditorInput; options?: IEditorOptions }[]): Promise<IEditorPane | undefined> {

		const editorsToOpen = coalesce(editors).filter(({ editor }) => !editor.isDisposed());

		const firstEditor = editorsToOpen.at(0);
		if (!firstEditor) {
			return;
		}

		const openEditorsOptions: IInternalEditorOpenOptions = {
			supportSideBySide: SideBySideEditor.BOTH
		};

		await this.doOpenEditor(firstEditor.editor, firstEditor.options, openEditorsOptions);

		const inactiveEditors = editorsToOpen.slice(1);
		const startingIndex = this.getIndexOfEditor(firstEditor.editor) + 1;
		await Promises.settled(inactiveEditors.map(({ editor, options }, index) => {
			return this.doOpenEditor(editor, {
				...options,
				inactive: true,
				pinned: true,
				index: startingIndex + index
			}, {
				...openEditorsOptions,
				skipTitleUpdate: true
			});
		}));

		this.titleControl.openEditors(inactiveEditors.map(({ editor }) => editor));

		return this.editorPane.activeEditorPane ?? undefined;
	}



	moveEditors(editors: { editor: EditorInput; options?: IEditorOptions }[], target: EditorGroupView): boolean {

		const internalOptions: IInternalMoveCopyOptions = {
			skipTitleUpdate: this !== target
		};

		let moveFailed = false;

		const movedEditors = new Set<EditorInput>();
		for (const { editor, options } of editors) {
			if (this.moveEditor(editor, target, options, internalOptions)) {
				movedEditors.add(editor);
			} else {
				moveFailed = true;
			}
		}

		if (internalOptions.skipTitleUpdate) {
			target.titleControl.openEditors(Array.from(movedEditors));
			this.titleControl.closeEditors(Array.from(movedEditors));
		}

		return !moveFailed;
	}

	moveEditor(editor: EditorInput, target: EditorGroupView, options?: IEditorOptions, internalOptions?: IInternalMoveCopyOptions): boolean {

		if (this === target) {
			this.doMoveEditorInsideGroup(editor, options);
			return true;
		}

		else {
			return this.doMoveOrCopyEditorAcrossGroups(editor, target, options, { ...internalOptions, keepCopy: false });
		}
	}

	private doMoveEditorInsideGroup(candidate: EditorInput, options?: IEditorOpenOptions): void {
		const moveToIndex = options ? options.index : undefined;
		if (typeof moveToIndex !== 'number') {
			return;
		}

		const currentIndex = this.model.indexOf(candidate);
		const editor = this.model.getEditorByIndex(currentIndex);
		if (!editor) {
			return;
		}

		if (currentIndex !== moveToIndex) {
			const oldStickyCount = this.model.stickyCount;

			this.model.moveEditor(editor, moveToIndex);
			this.model.pin(editor);

			this.titleControl.moveEditor(editor, currentIndex, moveToIndex, oldStickyCount !== this.model.stickyCount);
			this.titleControl.pinEditor(editor);
		}

		if (options?.sticky) {
			this.stickEditor(editor);
		}
	}

	private doMoveOrCopyEditorAcrossGroups(editor: EditorInput, target: EditorGroupView, openOptions?: IEditorOpenOptions, internalOptions?: IInternalMoveCopyOptions): boolean {
		const keepCopy = internalOptions?.keepCopy;

		if (!keepCopy || editor.hasCapability(EditorInputCapabilities.Singleton) ) {
			const canMoveVeto = editor.canMove(this.id, target.id);
			if (typeof canMoveVeto === 'string') {
				this.dialogService.error(canMoveVeto, localize('moveErrorDetails', "Try saving or reverting the editor first and then try again."));

				return false;
			}
		}

		const options = fillActiveEditorViewState(this, editor, {
			...openOptions,
			pinned: true,
			sticky: openOptions?.sticky ?? (!keepCopy && this.model.isSticky(editor))
		});

		if (!keepCopy) {
			this._onWillMoveEditor.fire({
				groupId: this.id,
				editor,
				target: target.id
			});
		}

		target.doOpenEditor(keepCopy ? editor.copy() : editor, options, internalOptions);

		if (!keepCopy) {
			this.doCloseEditor(editor, true , { ...internalOptions, context: EditorCloseContext.MOVE });
		}

		return true;
	}



	copyEditors(editors: { editor: EditorInput; options?: IEditorOptions }[], target: EditorGroupView): void {

		const internalOptions: IInternalMoveCopyOptions = {
			skipTitleUpdate: this !== target
		};

		for (const { editor, options } of editors) {
			this.copyEditor(editor, target, options, internalOptions);
		}

		if (internalOptions.skipTitleUpdate) {
			const copiedEditors = editors.map(({ editor }) => editor);
			target.titleControl.openEditors(copiedEditors);
		}
	}

	copyEditor(editor: EditorInput, target: EditorGroupView, options?: IEditorOptions, internalOptions?: IInternalEditorTitleControlOptions): void {

		if (this === target) {
			this.doMoveEditorInsideGroup(editor, options);
		}

		else {
			this.doMoveOrCopyEditorAcrossGroups(editor, target, options, { ...internalOptions, keepCopy: true });
		}
	}



	async closeEditor(editor: EditorInput | undefined = this.activeEditor || undefined, options?: ICloseEditorOptions): Promise<boolean> {
		return this.doCloseEditorWithConfirmationHandling(editor, options);
	}

	private async doCloseEditorWithConfirmationHandling(editor: EditorInput | undefined = this.activeEditor || undefined, options?: ICloseEditorOptions, internalOptions?: IInternalEditorCloseOptions): Promise<boolean> {
		if (!editor) {
			return false;
		}

		if (!options?.force && !internalOptions?.force && editor.hasCapability(EditorInputCapabilities.CannotClose)) {
			return false;
		}

		const veto = await this.handleCloseConfirmation([editor]);
		if (veto) {
			return false;
		}

		this.doCloseEditor(editor, options?.preserveFocus, internalOptions);

		return true;
	}

	private doCloseEditor(editor: EditorInput, preserveFocus = (this.groupsView.activeGroup !== this), internalOptions?: IInternalEditorCloseOptions): void {

		if (!internalOptions?.skipTitleUpdate) {
			this.titleControl.beforeCloseEditor(editor);
		}

		if (this.model.isActive(editor)) {
			this.doCloseActiveEditor(preserveFocus, internalOptions);
		}

		else {
			this.doCloseInactiveEditor(editor, internalOptions);
		}

		if (!internalOptions?.skipTitleUpdate) {
			this.titleControl.closeEditor(editor);
		}
	}

	private doCloseActiveEditor(preserveFocus = (this.groupsView.activeGroup !== this), internalOptions?: IInternalEditorCloseOptions): void {
		const editorToClose = this.activeEditor;
		const restoreFocus = !preserveFocus && this.shouldRestoreFocus(this.element);

		const closeEmptyGroup = this.groupsView.partOptions.closeEmptyGroups;
		if (closeEmptyGroup && this.active && this.count === 1) {
			const mostRecentlyActiveGroups = this.groupsView.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
			const nextActiveGroup = mostRecentlyActiveGroups[1];
			if (nextActiveGroup) {
				if (restoreFocus) {
					nextActiveGroup.focus();
				} else {
					this.groupsView.activateGroup(nextActiveGroup, true);
				}
			}
		}

		if (editorToClose) {
			this.model.closeEditor(editorToClose, internalOptions?.context);
		}

		const nextActiveEditor = this.model.activeEditor;
		if (nextActiveEditor) {
			let activation: EditorActivation | undefined = undefined;
			if (preserveFocus && this.groupsView.activeGroup !== this) {
				activation = EditorActivation.PRESERVE;
			}

			const options: IEditorOptions = {
				preserveFocus,
				activation,
				ignoreError: internalOptions?.fromError
			};

			const internalEditorOpenOptions: IInternalEditorOpenOptions = {
				preserveWindowOrder: true
			};

			this.doOpenEditor(nextActiveEditor, options, internalEditorOpenOptions);
		}

		else {

			if (editorToClose) {
				this.editorPane.closeEditor(editorToClose);
			}

			if (restoreFocus && !closeEmptyGroup) {
				this.focus();
			}

			this._onDidActiveEditorChange.fire({ editor: undefined });

			if (closeEmptyGroup) {
				this.groupsView.removeGroup(this, preserveFocus);
			}
		}
	}

	private shouldRestoreFocus(target: Element): boolean {
		const activeElement = getActiveElement();
		if (activeElement === target.ownerDocument.body) {
			return true;
		}

		return isAncestor(activeElement, target);
	}

	private doCloseInactiveEditor(editor: EditorInput, internalOptions?: IInternalEditorCloseOptions): void {

		this.model.closeEditor(editor, internalOptions?.context);
	}

	private async handleCloseConfirmation(editors: EditorInput[]): Promise<boolean > {
		if (!editors.length) {
			return false;
		}

		const editor = editors.shift()!;

		let handleCloseConfirmationPromise = this.mapEditorToPendingConfirmation.get(editor);
		if (!handleCloseConfirmationPromise) {
			handleCloseConfirmationPromise = this.doHandleCloseConfirmation(editor);
			this.mapEditorToPendingConfirmation.set(editor, handleCloseConfirmationPromise);
		}

		let veto: boolean;
		try {
			veto = await handleCloseConfirmationPromise;
		} finally {
			this.mapEditorToPendingConfirmation.delete(editor);
		}

		if (veto) {
			return veto;
		}

		return this.handleCloseConfirmation(editors);
	}

	private async doHandleCloseConfirmation(editor: EditorInput, options?: { skipAutoSave: boolean }): Promise<boolean > {
		if (!this.shouldConfirmClose(editor)) {
			return false;
		}

		if (editor instanceof SideBySideEditorInput && this.model.contains(editor.primary)) {
			return false;
		}


		if (this.editorPartsView.groups.some(groupView => {
			if (groupView === this) {
				return false;
			}

			const otherGroup = groupView;
			if (otherGroup.contains(editor, { supportSideBySide: SideBySideEditor.BOTH })) {
				return true;
			}

			if (editor instanceof SideBySideEditorInput && otherGroup.contains(editor.primary)) {
				return true;
			}

			return false;
		})) {
			return false;
		}

		let confirmation = ConfirmResult.CANCEL;
		let saveReason = SaveReason.EXPLICIT;
		let autoSave = false;
		if (!editor.hasCapability(EditorInputCapabilities.Untitled) && !options?.skipAutoSave && !editor.closeHandler) {

			if (this.filesConfigurationService.getAutoSaveMode(editor).mode === AutoSaveMode.ON_FOCUS_CHANGE) {
				autoSave = true;
				confirmation = ConfirmResult.SAVE;
				saveReason = SaveReason.FOCUS_CHANGE;
			}

			else if ((isNative && (isWindows || isLinux)) && this.filesConfigurationService.getAutoSaveMode(editor).mode === AutoSaveMode.ON_WINDOW_CHANGE) {
				autoSave = true;
				confirmation = ConfirmResult.SAVE;
				saveReason = SaveReason.WINDOW_CHANGE;
			}
		}

		if (!autoSave) {

			if (!this.activeEditor?.matches(editor)) {
				await this.doOpenEditor(editor);
			}

			await this.hostService.focus(getWindow(this.element));

			let handlerDidError = false;
			if (typeof editor.closeHandler?.confirm === 'function') {
				try {
					confirmation = await editor.closeHandler.confirm([{ editor, groupId: this.id }]);
				} catch (e) {
					this.logService.error(e);
					handlerDidError = true;
				}
			}

			if (typeof editor.closeHandler?.confirm !== 'function' || handlerDidError) {
				let name: string;
				if (editor instanceof SideBySideEditorInput) {
					name = editor.primary.getName();
				} else {
					name = editor.getName();
				}

				confirmation = await this.fileDialogService.showSaveConfirm([name]);
			}
		}

		if (!editor.closeHandler && !this.shouldConfirmClose(editor)) {
			return confirmation === ConfirmResult.CANCEL;
		}

		switch (confirmation) {
			case ConfirmResult.SAVE: {
				const result = await editor.save(this.id, { reason: saveReason });
				if (!result && autoSave) {
					return this.doHandleCloseConfirmation(editor, { skipAutoSave: true });
				}

				return editor.isDirty();
			}
			case ConfirmResult.DONT_SAVE:
				try {

					await editor.revert(this.id);

					return editor.isDirty();
				} catch (error) {
					this.logService.error(error);


					await editor.revert(this.id, { soft: true });

					return editor.isDirty();
				}
			case ConfirmResult.CANCEL:
				return true;
		}
	}

	private shouldConfirmClose(editor: EditorInput): boolean {
		if (editor.closeHandler) {
			try {
				return editor.closeHandler.showConfirm();
			} catch (error) {
				this.logService.error(error);
			}
		}

		return editor.isDirty() && !editor.isSaving();
	}



	async closeEditors(args: EditorInput[] | ICloseEditorsFilter, options?: ICloseEditorOptions): Promise<boolean> {
		if (this.isEmpty) {
			return true;
		}

		const editors = this.doGetEditorsToClose(args).filter(editor => options?.force || !editor.hasCapability(EditorInputCapabilities.CannotClose));
		if (!editors.length) {
			return true;
		}

		const veto = await this.handleCloseConfirmation(editors.slice(0));
		if (veto) {
			return false;
		}

		this.doCloseEditors(editors, options);

		return true;
	}

	private doGetEditorsToClose(args: EditorInput[] | ICloseEditorsFilter): EditorInput[] {
		if (Array.isArray(args)) {
			return args;
		}

		const filter = args;
		const hasDirection = typeof filter.direction === 'number';

		let editorsToClose = this.model.getEditors(hasDirection ? EditorsOrder.SEQUENTIAL : EditorsOrder.MOST_RECENTLY_ACTIVE, filter);

		if (filter.savedOnly) {
			editorsToClose = editorsToClose.filter(editor => !editor.isDirty() || editor.isSaving());
		}

		else if (hasDirection && filter.except) {
			editorsToClose = (filter.direction === CloseDirection.LEFT) ?
				editorsToClose.slice(0, this.model.indexOf(filter.except, editorsToClose)) :
				editorsToClose.slice(this.model.indexOf(filter.except, editorsToClose) + 1);
		}

		else if (filter.except) {
			editorsToClose = editorsToClose.filter(editor => filter.except && !editor.matches(filter.except));
		}

		return editorsToClose;
	}

	private doCloseEditors(editors: EditorInput[], options?: ICloseEditorOptions): void {

		let closeActiveEditor = false;
		for (const editor of editors) {
			if (!this.isActive(editor)) {
				this.doCloseInactiveEditor(editor);
			} else {
				closeActiveEditor = true;
			}
		}

		if (closeActiveEditor) {
			this.doCloseActiveEditor(options?.preserveFocus);
		}

		if (editors.length) {
			this.titleControl.closeEditors(editors);
		}
	}



	closeAllEditors(options: { excludeConfirming: true; force?: boolean }): boolean;
	closeAllEditors(options?: ICloseAllEditorsOptions): Promise<boolean>;
	closeAllEditors(options?: ICloseAllEditorsOptions): boolean | Promise<boolean> {
		if (this.isEmpty) {

			if (this.groupsView.partOptions.closeEmptyGroups) {
				this.groupsView.removeGroup(this);
			}

			return true;
		}

		if (options?.excludeConfirming) {
			this.doCloseAllEditors(options);
			return true;
		}

		const editors = this.model.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, options).filter(editor => options?.force || !editor.hasCapability(EditorInputCapabilities.CannotClose));
		if (!editors.length) {
			return true;
		}

		return this.handleCloseConfirmation(editors).then(veto => {
			if (veto) {
				return false;
			}

			this.doCloseAllEditors(options);
			return true;
		});
	}

	private doCloseAllEditors(options?: ICloseAllEditorsOptions): void {
		let editors = this.model.getEditors(EditorsOrder.SEQUENTIAL, options).filter(editor => options?.force || !editor.hasCapability(EditorInputCapabilities.CannotClose));
		if (options?.excludeConfirming) {
			editors = editors.filter(editor => !this.shouldConfirmClose(editor));
		}

		const editorsToClose: EditorInput[] = [];
		for (const editor of editors) {
			if (!this.isActive(editor)) {
				this.doCloseInactiveEditor(editor);
			}

			editorsToClose.push(editor);
		}

		if (this.activeEditor && editorsToClose.includes(this.activeEditor)) {
			this.doCloseActiveEditor();
		}

		if (editorsToClose.length) {
			this.titleControl.closeEditors(editorsToClose);
		}
	}



	async replaceEditors(editors: EditorReplacement[]): Promise<void> {

		let activeReplacement: EditorReplacement | undefined;
		const inactiveReplacements: EditorReplacement[] = [];
		for (let { editor, replacement, forceReplaceDirty, options } of editors) {
			const index = this.getIndexOfEditor(editor);
			if (index >= 0) {
				const isActiveEditor = this.isActive(editor);

				if (options) {
					options.index = index;
				} else {
					options = { index };
				}

				options.inactive = !isActiveEditor;
				options.pinned = options.pinned ?? true;

				const editorToReplace = { editor, replacement, forceReplaceDirty, options };
				if (isActiveEditor) {
					activeReplacement = editorToReplace;
				} else {
					inactiveReplacements.push(editorToReplace);
				}
			}
		}

		for (const { editor, replacement, forceReplaceDirty, options } of inactiveReplacements) {

			await this.doOpenEditor(replacement, options);

			if (!editor.matches(replacement)) {
				let closed = false;
				if (forceReplaceDirty) {
					this.doCloseEditor(editor, true, { context: EditorCloseContext.REPLACE });
					closed = true;
				} else {
					closed = await this.doCloseEditorWithConfirmationHandling(editor, { preserveFocus: true }, { context: EditorCloseContext.REPLACE, force: true });
				}

				if (!closed) {
					return;
				}
			}
		}

		if (activeReplacement) {

			const openEditorResult = this.doOpenEditor(activeReplacement.replacement, activeReplacement.options);

			if (!activeReplacement.editor.matches(activeReplacement.replacement)) {
				if (activeReplacement.forceReplaceDirty) {
					this.doCloseEditor(activeReplacement.editor, true, { context: EditorCloseContext.REPLACE });
				} else {
					await this.doCloseEditorWithConfirmationHandling(activeReplacement.editor, { preserveFocus: true }, { context: EditorCloseContext.REPLACE, force: true });
				}
			}

			await openEditorResult;
		}
	}



	get isLocked(): boolean {
		return this.model.isLocked;
	}

	lock(locked: boolean): void {
		this.model.lock(locked);
	}



	createEditorActions(disposables: DisposableStore, menuId = MenuId.EditorTitle): IActiveEditorActions {
		let actions: PrimaryAndSecondaryActions = { primary: [], secondary: [] };
		let onDidChange: Event<IMenuChangeEvent | void> | undefined;

		const activeEditorPane = this.activeEditorPane;
		if (activeEditorPane instanceof EditorPane) {
			const editorScopedContextKeyService = activeEditorPane.scopedContextKeyService ?? this.scopedContextKeyService;
			const editorTitleMenu = disposables.add(this.menuService.createMenu(menuId, editorScopedContextKeyService, { emitEventsForSubmenuChanges: true, eventDebounceDelay: 0 }));
			onDidChange = editorTitleMenu.onDidChange;

			const shouldInlineGroup = (action: SubmenuAction, group: string) => group === 'navigation' && action.actions.length <= 1;

			actions = getActionBarActions(
				editorTitleMenu.getActions({ arg: this.resourceContext.get(), shouldForwardArgs: true, renderShortTitle: true }),
				'navigation',
				shouldInlineGroup
			);

			if (menuId === MenuId.EditorTitle) {
				const available = getAvailableEditorTypes(this.activeEditor, this.editorResolverService);
				if (available) {
					const editorTypeActions = createEditorTypeActions(available, this.editorResolverService, this.commandService, this.editorService);
					const reopenWithSubmenu = new SubmenuAction('editor.reopenWith', localize('reopenWith', "Reopen Editor With"), editorTypeActions);
					if (actions.secondary.length) {
						actions.secondary.push(new Separator());
					}
					actions.secondary.push(reopenWithSubmenu);
				}
			}
		} else {
			const onDidChangeEmitter = disposables.add(new Emitter<void>());
			onDidChange = onDidChangeEmitter.event;
			disposables.add(this.onDidActiveEditorChange(() => onDidChangeEmitter.fire()));
		}

		return { actions, onDidChange };
	}



	override updateStyles(): void {
		const isEmpty = this.isEmpty;

		if (isEmpty) {
			this.element.style.backgroundColor = this.getColor(EDITOR_GROUP_EMPTY_BACKGROUND) || '';
		} else {
			this.element.style.backgroundColor = '';
		}

		const borderColor = this.getColor(EDITOR_GROUP_HEADER_BORDER) || this.getColor(contrastBorder);
		if (!isEmpty && borderColor) {
			this.titleContainer.classList.add('title-border-bottom');
			this.titleContainer.style.setProperty('--title-border-bottom-color', borderColor);
		} else {
			this.titleContainer.classList.remove('title-border-bottom');
			this.titleContainer.style.removeProperty('--title-border-bottom-color');
		}

		const { showTabs } = this.groupsView.partOptions;
		this.titleContainer.style.backgroundColor = this.getColor(showTabs === 'multiple' ? EDITOR_GROUP_HEADER_TABS_BACKGROUND : EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND) || '';

		this.editorContainer.style.backgroundColor = this.getColor(editorBackground) || '';
	}



	readonly element: HTMLElement = $('div');

	get minimumWidth(): number { return this.editorPane.minimumWidth; }
	get minimumHeight(): number { return this.editorPane.minimumHeight; }
	get maximumWidth(): number { return this.editorPane.maximumWidth; }
	get maximumHeight(): number { return this.editorPane.maximumHeight; }

	get proportionalLayout(): boolean {
		if (!this.lastLayout) {
			return true;
		}

		return !(this.lastLayout.width === this.minimumWidth || this.lastLayout.height === this.minimumHeight);
	}

	private _onDidChange = this._register(new Relay<{ width: number; height: number } | undefined>());
	readonly onDidChange = this._onDidChange.event;

	layout(width: number, height: number, top: number, left: number): void {
		this.lastLayout = { width, height, top, left };
		this.element.classList.toggle('max-height-478px', height <= 478);

		const titleControlSize = this.titleControl.layout({
			container: new Dimension(width, height),
			available: new Dimension(width, height - this.editorPane.minimumHeight)
		});

		this.progressBar.getContainer().style.top = `${Math.max(this.titleHeight.offset - 2, 0)}px`;

		const contentWidth = Math.max(0, width - this._contentRightInset);
		const editorHeight = Math.max(0, height - titleControlSize.height);
		this.editorContainer.style.width = `${contentWidth}px`;
		this.editorContainer.style.height = `${editorHeight}px`;
		this.editorPane.layout({ width: contentWidth, height: editorHeight, top: top + titleControlSize.height, left });
	}

	setContentRightInset(inset: number): void {
		const next = Math.max(0, Math.round(inset));
		if (next === this._contentRightInset) {
			return;
		}
		this._contentRightInset = next;
		this.relayout();
	}

	relayout(): void {
		if (this.lastLayout) {
			const { width, height, top, left } = this.lastLayout;
			this.layout(width, height, top, left);
			this._onDidRelayout.fire();
		}
	}

	setBoundarySashes(sashes: IBoundarySashes): void {
		this.editorPane.setBoundarySashes(sashes);
	}

	toJSON(): ISerializedEditorGroupModel {
		return this.model.serialize();
	}


	override dispose(): void {
		this._disposed = true;

		this._onWillDispose.fire();

		super.dispose();
	}
}

export interface EditorReplacement extends IEditorReplacement {
	readonly editor: EditorInput;
	readonly replacement: EditorInput;
	readonly options?: IEditorOptions;
}
