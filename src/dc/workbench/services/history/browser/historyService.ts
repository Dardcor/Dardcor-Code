/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { IResourceEditorInput, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEditorPane, IEditorCloseEvent, EditorResourceAccessor, IEditorIdentifier, GroupIdentifier, EditorsOrder, SideBySideEditor, IUntypedEditorInput, isResourceEditorInput, isEditorInput, isSideBySideEditorInput, EditorCloseContext, IEditorPaneSelection, EditorPaneSelectionCompareResult, EditorPaneSelectionChangeReason, isEditorPaneWithSelection, IEditorPaneSelectionChangeEvent, IEditorPaneWithSelection, IEditorWillMoveEvent, GroupModelChangeKind } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { GoFilter, GoScope, IHistoryService, MOUSE_BACK_FORWARD_NAVIGATION_SETTING } from '../common/history.js';
import { FileChangesEvent, IFileService, FileChangeType, FILES_EXCLUDE_CONFIG, FileOperationEvent, FileOperation } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Disposable, DisposableStore, IDisposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorGroup, IEditorGroupsService } from '../../editor/common/editorGroupsService.js';
import { getExcludes, ISearchConfiguration, SEARCH_EXCLUDE_CONFIG } from '../../search/common/search.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorServiceImpl } from '../../../browser/parts/editor/editor.js';
import { IWorkbenchLayoutService } from '../../layout/browser/layoutService.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { coalesce } from '../../../../base/common/arrays.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { addDisposableListener, EventType, EventHelper, WindowIdleValue } from '../../../../base/browser/dom.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { Schemas } from '../../../../base/common/network.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { ResourceGlobMatcher } from '../../../common/resources.js';
import { IPathService } from '../../path/common/pathService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { ILifecycleService, LifecyclePhase } from '../../lifecycle/common/lifecycle.js';
import { ILogService, LogLevel } from '../../../../platform/log/common/log.js';
import { mainWindow } from '../../../../base/browser/window.js';

interface ISerializedEditorHistoryEntry {
	readonly editor: Omit<IResourceEditorInput, 'resource'> & { resource: string };
}

interface IRecentlyClosedEditor {
	readonly editorId: string | undefined;
	readonly editor: IUntypedEditorInput;

	readonly resource: URI | undefined;
	readonly associatedResources: URI[];

	readonly index: number;
	readonly sticky: boolean;

	readonly batchId: number;
}

export class HistoryService extends Disposable implements IHistoryService {

	declare readonly _serviceBrand: undefined;

	private static readonly NAVIGATION_SCOPE_SETTING = 'workbench.editor.navigationScope';

	private readonly activeEditorListeners = this._register(new DisposableStore());
	private lastActiveEditor: IEditorIdentifier | undefined = undefined;

	private readonly editorHelper: EditorHelper;

	constructor(
		@IEditorService private readonly editorService: EditorServiceImpl,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.editorHelper = this.instantiationService.createInstance(EditorHelper);

		this.canNavigateBackContextKey = (new RawContextKey<boolean>('canNavigateBack', false, localize('canNavigateBack', "Whether it is possible to navigate back in editor history"))).bindTo(this.contextKeyService);
		this.canNavigateForwardContextKey = (new RawContextKey<boolean>('canNavigateForward', false, localize('canNavigateForward', "Whether it is possible to navigate forward in editor history"))).bindTo(this.contextKeyService);

		this.canNavigateBackInNavigationsContextKey = (new RawContextKey<boolean>('canNavigateBackInNavigationLocations', false, localize('canNavigateBackInNavigationLocations', "Whether it is possible to navigate back in editor navigation locations history"))).bindTo(this.contextKeyService);
		this.canNavigateForwardInNavigationsContextKey = (new RawContextKey<boolean>('canNavigateForwardInNavigationLocations', false, localize('canNavigateForwardInNavigationLocations', "Whether it is possible to navigate forward in editor navigation locations history"))).bindTo(this.contextKeyService);
		this.canNavigateToLastNavigationLocationContextKey = (new RawContextKey<boolean>('canNavigateToLastNavigationLocation', false, localize('canNavigateToLastNavigationLocation', "Whether it is possible to navigate to the last editor navigation location"))).bindTo(this.contextKeyService);

		this.canNavigateBackInEditsContextKey = (new RawContextKey<boolean>('canNavigateBackInEditLocations', false, localize('canNavigateBackInEditLocations', "Whether it is possible to navigate back in editor edit locations history"))).bindTo(this.contextKeyService);
		this.canNavigateForwardInEditsContextKey = (new RawContextKey<boolean>('canNavigateForwardInEditLocations', false, localize('canNavigateForwardInEditLocations', "Whether it is possible to navigate forward in editor edit locations history"))).bindTo(this.contextKeyService);
		this.canNavigateToLastEditLocationContextKey = (new RawContextKey<boolean>('canNavigateToLastEditLocation', false, localize('canNavigateToLastEditLocation', "Whether it is possible to navigate to the last editor edit location"))).bindTo(this.contextKeyService);

		this.canReopenClosedEditorContextKey = (new RawContextKey<boolean>('canReopenClosedEditor', false, localize('canReopenClosedEditor', "Whether it is possible to reopen the last closed editor"))).bindTo(this.contextKeyService);

		this.registerListeners();

		if (this.editorService.activeEditorPane) {
			this.onDidActiveEditorChange();
		}
	}

	private registerListeners(): void {

		this.registerMouseNavigationListener();

		this._register(this.editorService.onDidActiveEditorChange(() => this.onDidActiveEditorChange()));
		this._register(this.editorService.onDidOpenEditorFail(event => this.remove(event.editor)));
		this._register(this.editorService.onDidCloseEditor(event => this.onDidCloseEditor(event)));
		this._register(this.editorService.onDidMostRecentlyActiveEditorsChange(() => this.handleEditorEventInRecentEditorsStack()));

		this._register(this.editorGroupService.onDidRemoveGroup(e => this.onDidRemoveGroup(e)));

		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
		this._register(this.fileService.onDidRunOperation(event => this.onDidFilesChange(event)));

		this._register(this.storageService.onWillSaveState(() => this.saveState()));

		this.registerEditorNavigationScopeChangeListener();

		this._register(this.onDidChangeEditorNavigationStack(() => this.updateContextKeys()));
		this._register(this.editorGroupService.onDidChangeActiveGroup(() => this.updateContextKeys()));
	}

	private onDidCloseEditor(e: IEditorCloseEvent): void {
		this.handleEditorCloseEventInHistory(e);
		this.handleEditorCloseEventInReopen(e);
	}

	private registerMouseNavigationListener(): void {
		const mouseBackForwardSupportListener = this._register(new DisposableStore());
		const handleMouseBackForwardSupport = () => {
			mouseBackForwardSupportListener.clear();

			if (this.configurationService.getValue(MOUSE_BACK_FORWARD_NAVIGATION_SETTING)) {
				this._register(Event.runAndSubscribe(this.layoutService.onDidAddContainer, ({ container, disposables }) => {
					const eventDisposables = disposables.add(new DisposableStore());
					eventDisposables.add(addDisposableListener(container, EventType.MOUSE_DOWN, e => this.onMouseDownOrUp(e, true)));
					eventDisposables.add(addDisposableListener(container, EventType.MOUSE_UP, e => this.onMouseDownOrUp(e, false)));

					mouseBackForwardSupportListener.add(eventDisposables);
				}, { container: this.layoutService.mainContainer, disposables: this._store }));
			}
		};

		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(MOUSE_BACK_FORWARD_NAVIGATION_SETTING)) {
				handleMouseBackForwardSupport();
			}
		}));

		handleMouseBackForwardSupport();
	}

	private onMouseDownOrUp(event: MouseEvent, isMouseDown: boolean): void {


		switch (event.button) {
			case 3:
				EventHelper.stop(event);
				if (isMouseDown) {
					this.goBack();
				}
				break;
			case 4:
				EventHelper.stop(event);
				if (isMouseDown) {
					this.goForward();
				}

				break;
		}
	}

	private onDidRemoveGroup(group: IEditorGroup): void {
		this.handleEditorGroupRemoveInNavigationStacks(group);
	}

	private onDidActiveEditorChange(): void {
		const activeEditorGroup = this.editorGroupService.activeGroup;
		const activeEditorPane = activeEditorGroup.activeEditorPane;

		if (this.lastActiveEditor && this.editorHelper.matchesEditorIdentifier(this.lastActiveEditor, activeEditorPane)) {
			return;
		}

		this.lastActiveEditor = activeEditorPane?.input ? { editor: activeEditorPane.input, groupId: activeEditorPane.group.id } : undefined;

		this.activeEditorListeners.clear();

		if (!activeEditorPane?.group.isTransient(activeEditorPane.input)) {
			this.handleActiveEditorChange(activeEditorGroup, activeEditorPane);
		} else {
			this.logService.trace(`[History]: ignoring transient editor change until becoming non-transient (editor: ${activeEditorPane.input?.resource?.toString()}})`);

			const transientListener = activeEditorGroup.onDidModelChange(e => {
				if (e.kind === GroupModelChangeKind.EDITOR_TRANSIENT && e.editor === activeEditorPane.input && !activeEditorPane.group.isTransient(activeEditorPane.input)) {
					transientListener.dispose();

					this.handleActiveEditorChange(activeEditorGroup, activeEditorPane);
				}
			});

			this.activeEditorListeners.add(transientListener);
		}

		if (isEditorPaneWithSelection(activeEditorPane)) {
			this.activeEditorListeners.add(activeEditorPane.onDidChangeSelection(e => {
				if (!activeEditorPane.group.isTransient(activeEditorPane.input)) {
					this.handleActiveEditorSelectionChangeEvent(activeEditorGroup, activeEditorPane, e);
				} else {
					this.logService.trace(`[History]: ignoring transient editor selection change (editor: ${activeEditorPane.input?.resource?.toString()}})`);
				}
			}));
		}

		this.updateContextKeys();
	}

	private onDidFilesChange(event: FileChangesEvent | FileOperationEvent): void {

		if (event instanceof FileChangesEvent) {
			if (event.gotDeleted()) {
				this.remove(event);
			}
		}

		else {

			if (event.isOperation(FileOperation.DELETE)) {
				this.remove(event);
			}

			else if (event.isOperation(FileOperation.MOVE) && event.target.isFile) {
				this.move(event);
			}
		}
	}

	private handleActiveEditorChange(group: IEditorGroup, editorPane?: IEditorPane): void {
		this.handleActiveEditorChangeInHistory(editorPane);
		this.handleActiveEditorChangeInNavigationStacks(group, editorPane);
	}

	private handleActiveEditorSelectionChangeEvent(group: IEditorGroup, editorPane: IEditorPaneWithSelection, event: IEditorPaneSelectionChangeEvent): void {
		this.handleActiveEditorSelectionChangeInNavigationStacks(group, editorPane, event);
	}

	private move(event: FileOperationEvent): void {
		this.moveInHistory(event);
		this.moveInEditorNavigationStacks(event);
	}

	private remove(editor: EditorInput): void;
	private remove(event: FileChangesEvent): void;
	private remove(event: FileOperationEvent): void;
	private remove(arg1: EditorInput | FileChangesEvent | FileOperationEvent): void {
		this.removeFromHistory(arg1);
		this.removeFromEditorNavigationStacks(arg1);
		this.removeFromRecentlyClosedEditors(arg1);
		this.removeFromRecentlyOpened(arg1);
	}

	private removeFromRecentlyOpened(arg1: EditorInput | FileChangesEvent | FileOperationEvent): void {
		let resource: URI | undefined = undefined;
		if (isEditorInput(arg1)) {
			resource = EditorResourceAccessor.getOriginalUri(arg1);
		} else if (arg1 instanceof FileChangesEvent) {
		} else {
			resource = arg1.resource;
		}

		if (resource) {
			this.workspacesService.removeRecentlyOpened([resource]);
		}
	}

	clear(): void {

		this.clearRecentlyOpened();

		this.clearEditorNavigationStacks();

		this.recentlyClosedEditors = [];

		this.updateContextKeys();
	}


	private readonly canNavigateBackContextKey: IContextKey<boolean>;
	private readonly canNavigateForwardContextKey: IContextKey<boolean>;

	private readonly canNavigateBackInNavigationsContextKey: IContextKey<boolean>;
	private readonly canNavigateForwardInNavigationsContextKey: IContextKey<boolean>;
	private readonly canNavigateToLastNavigationLocationContextKey: IContextKey<boolean>;

	private readonly canNavigateBackInEditsContextKey: IContextKey<boolean>;
	private readonly canNavigateForwardInEditsContextKey: IContextKey<boolean>;
	private readonly canNavigateToLastEditLocationContextKey: IContextKey<boolean>;

	private readonly canReopenClosedEditorContextKey: IContextKey<boolean>;

	updateContextKeys(): void {
		this.contextKeyService.bufferChangeEvents(() => {
			const activeStack = this.getStack();

			this.canNavigateBackContextKey.set(activeStack.canGoBack(GoFilter.NONE));
			this.canNavigateForwardContextKey.set(activeStack.canGoForward(GoFilter.NONE));

			this.canNavigateBackInNavigationsContextKey.set(activeStack.canGoBack(GoFilter.NAVIGATION));
			this.canNavigateForwardInNavigationsContextKey.set(activeStack.canGoForward(GoFilter.NAVIGATION));
			this.canNavigateToLastNavigationLocationContextKey.set(activeStack.canGoLast(GoFilter.NAVIGATION));

			this.canNavigateBackInEditsContextKey.set(activeStack.canGoBack(GoFilter.EDITS));
			this.canNavigateForwardInEditsContextKey.set(activeStack.canGoForward(GoFilter.EDITS));
			this.canNavigateToLastEditLocationContextKey.set(activeStack.canGoLast(GoFilter.EDITS));

			this.canReopenClosedEditorContextKey.set(this.recentlyClosedEditors.length > 0);
		});
	}



	private readonly _onDidChangeEditorNavigationStack = this._register(new Emitter<void>());
	readonly onDidChangeEditorNavigationStack = this._onDidChangeEditorNavigationStack.event;

	private defaultScopedEditorNavigationStack: IEditorNavigationStacks | undefined = undefined;
	private readonly editorGroupScopedNavigationStacks = new Map<GroupIdentifier, { stack: IEditorNavigationStacks; disposable: IDisposable }>();
	private readonly editorScopedNavigationStacks = new Map<GroupIdentifier, Map<EditorInput, { stack: IEditorNavigationStacks; disposable: IDisposable }>>();

	private editorNavigationScope = GoScope.DEFAULT;

	private registerEditorNavigationScopeChangeListener(): void {
		const handleEditorNavigationScopeChange = () => {

			this.disposeEditorNavigationStacks();

			const configuredScope = this.configurationService.getValue(HistoryService.NAVIGATION_SCOPE_SETTING);
			if (configuredScope === 'editorGroup') {
				this.editorNavigationScope = GoScope.EDITOR_GROUP;
			} else if (configuredScope === 'editor') {
				this.editorNavigationScope = GoScope.EDITOR;
			} else {
				this.editorNavigationScope = GoScope.DEFAULT;
			}
		};

		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(HistoryService.NAVIGATION_SCOPE_SETTING)) {
				handleEditorNavigationScopeChange();
			}
		}));

		handleEditorNavigationScopeChange();
	}

	private getStack(group = this.editorGroupService.activeGroup, editor = group.activeEditor): IEditorNavigationStacks {
		switch (this.editorNavigationScope) {

			case GoScope.EDITOR: {
				if (!editor) {
					return new NoOpEditorNavigationStacks();
				}

				let stacksForGroup = this.editorScopedNavigationStacks.get(group.id);
				if (!stacksForGroup) {
					stacksForGroup = new Map<EditorInput, { stack: IEditorNavigationStacks; disposable: IDisposable }>();
					this.editorScopedNavigationStacks.set(group.id, stacksForGroup);
				}

				let stack = stacksForGroup.get(editor)?.stack;
				if (!stack) {
					const disposable = new DisposableStore();

					stack = disposable.add(this.instantiationService.createInstance(EditorNavigationStacks, GoScope.EDITOR));
					disposable.add(stack.onDidChange(() => this._onDidChangeEditorNavigationStack.fire()));

					stacksForGroup.set(editor, { stack, disposable });
				}

				return stack;
			}

			case GoScope.EDITOR_GROUP: {
				let stack = this.editorGroupScopedNavigationStacks.get(group.id)?.stack;
				if (!stack) {
					const disposable = new DisposableStore();

					stack = disposable.add(this.instantiationService.createInstance(EditorNavigationStacks, GoScope.EDITOR_GROUP));
					disposable.add(stack.onDidChange(() => this._onDidChangeEditorNavigationStack.fire()));

					this.editorGroupScopedNavigationStacks.set(group.id, { stack, disposable });
				}

				return stack;
			}

			case GoScope.DEFAULT: {
				if (!this.defaultScopedEditorNavigationStack) {
					this.defaultScopedEditorNavigationStack = this._register(this.instantiationService.createInstance(EditorNavigationStacks, GoScope.DEFAULT));

					this._register(this.defaultScopedEditorNavigationStack.onDidChange(() => this._onDidChangeEditorNavigationStack.fire()));
				}

				return this.defaultScopedEditorNavigationStack;
			}
		}
	}

	goForward(filter?: GoFilter): Promise<void> {
		return this.getStack().goForward(filter);
	}

	goBack(filter?: GoFilter): Promise<void> {
		return this.getStack().goBack(filter);
	}

	goPrevious(filter?: GoFilter): Promise<void> {
		return this.getStack().goPrevious(filter);
	}

	goLast(filter?: GoFilter): Promise<void> {
		return this.getStack().goLast(filter);
	}

	private handleActiveEditorChangeInNavigationStacks(group: IEditorGroup, editorPane?: IEditorPane): void {
		this.getStack(group, editorPane?.input).handleActiveEditorChange(editorPane);
	}

	private handleActiveEditorSelectionChangeInNavigationStacks(group: IEditorGroup, editorPane: IEditorPaneWithSelection, event: IEditorPaneSelectionChangeEvent): void {
		this.getStack(group, editorPane.input).handleActiveEditorSelectionChange(editorPane, event);
	}

	private handleEditorCloseEventInHistory(e: IEditorCloseEvent): void {
		const editors = this.editorScopedNavigationStacks.get(e.groupId);
		if (editors) {
			const editorStack = editors.get(e.editor);
			if (editorStack) {
				editorStack.disposable.dispose();
				editors.delete(e.editor);
			}

			if (editors.size === 0) {
				this.editorScopedNavigationStacks.delete(e.groupId);
			}
		}
	}

	private handleEditorGroupRemoveInNavigationStacks(group: IEditorGroup): void {

		this.defaultScopedEditorNavigationStack?.remove(group.id);

		const editorGroupStack = this.editorGroupScopedNavigationStacks.get(group.id);
		if (editorGroupStack) {
			editorGroupStack.disposable.dispose();
			this.editorGroupScopedNavigationStacks.delete(group.id);
		}
	}

	private clearEditorNavigationStacks(): void {
		this.withEachEditorNavigationStack(stack => stack.clear());
	}

	private removeFromEditorNavigationStacks(arg1: EditorInput | FileChangesEvent | FileOperationEvent): void {
		this.withEachEditorNavigationStack(stack => stack.remove(arg1));
	}

	private moveInEditorNavigationStacks(event: FileOperationEvent): void {
		this.withEachEditorNavigationStack(stack => stack.move(event));
	}

	private withEachEditorNavigationStack(fn: (stack: IEditorNavigationStacks) => void): void {

		if (this.defaultScopedEditorNavigationStack) {
			fn(this.defaultScopedEditorNavigationStack);
		}

		for (const [, entry] of this.editorGroupScopedNavigationStacks) {
			fn(entry.stack);
		}

		for (const [, entries] of this.editorScopedNavigationStacks) {
			for (const [, entry] of entries) {
				fn(entry.stack);
			}
		}
	}

	private disposeEditorNavigationStacks(): void {

		this.defaultScopedEditorNavigationStack?.dispose();
		this.defaultScopedEditorNavigationStack = undefined;

		for (const [, stack] of this.editorGroupScopedNavigationStacks) {
			stack.disposable.dispose();
		}
		this.editorGroupScopedNavigationStacks.clear();

		for (const [, stacks] of this.editorScopedNavigationStacks) {
			for (const [, stack] of stacks) {
				stack.disposable.dispose();
			}
		}
		this.editorScopedNavigationStacks.clear();
	}



	private recentlyUsedEditorsStack: readonly IEditorIdentifier[] | undefined = undefined;
	private recentlyUsedEditorsStackIndex = 0;

	private recentlyUsedEditorsInGroupStack: readonly IEditorIdentifier[] | undefined = undefined;
	private recentlyUsedEditorsInGroupStackIndex = 0;

	private navigatingInRecentlyUsedEditorsStack = false;
	private navigatingInRecentlyUsedEditorsInGroupStack = false;

	openNextRecentlyUsedEditor(groupId?: GroupIdentifier): Promise<void> {
		const [stack, index] = this.ensureRecentlyUsedStack(index => index - 1, groupId);

		return this.doNavigateInRecentlyUsedEditorsStack(stack[index], groupId);
	}

	openPreviouslyUsedEditor(groupId?: GroupIdentifier): Promise<void> {
		const [stack, index] = this.ensureRecentlyUsedStack(index => index + 1, groupId);

		return this.doNavigateInRecentlyUsedEditorsStack(stack[index], groupId);
	}

	private async doNavigateInRecentlyUsedEditorsStack(editorIdentifier: IEditorIdentifier | undefined, groupId?: GroupIdentifier): Promise<void> {
		if (editorIdentifier) {
			const acrossGroups = typeof groupId !== 'number' || !this.editorGroupService.getGroup(groupId);

			if (acrossGroups) {
				this.navigatingInRecentlyUsedEditorsStack = true;
			} else {
				this.navigatingInRecentlyUsedEditorsInGroupStack = true;
			}

			const group = this.editorGroupService.getGroup(editorIdentifier.groupId) ?? this.editorGroupService.activeGroup;
			try {
				await group.openEditor(editorIdentifier.editor);
			} finally {
				if (acrossGroups) {
					this.navigatingInRecentlyUsedEditorsStack = false;
				} else {
					this.navigatingInRecentlyUsedEditorsInGroupStack = false;
				}
			}
		}
	}

	private ensureRecentlyUsedStack(indexModifier: (index: number) => number, groupId?: GroupIdentifier): [readonly IEditorIdentifier[], number] {
		let editors: readonly IEditorIdentifier[];
		let index: number;

		const group = typeof groupId === 'number' ? this.editorGroupService.getGroup(groupId) : undefined;

		if (!group) {
			editors = this.recentlyUsedEditorsStack || this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);
			index = this.recentlyUsedEditorsStackIndex;
		}

		else {
			editors = this.recentlyUsedEditorsInGroupStack || group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).map(editor => ({ groupId: group.id, editor }));
			index = this.recentlyUsedEditorsInGroupStackIndex;
		}

		let newIndex = indexModifier(index);
		if (newIndex < 0) {
			newIndex = 0;
		} else if (newIndex > editors.length - 1) {
			newIndex = editors.length - 1;
		}

		if (!group) {
			this.recentlyUsedEditorsStack = editors;
			this.recentlyUsedEditorsStackIndex = newIndex;
		} else {
			this.recentlyUsedEditorsInGroupStack = editors;
			this.recentlyUsedEditorsInGroupStackIndex = newIndex;
		}

		return [editors, newIndex];
	}

	private handleEditorEventInRecentEditorsStack(): void {

		if (!this.navigatingInRecentlyUsedEditorsStack) {
			this.recentlyUsedEditorsStack = undefined;
			this.recentlyUsedEditorsStackIndex = 0;
		}

		if (!this.navigatingInRecentlyUsedEditorsInGroupStack) {
			this.recentlyUsedEditorsInGroupStack = undefined;
			this.recentlyUsedEditorsInGroupStackIndex = 0;
		}
	}



	private static readonly MAX_RECENTLY_CLOSED_EDITORS = 20;

	private recentlyClosedEditors: IRecentlyClosedEditor[] = [];
	private ignoreEditorCloseEvent = false;

	private recentlyClosedEditorsBatchId = 0;
	private recentlyClosedEditorsBatchScheduled = false;

	private handleEditorCloseEventInReopen(event: IEditorCloseEvent): void {
		if (this.ignoreEditorCloseEvent) {
			return;
		}

		const { editor, context } = event;
		if (context === EditorCloseContext.REPLACE || context === EditorCloseContext.MOVE) {
			return;
		}

		if (!editor.canReopen()) {
			return;
		}

		const untypedEditor = editor.toUntyped();
		if (!untypedEditor) {
			return;
		}

		const associatedResources: URI[] = [];
		const editorResource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH });
		if (URI.isUri(editorResource)) {
			associatedResources.push(editorResource);
		} else if (editorResource) {
			associatedResources.push(...coalesce([editorResource.primary, editorResource.secondary]));
		}

		this.removeFromRecentlyClosedEditors(editor);

		this.recentlyClosedEditors.push({
			editorId: editor.editorId,
			editor: untypedEditor,
			resource: EditorResourceAccessor.getOriginalUri(editor),
			associatedResources,
			index: event.index,
			sticky: event.sticky,
			batchId: this.currentRecentlyClosedEditorsBatchId()
		});

		if (this.recentlyClosedEditors.length > HistoryService.MAX_RECENTLY_CLOSED_EDITORS) {
			this.recentlyClosedEditors.shift();
		}

		this.canReopenClosedEditorContextKey.set(true);
	}

	private currentRecentlyClosedEditorsBatchId(): number {

		if (!this.recentlyClosedEditorsBatchScheduled) {
			this.recentlyClosedEditorsBatchScheduled = true;
			this.recentlyClosedEditorsBatchId++;
			queueMicrotask(() => this.recentlyClosedEditorsBatchScheduled = false);
		}

		return this.recentlyClosedEditorsBatchId;
	}

	async reopenLastClosedEditor(): Promise<void> {

		const lastClosedEditors = this.takeLastClosedEditorsBatch();
		let reopenClosedEditorPromise: Promise<void> | undefined = undefined;
		if (lastClosedEditors.length) {
			reopenClosedEditorPromise = this.doReopenLastClosedEditors(lastClosedEditors);
		}

		this.canReopenClosedEditorContextKey.set(this.recentlyClosedEditors.length > 0);

		return reopenClosedEditorPromise;
	}

	private takeLastClosedEditorsBatch(): IRecentlyClosedEditor[] {
		const lastClosedEditor = this.recentlyClosedEditors.at(-1);
		if (!lastClosedEditor) {
			return [];
		}

		const batch: IRecentlyClosedEditor[] = [];
		while (this.recentlyClosedEditors.length && this.recentlyClosedEditors[this.recentlyClosedEditors.length - 1].batchId === lastClosedEditor.batchId) {
			batch.unshift(this.recentlyClosedEditors.pop()!);
		}

		return batch;
	}

	private async doReopenLastClosedEditors(lastClosedEditors: IRecentlyClosedEditor[]): Promise<void> {

		let anyReopened = false;
		for (const lastClosedEditor of lastClosedEditors) {
			const editorPane = await this.doReopenLastClosedEditor(lastClosedEditor);
			if (editorPane) {
				anyReopened = true;
			}
		}

		if (!anyReopened && this.recentlyClosedEditors.length) {
			return this.reopenLastClosedEditor();
		}
	}

	private async doReopenLastClosedEditor(lastClosedEditor: IRecentlyClosedEditor): Promise<IEditorPane | undefined> {
		const options: IEditorOptions = { pinned: true, sticky: lastClosedEditor.sticky, index: lastClosedEditor.index, ignoreError: true };

		if (
			(lastClosedEditor.sticky && !this.editorGroupService.activeGroup.isSticky(lastClosedEditor.index)) ||
			(!lastClosedEditor.sticky && this.editorGroupService.activeGroup.isSticky(lastClosedEditor.index))
		) {
			options.index = undefined;
		}

		let editorPane: IEditorPane | undefined = undefined;
		if (!this.editorGroupService.activeGroup.contains(lastClosedEditor.editor)) {


			this.ignoreEditorCloseEvent = true;
			try {
				editorPane = await this.editorService.openEditor({
					...lastClosedEditor.editor,
					options: {
						...lastClosedEditor.editor.options,
						...options
					}
				});
			} finally {
				this.ignoreEditorCloseEvent = false;
			}
		}

		return editorPane;
	}

	private removeFromRecentlyClosedEditors(arg1: EditorInput | FileChangesEvent | FileOperationEvent): void {
		this.recentlyClosedEditors = this.recentlyClosedEditors.filter(recentlyClosedEditor => {
			if (isEditorInput(arg1) && recentlyClosedEditor.editorId !== arg1.editorId) {
				return true;
			}

			if (recentlyClosedEditor.resource && this.editorHelper.matchesFile(recentlyClosedEditor.resource, arg1)) {
				return false;
			}

			if (recentlyClosedEditor.associatedResources.some(associatedResource => this.editorHelper.matchesFile(associatedResource, arg1))) {
				return false;
			}

			return true;
		});

		this.canReopenClosedEditorContextKey.set(this.recentlyClosedEditors.length > 0);
	}



	private static readonly MAX_HISTORY_ITEMS = 200;
	private static readonly HISTORY_STORAGE_KEY = 'history.entries';

	private history: Array<EditorInput | IResourceEditorInput> | undefined = undefined;

	private readonly editorHistoryListeners = this._register(new DisposableMap<EditorInput, DisposableStore>());

	private readonly resourceExcludeMatcher = this._register(new WindowIdleValue(mainWindow, () => {
		const matcher = this._register(this.instantiationService.createInstance(
			ResourceGlobMatcher,
			root => getExcludes(root ? this.configurationService.getValue<ISearchConfiguration>({ resource: root }) : this.configurationService.getValue<ISearchConfiguration>()) || Object.create(null),
			event => event.affectsConfiguration(FILES_EXCLUDE_CONFIG) || event.affectsConfiguration(SEARCH_EXCLUDE_CONFIG)
		));

		this._register(matcher.onExpressionChange(() => this.removeExcludedFromHistory()));

		return matcher;
	}));

	private handleActiveEditorChangeInHistory(editorPane?: IEditorPane): void {

		const editor = editorPane?.input;
		if (!editor || editor.isDisposed() || !this.includeInHistory(editor)) {
			return;
		}

		this.removeFromHistory(editor);
		this.addToHistory(editor);
	}

	private addToHistory(editor: EditorInput | IResourceEditorInput, insertFirst = true): void {
		this.ensureHistoryLoaded(this.history);

		const historyInput = this.editorHelper.preferResourceEditorInput(editor);
		if (!historyInput) {
			return;
		}

		if (insertFirst) {
			this.history.unshift(historyInput);
		} else {
			this.history.push(historyInput);
		}

		if (this.history.length > HistoryService.MAX_HISTORY_ITEMS) {
			this.editorHelper.clearOnEditorDispose(this.history.pop()!, this.editorHistoryListeners);
		}

		if (isEditorInput(editor)) {
			this.editorHelper.onEditorDispose(editor, () => this.updateHistoryOnEditorDispose(historyInput), this.editorHistoryListeners);
		}
	}

	private updateHistoryOnEditorDispose(editor: EditorInput | IResourceEditorInput): void {
		if (isEditorInput(editor)) {

			if (!isSideBySideEditorInput(editor)) {
				this.removeFromHistory(editor);
			}

			else {
				const resourceInputs: IResourceEditorInput[] = [];
				const sideInputs = editor.primary.matches(editor.secondary) ? [editor.primary] : [editor.primary, editor.secondary];
				for (const sideInput of sideInputs) {
					const candidateResourceInput = this.editorHelper.preferResourceEditorInput(sideInput);
					if (isResourceEditorInput(candidateResourceInput) && this.includeInHistory(candidateResourceInput)) {
						resourceInputs.push(candidateResourceInput);
					}
				}

				this.replaceInHistory(editor, ...resourceInputs);
			}
		} else {

			if (!this.includeInHistory(editor)) {
				this.removeFromHistory(editor);
			}
		}
	}

	private includeInHistory(editor: EditorInput | IResourceEditorInput): boolean {
		if (isEditorInput(editor)) {
			return true;
		}

		return !this.resourceExcludeMatcher.value.matches(editor.resource);
	}

	private removeExcludedFromHistory(): void {
		this.ensureHistoryLoaded(this.history);

		this.history = this.history.filter(entry => {
			const include = this.includeInHistory(entry);

			if (!include) {
				this.editorHelper.clearOnEditorDispose(entry, this.editorHistoryListeners);
			}

			return include;
		});
	}

	private moveInHistory(event: FileOperationEvent): void {
		if (event.isOperation(FileOperation.MOVE)) {
			const removed = this.removeFromHistory(event);
			if (removed) {
				this.addToHistory({ resource: event.target.resource });
			}
		}
	}

	removeFromHistory(arg1: EditorInput | IResourceEditorInput | FileChangesEvent | FileOperationEvent): boolean {
		let removed = false;

		this.ensureHistoryLoaded(this.history);

		this.history = this.history.filter(entry => {
			const matches = this.editorHelper.matchesEditor(arg1, entry);

			if (matches) {
				this.editorHelper.clearOnEditorDispose(arg1, this.editorHistoryListeners);
				removed = true;
			}

			return !matches;
		});

		return removed;
	}

	private replaceInHistory(editor: EditorInput | IResourceEditorInput, ...replacements: ReadonlyArray<EditorInput | IResourceEditorInput>): void {
		this.ensureHistoryLoaded(this.history);

		let replaced = false;

		const newHistory: Array<EditorInput | IResourceEditorInput> = [];
		for (const entry of this.history) {

			if (this.editorHelper.matchesEditor(editor, entry)) {

				this.editorHelper.clearOnEditorDispose(editor, this.editorHistoryListeners);

				if (!replaced) {
					newHistory.push(...replacements);
					replaced = true;
				}
			}

			else if (!replacements.some(replacement => this.editorHelper.matchesEditor(replacement, entry))) {
				newHistory.push(entry);
			}
		}

		if (!replaced) {
			newHistory.push(...replacements);
		}

		this.history = newHistory;
	}

	clearRecentlyOpened(): void {
		this.history = [];

		this.editorHistoryListeners.clearAndDisposeAll();
	}

	getHistory(): readonly (EditorInput | IResourceEditorInput)[] {
		this.ensureHistoryLoaded(this.history);

		return this.history;
	}

	private ensureHistoryLoaded(history: Array<EditorInput | IResourceEditorInput> | undefined): asserts history {
		if (!this.history) {

			this.history = [];

			if (this.editorGroupService.isReady) {
				this.loadHistory();
			} else {
				(async () => {
					await this.editorGroupService.whenReady;

					this.loadHistory();
				})();
			}
		}
	}

	private loadHistory(): void {

		this.history = [];

		const storedEditorHistory = this.loadHistoryFromStorage();

		const openedEditorsLru = [...this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)].reverse();


		const handledEditors = new Set<string >();

		for (const { editor } of openedEditorsLru) {
			if (!this.includeInHistory(editor)) {
				continue;
			}

			if (editor.resource) {
				const historyEntryId = `${editor.resource.toString()}/${editor.editorId}`;
				if (handledEditors.has(historyEntryId)) {
					continue;
				}

				handledEditors.add(historyEntryId);
			}

			this.addToHistory(editor);
		}

		for (const editor of storedEditorHistory) {
			const historyEntryId = `${editor.resource.toString()}/${editor.options?.override}`;
			if (
				!handledEditors.has(historyEntryId) &&
				this.includeInHistory(editor)
			) {
				handledEditors.add(historyEntryId);
				this.addToHistory(editor, false );
			}
		}
	}

	private loadHistoryFromStorage(): Array<IResourceEditorInput> {
		const entries: IResourceEditorInput[] = [];

		const entriesRaw = this.storageService.get(HistoryService.HISTORY_STORAGE_KEY, StorageScope.WORKSPACE);
		if (entriesRaw) {
			try {
				const entriesParsed: ISerializedEditorHistoryEntry[] = JSON.parse(entriesRaw);
				for (const entryParsed of entriesParsed) {
					if (!entryParsed.editor || !entryParsed.editor.resource) {
						continue;
					}

					try {
						entries.push({
							...entryParsed.editor,
							resource: typeof entryParsed.editor.resource === 'string' ?
								URI.parse(entryParsed.editor.resource) :
								URI.from(entryParsed.editor.resource)
						});
					} catch (error) {
						onUnexpectedError(error);
					}
				}
			} catch (error) {
				onUnexpectedError(error);
			}
		}

		return entries;
	}

	private saveState(): void {
		if (!this.history) {
			return;
		}

		const entries: ISerializedEditorHistoryEntry[] = [];
		for (const editor of this.history) {
			if (isEditorInput(editor) || !isResourceEditorInput(editor)) {
				continue;
			}

			entries.push({
				editor: {
					...editor,
					resource: editor.resource.toString()
				}
			});
		}

		this.storageService.store(HistoryService.HISTORY_STORAGE_KEY, JSON.stringify(entries), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}



	getLastActiveWorkspaceRoot(schemeFilter?: string, authorityFilter?: string): URI | undefined {

		const folders = this.contextService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}

		if (folders.length === 1) {
			const resource = folders[0].uri;
			if ((!schemeFilter || resource.scheme === schemeFilter) && (!authorityFilter || resource.authority === authorityFilter)) {
				return resource;
			}

			return undefined;
		}

		for (const input of this.getHistory()) {
			if (isEditorInput(input)) {
				continue;
			}

			if (schemeFilter && input.resource.scheme !== schemeFilter) {
				continue;
			}

			if (authorityFilter && input.resource.authority !== authorityFilter) {
				continue;
			}

			const resourceWorkspace = this.contextService.getWorkspaceFolder(input.resource);
			if (resourceWorkspace) {
				return resourceWorkspace.uri;
			}
		}

		for (const folder of folders) {
			const resource = folder.uri;
			if ((!schemeFilter || resource.scheme === schemeFilter) && (!authorityFilter || resource.authority === authorityFilter)) {
				return resource;
			}
		}

		return undefined;
	}

	getLastActiveFile(filterByScheme: string, filterByAuthority?: string): URI | undefined {
		for (const input of this.getHistory()) {
			let resource: URI | undefined;
			if (isEditorInput(input)) {
				resource = EditorResourceAccessor.getOriginalUri(input, { filterByScheme });
			} else {
				resource = input.resource;
			}

			if (resource && resource.scheme === filterByScheme && (!filterByAuthority || resource.authority === filterByAuthority)) {
				return resource;
			}
		}

		return undefined;
	}


	override dispose(): void {
		super.dispose();

		for (const [, stack] of this.editorGroupScopedNavigationStacks) {
			stack.disposable.dispose();
		}

		for (const [, editors] of this.editorScopedNavigationStacks) {
			for (const [, stack] of editors) {
				stack.disposable.dispose();
			}
		}

		for (const [, listener] of this.editorHistoryListeners) {
			listener.dispose();
		}
	}
}

registerSingleton(IHistoryService, HistoryService, InstantiationType.Eager);

class EditorSelectionState {

	constructor(
		private readonly editorIdentifier: IEditorIdentifier,
		readonly selection: IEditorPaneSelection | undefined,
		private readonly reason: EditorPaneSelectionChangeReason | undefined
	) { }

	justifiesNewNavigationEntry(other: EditorSelectionState): boolean {
		if (this.editorIdentifier.groupId !== other.editorIdentifier.groupId) {
			return true;
		}

		if (!this.editorIdentifier.editor.matches(other.editorIdentifier.editor)) {
			return true;
		}

		if (!this.selection || !other.selection) {
			return true;
		}

		const result = this.selection.compare(other.selection);

		if (result === EditorPaneSelectionCompareResult.SIMILAR && (other.reason === EditorPaneSelectionChangeReason.NAVIGATION || other.reason === EditorPaneSelectionChangeReason.JUMP)) {
			return true;
		}

		return result === EditorPaneSelectionCompareResult.DIFFERENT;
	}
}

interface IEditorNavigationStacks extends IDisposable {
	readonly onDidChange: Event<void>;

	canGoForward(filter?: GoFilter): boolean;
	goForward(filter?: GoFilter): Promise<void>;
	canGoBack(filter?: GoFilter): boolean;
	goBack(filter?: GoFilter): Promise<void>;
	goPrevious(filter?: GoFilter): Promise<void>;
	canGoLast(filter?: GoFilter): boolean;
	goLast(filter?: GoFilter): Promise<void>;

	handleActiveEditorChange(editorPane?: IEditorPane): void;
	handleActiveEditorSelectionChange(editorPane: IEditorPaneWithSelection, event: IEditorPaneSelectionChangeEvent): void;

	clear(): void;
	remove(arg1: EditorInput | FileChangesEvent | FileOperationEvent | GroupIdentifier): void;
	move(event: FileOperationEvent): void;
}

class EditorNavigationStacks extends Disposable implements IEditorNavigationStacks {

	private readonly selectionsStack: EditorNavigationStack;
	private readonly editsStack: EditorNavigationStack;
	private readonly navigationsStack: EditorNavigationStack;

	private readonly stacks: EditorNavigationStack[];

	readonly onDidChange: Event<void>;

	constructor(
		private readonly scope: GoScope,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		this.selectionsStack = this._register(this.instantiationService.createInstance(EditorNavigationStack, GoFilter.NONE, this.scope));
		this.editsStack = this._register(this.instantiationService.createInstance(EditorNavigationStack, GoFilter.EDITS, this.scope));
		this.navigationsStack = this._register(this.instantiationService.createInstance(EditorNavigationStack, GoFilter.NAVIGATION, this.scope));

		this.stacks = [
			this.selectionsStack,
			this.editsStack,
			this.navigationsStack
		];

		this.onDidChange = Event.any(
			this.selectionsStack.onDidChange,
			this.editsStack.onDidChange,
			this.navigationsStack.onDidChange
		);
	}

	canGoForward(filter?: GoFilter): boolean {
		return this.getStack(filter).canGoForward();
	}

	goForward(filter?: GoFilter): Promise<void> {
		return this.getStack(filter).goForward();
	}

	canGoBack(filter?: GoFilter): boolean {
		return this.getStack(filter).canGoBack();
	}

	goBack(filter?: GoFilter): Promise<void> {
		return this.getStack(filter).goBack();
	}

	goPrevious(filter?: GoFilter): Promise<void> {
		return this.getStack(filter).goPrevious();
	}

	canGoLast(filter?: GoFilter): boolean {
		return this.getStack(filter).canGoLast();
	}

	goLast(filter?: GoFilter): Promise<void> {
		return this.getStack(filter).goLast();
	}

	private getStack(filter = GoFilter.NONE): EditorNavigationStack {
		switch (filter) {
			case GoFilter.NONE: return this.selectionsStack;
			case GoFilter.EDITS: return this.editsStack;
			case GoFilter.NAVIGATION: return this.navigationsStack;
		}
	}

	handleActiveEditorChange(editorPane?: IEditorPane): void {

		this.selectionsStack.notifyNavigation(editorPane);
	}

	handleActiveEditorSelectionChange(editorPane: IEditorPaneWithSelection, event: IEditorPaneSelectionChangeEvent): void {
		const previous = this.selectionsStack.current;

		this.selectionsStack.notifyNavigation(editorPane, event);

		if (event.reason === EditorPaneSelectionChangeReason.EDIT) {
			this.editsStack.notifyNavigation(editorPane, event);
		}

		else if (
			(event.reason === EditorPaneSelectionChangeReason.NAVIGATION || event.reason === EditorPaneSelectionChangeReason.JUMP) &&
			!this.selectionsStack.isNavigating()
		) {


			if (event.reason === EditorPaneSelectionChangeReason.JUMP && !this.navigationsStack.isNavigating()) {
				if (previous) {
					this.navigationsStack.addOrReplace(previous.groupId, previous.editor, previous.selection);
				}
			}

			this.navigationsStack.notifyNavigation(editorPane, event);
		}
	}

	clear(): void {
		for (const stack of this.stacks) {
			stack.clear();
		}
	}

	remove(arg1: EditorInput | FileChangesEvent | FileOperationEvent | GroupIdentifier): void {
		for (const stack of this.stacks) {
			stack.remove(arg1);
		}
	}

	move(event: FileOperationEvent): void {
		for (const stack of this.stacks) {
			stack.move(event);
		}
	}
}

class NoOpEditorNavigationStacks implements IEditorNavigationStacks {
	onDidChange = Event.None;

	canGoForward(): boolean { return false; }
	async goForward(): Promise<void> { }
	canGoBack(): boolean { return false; }
	async goBack(): Promise<void> { }
	async goPrevious(): Promise<void> { }
	canGoLast(): boolean { return false; }
	async goLast(): Promise<void> { }

	handleActiveEditorChange(): void { }
	handleActiveEditorSelectionChange(): void { }

	clear(): void { }
	remove(): void { }
	move(): void { }

	dispose(): void { }
}

interface IEditorNavigationStackEntry {
	groupId: GroupIdentifier;
	editor: EditorInput | IResourceEditorInput;
	selection?: IEditorPaneSelection;
}

export class EditorNavigationStack extends Disposable {

	private static readonly MAX_STACK_SIZE = 50;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly mapEditorToDisposable = this._register(new DisposableMap<EditorInput, DisposableStore>());
	private readonly mapGroupToDisposable = this._register(new DisposableMap<GroupIdentifier, IDisposable>);

	private readonly editorHelper: EditorHelper;

	private stack: IEditorNavigationStackEntry[] = [];

	private index = -1;
	private previousIndex = -1;

	private navigating = false;

	private currentSelectionState: EditorSelectionState | undefined = undefined;

	get current(): IEditorNavigationStackEntry | undefined {
		return this.stack[this.index];
	}

	private set current(entry: IEditorNavigationStackEntry | undefined) {
		if (entry) {
			this.stack[this.index] = entry;
		}
	}

	constructor(
		private readonly filter: GoFilter,
		private readonly scope: GoScope,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.editorHelper = instantiationService.createInstance(EditorHelper);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.onDidChange(() => this.traceStack()));
		this._register(this.logService.onDidChangeLogLevel(() => this.traceStack()));
		this._register(this.editorGroupService.onDidRemoveGroup(group => {
			this.mapGroupToDisposable.deleteAndDispose(group.id);
		}));
	}

	private traceStack(): void {
		if (this.logService.getLevel() !== LogLevel.Trace) {
			return;
		}

		const entryLabels: string[] = [];
		for (const entry of this.stack) {
			if (typeof entry.selection?.log === 'function') {
				entryLabels.push(`- group: ${entry.groupId}, editor: ${entry.editor.resource?.toString()}, selection: ${entry.selection.log()}`);
			} else {
				entryLabels.push(`- group: ${entry.groupId}, editor: ${entry.editor.resource?.toString()}, selection: <none>`);
			}
		}

		if (entryLabels.length === 0) {
			this.trace(`index: ${this.index}, navigating: ${this.isNavigating()}: <empty>`);
		} else {
			this.trace(`index: ${this.index}, navigating: ${this.isNavigating()}
${entryLabels.join('\n')}
			`);
		}
	}

	private trace(msg: string, editor: EditorInput | IResourceEditorInput | undefined | null = null, event?: IEditorPaneSelectionChangeEvent): void {
		if (this.logService.getLevel() !== LogLevel.Trace) {
			return;
		}

		let filterLabel: string;
		switch (this.filter) {
			case GoFilter.NONE: filterLabel = 'global';
				break;
			case GoFilter.EDITS: filterLabel = 'edits';
				break;
			case GoFilter.NAVIGATION: filterLabel = 'navigation';
				break;
		}

		let scopeLabel: string;
		switch (this.scope) {
			case GoScope.DEFAULT: scopeLabel = 'default';
				break;
			case GoScope.EDITOR_GROUP: scopeLabel = 'editorGroup';
				break;
			case GoScope.EDITOR: scopeLabel = 'editor';
				break;
		}

		if (editor !== null) {
			this.logService.trace(`[History stack ${filterLabel}-${scopeLabel}]: ${msg} (editor: ${editor?.resource?.toString()}, event: ${this.traceEvent(event)})`);
		} else {
			this.logService.trace(`[History stack ${filterLabel}-${scopeLabel}]: ${msg}`);
		}
	}

	private traceEvent(event?: IEditorPaneSelectionChangeEvent): string {
		if (!event) {
			return '<none>';
		}

		switch (event.reason) {
			case EditorPaneSelectionChangeReason.EDIT: return 'edit';
			case EditorPaneSelectionChangeReason.NAVIGATION: return 'navigation';
			case EditorPaneSelectionChangeReason.JUMP: return 'jump';
			case EditorPaneSelectionChangeReason.PROGRAMMATIC: return 'programmatic';
			case EditorPaneSelectionChangeReason.USER: return 'user';
		}
	}

	private registerGroupListeners(groupId: GroupIdentifier): void {
		if (!this.mapGroupToDisposable.has(groupId)) {
			const group = this.editorGroupService.getGroup(groupId);
			if (group) {
				this.mapGroupToDisposable.set(groupId, group.onWillMoveEditor(e => this.onWillMoveEditor(e)));
			}
		}
	}

	private onWillMoveEditor(e: IEditorWillMoveEvent): void {
		this.trace('onWillMoveEditor()', e.editor);

		if (this.scope === GoScope.EDITOR_GROUP) {
			return;
		}

		for (const entry of this.stack) {
			if (entry.groupId !== e.groupId) {
				continue;
			}

			if (!this.editorHelper.matchesEditor(e.editor, entry.editor)) {
				continue;
			}

			entry.groupId = e.target;
		}
	}


	notifyNavigation(editorPane: IEditorPane | undefined, event?: IEditorPaneSelectionChangeEvent): void {
		this.trace('notifyNavigation()', editorPane?.input, event);

		const isSelectionAwareEditorPane = isEditorPaneWithSelection(editorPane);
		const hasValidEditor = editorPane?.input && !editorPane.input.isDisposed();

		if (this.navigating) {
			this.trace(`notifyNavigation() ignoring (navigating)`, editorPane?.input, event);

			if (isSelectionAwareEditorPane && hasValidEditor) {
				this.trace('notifyNavigation() updating current selection state', editorPane?.input, event);

				this.currentSelectionState = new EditorSelectionState({ groupId: editorPane.group.id, editor: editorPane.input }, editorPane.getSelection(), event?.reason);
			} else {
				this.trace('notifyNavigation() dropping current selection state', editorPane?.input, event);

				this.currentSelectionState = undefined;
			}
		}

		else {
			this.trace(`notifyNavigation() not ignoring`, editorPane?.input, event);

			if (isSelectionAwareEditorPane && hasValidEditor) {
				this.onSelectionAwareEditorNavigation(editorPane.group.id, editorPane.input, editorPane.getSelection(), event);
			}

			else {
				this.currentSelectionState = undefined;

				if (hasValidEditor) {
					this.onNonSelectionAwareEditorNavigation(editorPane.group.id, editorPane.input);
				}
			}
		}
	}

	private onSelectionAwareEditorNavigation(groupId: GroupIdentifier, editor: EditorInput, selection: IEditorPaneSelection | undefined, event?: IEditorPaneSelectionChangeEvent): void {
		if (this.current?.groupId === groupId && !selection && this.editorHelper.matchesEditor(this.current.editor, editor)) {
			return;
		}

		this.trace('onSelectionAwareEditorNavigation()', editor, event);

		const stateCandidate = new EditorSelectionState({ groupId, editor }, selection, event?.reason);

		if (!this.currentSelectionState || this.currentSelectionState.justifiesNewNavigationEntry(stateCandidate)) {
			this.doAdd(groupId, editor, stateCandidate.selection);
		}

		else {
			this.doReplace(groupId, editor, stateCandidate.selection);
		}

		this.currentSelectionState = stateCandidate;
	}

	private onNonSelectionAwareEditorNavigation(groupId: GroupIdentifier, editor: EditorInput): void {
		if (this.current?.groupId === groupId && this.editorHelper.matchesEditor(this.current.editor, editor)) {
			return;
		}

		this.trace('onNonSelectionAwareEditorNavigation()', editor);

		this.doAdd(groupId, editor);
	}

	private doAdd(groupId: GroupIdentifier, editor: EditorInput | IResourceEditorInput, selection?: IEditorPaneSelection): void {
		if (!this.navigating) {
			this.addOrReplace(groupId, editor, selection);
		}
	}

	private doReplace(groupId: GroupIdentifier, editor: EditorInput | IResourceEditorInput, selection?: IEditorPaneSelection): void {
		if (!this.navigating) {
			this.addOrReplace(groupId, editor, selection, true );
		}
	}

	addOrReplace(groupId: GroupIdentifier, editorCandidate: EditorInput | IResourceEditorInput, selection?: IEditorPaneSelection, forceReplace?: boolean): void {

		this.registerGroupListeners(groupId);

		let replace = false;
		if (this.current) {
			if (forceReplace) {
				replace = true;
			} else if (this.shouldReplaceStackEntry(this.current, { groupId, editor: editorCandidate, selection })) {
				replace = true;
			}
		}

		const editor = this.editorHelper.preferResourceEditorInput(editorCandidate);
		if (!editor) {
			return;
		}

		if (replace) {
			this.trace('replace()', editor);
		} else {
			this.trace('add()', editor);
		}

		const newStackEntry: IEditorNavigationStackEntry = { groupId, editor, selection };

		const removedEntries: IEditorNavigationStackEntry[] = [];
		if (replace) {
			if (this.current) {
				removedEntries.push(this.current);
			}
			this.current = newStackEntry;
		}

		else {

			if (this.stack.length > this.index + 1) {
				for (let i = this.index + 1; i < this.stack.length; i++) {
					removedEntries.push(this.stack[i]);
				}

				this.stack = this.stack.slice(0, this.index + 1);
			}

			this.stack.splice(this.index + 1, 0, newStackEntry);

			if (this.stack.length > EditorNavigationStack.MAX_STACK_SIZE) {
				removedEntries.push(this.stack.shift()!);
				if (this.previousIndex >= 0) {
					this.previousIndex--;
				}
			} else {
				this.setIndex(this.index + 1, true );
			}
		}

		for (const removedEntry of removedEntries) {
			this.editorHelper.clearOnEditorDispose(removedEntry.editor, this.mapEditorToDisposable);
		}

		if (isEditorInput(editor)) {
			this.editorHelper.onEditorDispose(editor, () => this.remove(editor), this.mapEditorToDisposable);
		}

		this._onDidChange.fire();
	}

	private shouldReplaceStackEntry(entry: IEditorNavigationStackEntry, candidate: IEditorNavigationStackEntry): boolean {
		if (entry.groupId !== candidate.groupId) {
			return false;
		}

		if (!this.editorHelper.matchesEditor(entry.editor, candidate.editor)) {
			return false;
		}

		if (!entry.selection) {
			return true;
		}

		if (!candidate.selection) {
			return false;
		}

		return entry.selection.compare(candidate.selection) === EditorPaneSelectionCompareResult.IDENTICAL;
	}

	move(event: FileOperationEvent): void {
		if (event.isOperation(FileOperation.MOVE)) {
			for (const entry of this.stack) {
				if (this.editorHelper.matchesEditor(event, entry.editor)) {
					entry.editor = { resource: event.target.resource };
				}
			}
		}
	}

	remove(arg1: EditorInput | FileChangesEvent | FileOperationEvent | GroupIdentifier): void {
		const previousStackSize = this.stack.length;

		this.stack = this.stack.filter(entry => {
			const matches = typeof arg1 === 'number' ? entry.groupId === arg1 : this.editorHelper.matchesEditor(arg1, entry.editor);

			if (matches) {
				this.editorHelper.clearOnEditorDispose(entry.editor, this.mapEditorToDisposable);
			}

			return !matches;
		});

		if (previousStackSize === this.stack.length) {
			return;
		}

		this.flatten();

		this.index = this.stack.length - 1;
		this.previousIndex = -1;

		if (typeof arg1 === 'number') {
			this.mapGroupToDisposable.deleteAndDispose(arg1);
		}

		this._onDidChange.fire();
	}

	private flatten(): void {
		const flattenedStack: IEditorNavigationStackEntry[] = [];

		let previousEntry: IEditorNavigationStackEntry | undefined = undefined;
		for (const entry of this.stack) {
			if (previousEntry && this.shouldReplaceStackEntry(entry, previousEntry)) {
				continue;
			}

			previousEntry = entry;
			flattenedStack.push(entry);
		}

		this.stack = flattenedStack;
	}

	clear(): void {
		this.index = -1;
		this.previousIndex = -1;
		this.stack.splice(0);

		this.mapEditorToDisposable.clearAndDisposeAll();
		this.mapGroupToDisposable.clearAndDisposeAll();
	}

	override dispose(): void {
		this.clear();

		super.dispose();
	}



	canGoForward(): boolean {
		return this.stack.length > this.index + 1;
	}

	async goForward(): Promise<void> {
		const navigated = await this.maybeGoCurrent();
		if (navigated) {
			return;
		}

		if (!this.canGoForward()) {
			return;
		}

		this.setIndex(this.index + 1);
		return this.navigate();
	}

	canGoBack(): boolean {
		return this.index > 0;
	}

	async goBack(): Promise<void> {
		const navigated = await this.maybeGoCurrent();
		if (navigated) {
			return;
		}

		if (!this.canGoBack()) {
			return;
		}

		this.setIndex(this.index - 1);
		return this.navigate();
	}

	async goPrevious(): Promise<void> {
		const navigated = await this.maybeGoCurrent();
		if (navigated) {
			return;
		}

		if (this.previousIndex === -1) {
			return this.goBack();
		}

		this.setIndex(this.previousIndex);
		return this.navigate();
	}

	canGoLast(): boolean {
		return this.stack.length > 0;
	}

	async goLast(): Promise<void> {
		if (!this.canGoLast()) {
			return;
		}

		this.setIndex(this.stack.length - 1);
		return this.navigate();
	}

	private async maybeGoCurrent(): Promise<boolean> {


		if (this.filter === GoFilter.NONE) {
			return false;
		}

		if (this.isCurrentSelectionActive()) {
			return false;
		}

		await this.navigate();

		return true;
	}

	private isCurrentSelectionActive(): boolean {
		if (!this.current?.selection) {
			return false;
		}

		const pane = this.editorService.activeEditorPane;
		if (!isEditorPaneWithSelection(pane)) {
			return false;
		}

		if (pane.group.id !== this.current.groupId) {
			return false;
		}

		if (!pane.input || !this.editorHelper.matchesEditor(pane.input, this.current.editor)) {
			return false;
		}

		const paneSelection = pane.getSelection();
		if (!paneSelection) {
			return false;
		}

		return paneSelection.compare(this.current.selection) === EditorPaneSelectionCompareResult.IDENTICAL;
	}

	private setIndex(newIndex: number, skipEvent?: boolean): void {
		this.previousIndex = this.index;
		this.index = newIndex;

		if (!skipEvent) {
			this._onDidChange.fire();
		}
	}

	private async navigate(): Promise<void> {
		this.navigating = true;

		try {
			if (this.current) {
				await this.doNavigate(this.current);
			}
		} finally {
			this.navigating = false;
		}
	}

	private doNavigate(location: IEditorNavigationStackEntry): Promise<IEditorPane | undefined> {
		let options: IEditorOptions = Object.create(null);

		if (location.selection) {
			options = location.selection.restore(options);
		}

		if (isEditorInput(location.editor)) {
			return this.editorService.openEditor(location.editor, options, location.groupId);
		}

		return this.editorService.openEditor({
			...location.editor,
			options: {
				...location.editor.options,
				...options
			}
		}, location.groupId);
	}

	isNavigating(): boolean {
		return this.navigating;
	}

}

class EditorHelper {

	constructor(
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService
	) { }

	preferResourceEditorInput(editor: EditorInput): EditorInput | IResourceEditorInput;
	preferResourceEditorInput(editor: IResourceEditorInput): IResourceEditorInput | undefined;
	preferResourceEditorInput(editor: EditorInput | IResourceEditorInput): EditorInput | IResourceEditorInput | undefined;
	preferResourceEditorInput(editor: EditorInput | IResourceEditorInput): EditorInput | IResourceEditorInput | undefined {
		const resource = EditorResourceAccessor.getOriginalUri(editor);

		const hasValidResourceEditorInputScheme =
			resource?.scheme === Schemas.file ||
			resource?.scheme === Schemas.vscodeRemote ||
			resource?.scheme === Schemas.vscodeUserData ||
			resource?.scheme === this.pathService.defaultUriScheme;

		if (hasValidResourceEditorInputScheme) {
			if (isEditorInput(editor)) {
				const untypedInput = editor.toUntyped();
				if (isResourceEditorInput(untypedInput)) {
					return untypedInput;
				}
			}

			return editor;
		}

		else {
			return isEditorInput(editor) ? editor : undefined;
		}
	}

	matchesEditor(arg1: EditorInput | IResourceEditorInput | FileChangesEvent | FileOperationEvent, inputB: EditorInput | IResourceEditorInput): boolean {
		if (arg1 instanceof FileChangesEvent || arg1 instanceof FileOperationEvent) {
			if (isEditorInput(inputB)) {
				return false;
			}

			if (arg1 instanceof FileChangesEvent) {
				return arg1.contains(inputB.resource, FileChangeType.DELETED);
			}

			return this.matchesFile(inputB.resource, arg1);
		}

		if (isEditorInput(arg1)) {
			if (isEditorInput(inputB)) {
				return arg1.matches(inputB);
			}

			return this.matchesFile(inputB.resource, arg1);
		}

		if (isEditorInput(inputB)) {
			return this.matchesFile(arg1.resource, inputB);
		}

		return arg1 && inputB && this.uriIdentityService.extUri.isEqual(arg1.resource, inputB.resource);
	}

	matchesFile(resource: URI, arg2: EditorInput | IResourceEditorInput | FileChangesEvent | FileOperationEvent): boolean {
		if (arg2 instanceof FileChangesEvent) {
			return arg2.contains(resource, FileChangeType.DELETED);
		}

		if (arg2 instanceof FileOperationEvent) {
			return this.uriIdentityService.extUri.isEqualOrParent(resource, arg2.resource);
		}

		if (isEditorInput(arg2)) {
			const inputResource = arg2.resource;
			if (!inputResource) {
				return false;
			}

			if (this.lifecycleService.phase >= LifecyclePhase.Restored && !this.fileService.hasProvider(inputResource)) {
				return false;
			}

			return this.uriIdentityService.extUri.isEqual(inputResource, resource);
		}

		return this.uriIdentityService.extUri.isEqual(arg2?.resource, resource);
	}

	matchesEditorIdentifier(identifier: IEditorIdentifier, editorPane?: IEditorPane): boolean {
		if (!editorPane?.group) {
			return false;
		}

		if (identifier.groupId !== editorPane.group.id) {
			return false;
		}

		return editorPane.input ? identifier.editor.matches(editorPane.input) : false;
	}

	onEditorDispose(editor: EditorInput, listener: Function, mapEditorToDispose: DisposableMap<EditorInput, DisposableStore>): void {
		const toDispose = Event.once(editor.onWillDispose)(() => {
			mapEditorToDispose.deleteAndDispose(editor);
			listener();
		});

		let disposables = mapEditorToDispose.get(editor);
		if (!disposables) {
			disposables = new DisposableStore();
			mapEditorToDispose.set(editor, disposables);
		}

		disposables.add(toDispose);
	}

	clearOnEditorDispose(editor: EditorInput | IResourceEditorInput | FileChangesEvent | FileOperationEvent, mapEditorToDispose: DisposableMap<EditorInput, DisposableStore>): void {
		if (!isEditorInput(editor)) {
			return;
		}

		mapEditorToDispose.deleteAndDispose(editor);
	}
}
