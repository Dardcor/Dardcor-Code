/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { Part } from '../../part.js';
import { Dimension, $, EventHelper, addDisposableGenericMouseDownListener, getWindow, isAncestorOfActiveElement, getActiveElement, isHTMLElement } from '../../../../base/browser/dom.js';
import { Event, Emitter, Relay, PauseableEmitter } from '../../../../base/common/event.js';
import { contrastBorder, editorBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { GroupDirection, GroupsArrangement, GroupOrientation, IMergeGroupOptions, MergeGroupMode, GroupsOrder, GroupLocation, IFindGroupScope, EditorGroupLayout, GroupLayoutArgument, IEditorSideGroup, IEditorDropTargetDelegate, IEditorPart, GroupActivationReason, IEditorGroupActivationEvent } from '../../../services/editor/common/editorGroupsService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IView, orthogonal, LayoutPriority, IViewSize, Direction, SerializableGrid, Sizing, ISerializedGrid, ISerializedNode, Orientation, GridBranchNode, isGridBranchNode, GridNode, createSerializedGrid, Grid } from '../../../../base/browser/ui/grid/grid.js';
import { GroupIdentifier, EditorInputWithOptions, IEditorPartOptions, IEditorPartOptionsChangeEvent, GroupModelChangeKind } from '../../../common/editor.js';
import { EDITOR_GROUP_BORDER, EDITOR_PANE_BACKGROUND } from '../../../common/theme.js';
import { distinct, coalesce } from '../../../../base/common/arrays.js';
import { IEditorGroupView, getEditorPartOptions, impactsEditorPartOptions, IEditorPartCreationOptions, IEditorPartsView, IEditorGroupsView, IEditorGroupViewOptions } from './editor.js';
import { EditorGroupView } from './editorGroupView.js';
import { IConfigurationService, IConfigurationChangeEvent } from '../../../../platform/configuration/common/configuration.js';
import { IDisposable, dispose, toDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IStorageService, IStorageValueChangeEvent, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ISerializedEditorGroupModel, isSerializedEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { EditorDropTarget } from './editorDropTarget.js';
import { Color } from '../../../../base/common/color.js';
import { CenteredViewLayout, CenteredViewState } from '../../../../base/browser/ui/centered/centeredViewLayout.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Parts, IWorkbenchLayoutService, Position, FLOATING_PANEL_INNER_MARGIN, FLOATING_PANEL_MARGIN, getFloatingOuterEdgeOwners, getFloatingEditorVerticalMargins } from '../../../services/layout/browser/layoutService.js';
import { DeepPartial, assertType } from '../../../../base/common/types.js';
import { CompositeDragAndDropObserver } from '../../dnd.js';
import { DeferredPromise, Promises } from '../../../../base/common/async.js';
import { findGroup } from '../../../services/editor/common/editorGroupFinder.js';
import { SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IBoundarySashes } from '../../../../base/browser/ui/sash/sash.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { EditorAreaFocusContext, EditorPartMaximizedEditorGroupContext, EditorPartMultipleEditorGroupsContext, EditorTabsVisibleContext, IsTopRightEditorGroupContext } from '../../../common/contextkeys.js';
import { mainWindow } from '../../../../base/browser/window.js';

const EDITOR_FRAME_BORDER_WIDTH = 1;

export interface IEditorPartUIState {
	readonly serializedGrid: ISerializedGrid;
	readonly activeGroup: GroupIdentifier;
	readonly mostRecentActiveGroups: GroupIdentifier[];
}

interface IEditorPartMemento {
	'editorpart.state'?: IEditorPartUIState;
	'editorpart.centeredview'?: CenteredViewState;
}

class GridWidgetView<T extends IView> implements IView {

	readonly element: HTMLElement = $('.grid-view-container');

	get minimumWidth(): number { return this.gridWidget ? this.gridWidget.minimumWidth : 0; }
	get maximumWidth(): number { return this.gridWidget ? this.gridWidget.maximumWidth : Number.POSITIVE_INFINITY; }
	get minimumHeight(): number { return this.gridWidget ? this.gridWidget.minimumHeight : 0; }
	get maximumHeight(): number { return this.gridWidget ? this.gridWidget.maximumHeight : Number.POSITIVE_INFINITY; }

	private _onDidChange = new Relay<{ width: number; height: number } | undefined>();
	readonly onDidChange = this._onDidChange.event;

	private _gridWidget: Grid<T> | undefined;

	get gridWidget(): Grid<T> | undefined {
		return this._gridWidget;
	}

	set gridWidget(grid: Grid<T> | undefined) {
		this.element.textContent = '';

		if (grid) {
			this.element.appendChild(grid.element);
			this._onDidChange.input = grid.onDidChange;
		} else {
			this._onDidChange.input = Event.None;
		}

		this._gridWidget = grid;
	}

	layout(width: number, height: number, top: number, left: number): void {
		this.gridWidget?.layout(width, height, top, left);
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}

export class EditorPart extends Part<IEditorPartMemento> implements IEditorPart, IEditorGroupsView {

	private static readonly EDITOR_PART_UI_STATE_STORAGE_KEY = 'editorpart.state';
	private static readonly EDITOR_PART_CENTERED_VIEW_STORAGE_KEY = 'editorpart.centeredview';


	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private readonly _onDidLayout = this._register(new Emitter<Dimension>());
	readonly onDidLayout = this._onDidLayout.event;

	private readonly _onDidChangeActiveGroup = this._register(new Emitter<IEditorGroupView>());
	readonly onDidChangeActiveGroup = this._onDidChangeActiveGroup.event;

	private readonly _onDidChangeGroupIndex = this._register(new Emitter<IEditorGroupView>());
	readonly onDidChangeGroupIndex = this._onDidChangeGroupIndex.event;

	private readonly _onDidChangeGroupLabel = this._register(new Emitter<IEditorGroupView>());
	readonly onDidChangeGroupLabel = this._onDidChangeGroupLabel.event;

	private readonly _onDidChangeGroupLocked = this._register(new Emitter<IEditorGroupView>());
	readonly onDidChangeGroupLocked = this._onDidChangeGroupLocked.event;

	private readonly _onDidChangeGroupMaximized = this._register(new Emitter<boolean>());
	readonly onDidChangeGroupMaximized = this._onDidChangeGroupMaximized.event;

	private readonly _onDidActivateGroup = this._register(new Emitter<IEditorGroupActivationEvent>());
	readonly onDidActivateGroup = this._onDidActivateGroup.event;

	private readonly _onDidAddGroup = this._register(new PauseableEmitter<IEditorGroupView>());
	readonly onDidAddGroup = this._onDidAddGroup.event;

	private readonly _onDidRemoveGroup = this._register(new PauseableEmitter<IEditorGroupView>());
	readonly onDidRemoveGroup = this._onDidRemoveGroup.event;

	private readonly _onDidMoveGroup = this._register(new Emitter<IEditorGroupView>());
	readonly onDidMoveGroup = this._onDidMoveGroup.event;

	private readonly onDidSetGridWidget = this._register(new Emitter<{ width: number; height: number } | undefined>());

	private readonly _onDidChangeSizeConstraints = this._register(new Relay<{ width: number; height: number } | undefined>());
	readonly onDidChangeSizeConstraints = Event.any(this.onDidSetGridWidget.event, this._onDidChangeSizeConstraints.event);

	private readonly _onDidScroll = this._register(new Relay<void>());
	readonly onDidScroll = Event.any(this.onDidSetGridWidget.event, this._onDidScroll.event);

	private readonly _onDidChangeEditorPartOptions = this._register(new Emitter<IEditorPartOptionsChangeEvent>());
	readonly onDidChangeEditorPartOptions = this._onDidChangeEditorPartOptions.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;


	private readonly workspaceMemento = this.getMemento(StorageScope.WORKSPACE, StorageTarget.USER);
	private readonly profileMemento = this.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);

	private readonly groupViews = new Map<GroupIdentifier, IEditorGroupView>();
	private mostRecentActiveGroups: GroupIdentifier[] = [];

	protected readonly container = $('.content');

	readonly scopedInstantiationService: IInstantiationService;
	protected readonly scopedContextKeyService: IContextKeyService;

	private centeredLayoutWidget!: CenteredViewLayout;

	private gridWidget!: SerializableGrid<IEditorGroupView>;
	private readonly gridWidgetDisposables = this._register(new DisposableStore());
	private readonly gridWidgetView = this._register(new GridWidgetView<IEditorGroupView>());

	constructor(
		protected readonly editorPartsView: IEditorPartsView,
		id: string,
		private readonly groupsLabel: string,
		readonly windowId: number,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IHostService private readonly hostService: IHostService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super(id, { hasTitle: false }, themeService, storageService, layoutService);

		this.scopedContextKeyService = this._register(this.contextKeyService.createScoped(this.container));
		this.scopedInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection(
			[IContextKeyService, this.scopedContextKeyService]
		)));

		this._partOptions = getEditorPartOptions(this.configurationService, this.themeService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(e)));
		this._register(this.themeService.onDidFileIconThemeChange(() => this.handleChangedPartOptions()));
		this._register(this.onDidChangeMementoValue(StorageScope.WORKSPACE, this._store)(e => this.onDidChangeMementoState(e)));
	}

	private onConfigurationUpdated(event: IConfigurationChangeEvent): void {
		if (impactsEditorPartOptions(event)) {
			this.handleChangedPartOptions();
		}
	}

	private handleChangedPartOptions(): void {
		const oldPartOptions = this._partOptions;
		const newPartOptions = getEditorPartOptions(this.configurationService, this.themeService);

		for (const enforcedPartOptions of this.enforcedPartOptions) {
			Object.assign(newPartOptions, enforcedPartOptions);
		}

		this._partOptions = newPartOptions;

		this._onDidChangeEditorPartOptions.fire({ oldPartOptions, newPartOptions });
	}

	private enforcedPartOptions: DeepPartial<IEditorPartOptions>[] = [];

	private _partOptions: IEditorPartOptions;
	get partOptions(): IEditorPartOptions { return this._partOptions; }

	enforcePartOptions(options: DeepPartial<IEditorPartOptions>): IDisposable {
		this.enforcedPartOptions.push(options);
		this.handleChangedPartOptions();

		return toDisposable(() => {
			this.enforcedPartOptions.splice(this.enforcedPartOptions.indexOf(options), 1);
			this.handleChangedPartOptions();
		});
	}

	private top = 0;
	private left = 0;
	private _contentDimension!: Dimension;
	get contentDimension(): Dimension { return this._contentDimension; }

	private _contentRightInset = 0;

	setContentRightInset(inset: number): void {
		this._contentRightInset = Math.max(0, Math.round(inset));
		this.applyContentRightInset();
	}

	private applyContentRightInset(): void {
		if (!this.gridWidget) {
			return;
		}

		for (const group of this.groupViews.values()) {
			if (!(group instanceof EditorGroupView)) {
				continue;
			}

			const atRightEdge = this._contentRightInset > 0 && this.gridWidget.getNeighborViews(group, Direction.Right).length === 0;
			group.setContentRightInset(atRightEdge ? this._contentRightInset : 0);
		}
	}

	private _activeGroup!: IEditorGroupView;
	get activeGroup(): IEditorGroupView {
		return this._activeGroup;
	}

	readonly sideGroup: IEditorSideGroup = {
		openEditor: async (editor, options) => {
			const findGroupResult = this.scopedInstantiationService.invokeFunction(accessor => findGroup(accessor, { editor, options }, SIDE_GROUP));
			let group;
			if (findGroupResult instanceof Promise) {
				([group] = await findGroupResult);
			} else {
				([group] = findGroupResult);
			}
			return group.openEditor(editor, options);
		}
	};

	get groups(): IEditorGroupView[] {
		return Array.from(this.groupViews.values());
	}

	get count(): number {
		return this.groupViews.size;
	}

	get orientation(): GroupOrientation {
		return (this.gridWidget && this.gridWidget.orientation === Orientation.VERTICAL) ? GroupOrientation.VERTICAL : GroupOrientation.HORIZONTAL;
	}

	private _isReady = false;
	get isReady(): boolean { return this._isReady; }

	private readonly whenReadyPromise = new DeferredPromise<void>();
	readonly whenReady = this.whenReadyPromise.p;

	private readonly whenRestoredPromise = new DeferredPromise<void>();
	readonly whenRestored = this.whenRestoredPromise.p;

	get hasRestorableState(): boolean {
		return !!this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY];
	}

	private _willRestoreState = false;
	get willRestoreState(): boolean { return this._willRestoreState; }

	getGroups(order = GroupsOrder.CREATION_TIME): IEditorGroupView[] {
		switch (order) {
			case GroupsOrder.CREATION_TIME:
				return this.groups;

			case GroupsOrder.MOST_RECENTLY_ACTIVE: {
				const mostRecentActive = coalesce(this.mostRecentActiveGroups.map(groupId => this.getGroup(groupId)));

				return distinct([...mostRecentActive, ...this.groups]);
			}
			case GroupsOrder.GRID_APPEARANCE: {
				const views: IEditorGroupView[] = [];
				if (this.gridWidget) {
					this.fillGridNodes(views, this.gridWidget.getViews());
				}

				return views;
			}
		}
	}

	private fillGridNodes(target: IEditorGroupView[], node: GridBranchNode<IEditorGroupView> | GridNode<IEditorGroupView>): void {
		if (isGridBranchNode(node)) {
			node.children.forEach(child => this.fillGridNodes(target, child));
		} else {
			target.push(node.view);
		}
	}

	hasGroup(identifier: GroupIdentifier): boolean {
		return this.groupViews.has(identifier);
	}

	getGroup(identifier: GroupIdentifier): IEditorGroupView | undefined {
		return this.groupViews.get(identifier);
	}

	findGroup(scope: IFindGroupScope, source: IEditorGroupView | GroupIdentifier = this.activeGroup, wrap?: boolean): IEditorGroupView | undefined {

		if (typeof scope.direction === 'number') {
			return this.doFindGroupByDirection(scope.direction, source, wrap);
		}

		if (typeof scope.location === 'number') {
			return this.doFindGroupByLocation(scope.location, source, wrap);
		}

		throw new Error('invalid arguments');
	}

	private doFindGroupByDirection(direction: GroupDirection, source: IEditorGroupView | GroupIdentifier, wrap?: boolean): IEditorGroupView | undefined {
		const sourceGroupView = this.assertGroupView(source);

		const neighbours = this.gridWidget.getNeighborViews(sourceGroupView, this.toGridViewDirection(direction), wrap);
		neighbours.sort(((n1, n2) => this.mostRecentActiveGroups.indexOf(n1.id) - this.mostRecentActiveGroups.indexOf(n2.id)));

		return neighbours[0];
	}

	private doFindGroupByLocation(location: GroupLocation, source: IEditorGroupView | GroupIdentifier, wrap?: boolean): IEditorGroupView | undefined {
		const sourceGroupView = this.assertGroupView(source);
		const groups = this.getGroups(GroupsOrder.GRID_APPEARANCE);
		const index = groups.indexOf(sourceGroupView);

		switch (location) {
			case GroupLocation.FIRST:
				return groups[0];
			case GroupLocation.LAST:
				return groups[groups.length - 1];
			case GroupLocation.NEXT: {
				let nextGroup: IEditorGroupView | undefined = groups[index + 1];
				if (!nextGroup && wrap) {
					nextGroup = this.doFindGroupByLocation(GroupLocation.FIRST, source);
				}

				return nextGroup;
			}
			case GroupLocation.PREVIOUS: {
				let previousGroup: IEditorGroupView | undefined = groups[index - 1];
				if (!previousGroup && wrap) {
					previousGroup = this.doFindGroupByLocation(GroupLocation.LAST, source);
				}

				return previousGroup;
			}
		}
	}

	activateGroup(group: IEditorGroupView | GroupIdentifier, preserveWindowOrder?: boolean, reason?: GroupActivationReason): IEditorGroupView {
		const groupView = this.assertGroupView(group);
		this.doSetGroupActive(groupView, reason);

		if (!preserveWindowOrder) {
			this.hostService.moveTop(getWindow(this.element));
		}

		return groupView;
	}

	restoreGroup(group: IEditorGroupView | GroupIdentifier): IEditorGroupView {
		const groupView = this.assertGroupView(group);
		this.doRestoreGroup(groupView);

		return groupView;
	}

	getSize(group: IEditorGroupView | GroupIdentifier): { width: number; height: number } {
		const groupView = this.assertGroupView(group);

		return this.gridWidget.getViewSize(groupView);
	}

	setSize(group: IEditorGroupView | GroupIdentifier, size: { width: number; height: number }): void {
		const groupView = this.assertGroupView(group);

		this.gridWidget.resizeView(groupView, size);
	}

	arrangeGroups(arrangement: GroupsArrangement, target: IEditorGroupView | GroupIdentifier = this.activeGroup): void {
		if (this.count < 2) {
			return;
		}

		if (!this.gridWidget) {
			return;
		}

		const groupView = this.assertGroupView(target);

		switch (arrangement) {
			case GroupsArrangement.EVEN:
				this.gridWidget.distributeViewSizes();
				break;
			case GroupsArrangement.MAXIMIZE:
				if (this.groups.length < 2) {
					return;
				}
				this.gridWidget.maximizeView(groupView);
				groupView.focus();
				break;
			case GroupsArrangement.EXPAND:
				this.gridWidget.expandView(groupView);
				break;
		}
	}

	toggleMaximizeGroup(target: IEditorGroupView | GroupIdentifier = this.activeGroup): void {
		if (this.hasMaximizedGroup()) {
			this.unmaximizeGroup();
		} else {
			this.arrangeGroups(GroupsArrangement.MAXIMIZE, target);
		}
	}

	toggleExpandGroup(target: IEditorGroupView | GroupIdentifier = this.activeGroup): void {
		if (this.isGroupExpanded(this.activeGroup)) {
			this.arrangeGroups(GroupsArrangement.EVEN);
		} else {
			this.arrangeGroups(GroupsArrangement.EXPAND, target);
		}
	}

	private unmaximizeGroup(): void {
		this.gridWidget.exitMaximizedView();
		this._activeGroup.focus();
	}

	hasMaximizedGroup(): boolean {
		return this.gridWidget.hasMaximizedView();
	}

	private isGroupMaximized(targetGroup: IEditorGroupView): boolean {
		return this.gridWidget.isViewMaximized(targetGroup);
	}

	isGroupExpanded(targetGroup: IEditorGroupView): boolean {
		return this.gridWidget.isViewExpanded(targetGroup);
	}

	setGroupOrientation(orientation: GroupOrientation): void {
		if (!this.gridWidget) {
			return;
		}

		const newOrientation = (orientation === GroupOrientation.HORIZONTAL) ? Orientation.HORIZONTAL : Orientation.VERTICAL;
		if (this.gridWidget.orientation !== newOrientation) {
			this.gridWidget.orientation = newOrientation;
		}
	}

	applyLayout(layout: EditorGroupLayout): void {
		const restoreFocus = this.shouldRestoreFocus(this.container);

		let layoutGroupsCount = 0;
		function countGroups(groups: GroupLayoutArgument[]): void {
			for (const group of groups) {
				if (Array.isArray(group.groups)) {
					countGroups(group.groups);
				} else {
					layoutGroupsCount++;
				}
			}
		}
		countGroups(layout.groups);

		let currentGroupViews = this.getGroups(GroupsOrder.GRID_APPEARANCE);
		if (layoutGroupsCount < currentGroupViews.length) {
			const lastGroupInLayout = currentGroupViews[layoutGroupsCount - 1];
			currentGroupViews.forEach((group, index) => {
				if (index >= layoutGroupsCount) {
					this.mergeGroup(group, lastGroupInLayout);
				}
			});

			currentGroupViews = this.getGroups(GroupsOrder.GRID_APPEARANCE);
		}

		const activeGroup = this.activeGroup;

		const gridDescriptor = createSerializedGrid({
			orientation: this.toGridViewOrientation(
				layout.orientation,
				this.isTwoDimensionalGrid() ?
					this.gridWidget.orientation :
					orthogonal(this.gridWidget.orientation)
			),
			groups: layout.groups
		});

		this.doApplyGridState(gridDescriptor, activeGroup.id, currentGroupViews);

		if (restoreFocus) {
			this._activeGroup.focus();
		}
	}

	getLayout(): EditorGroupLayout {


		const serializedGrid = this.gridWidget.serialize();
		const orientation = serializedGrid.orientation === Orientation.HORIZONTAL ? GroupOrientation.HORIZONTAL : GroupOrientation.VERTICAL;
		const root = this.serializedNodeToGroupLayoutArgument(serializedGrid.root);

		return {
			orientation,
			groups: root.groups as GroupLayoutArgument[]
		};
	}

	private serializedNodeToGroupLayoutArgument(serializedNode: ISerializedNode): GroupLayoutArgument {
		if (serializedNode.type === 'branch') {
			return {
				size: serializedNode.size,
				groups: serializedNode.data.map(node => this.serializedNodeToGroupLayoutArgument(node))
			};
		}

		return { size: serializedNode.size };
	}

	protected shouldRestoreFocus(target: Element | undefined): boolean {
		if (!target) {
			return false;
		}

		const activeElement = getActiveElement();
		if (activeElement === target.ownerDocument.body) {
			return true;
		}

		return isAncestorOfActiveElement(target);
	}

	private isTwoDimensionalGrid(): boolean {
		const views = this.gridWidget.getViews();
		if (isGridBranchNode(views)) {
			return views.children.some(child => isGridBranchNode(child));
		}

		return false;
	}

	addGroup(location: IEditorGroupView | GroupIdentifier, direction: GroupDirection, groupToCopy?: IEditorGroupView): IEditorGroupView {
		const locationView = this.assertGroupView(location);

		let newGroupView: IEditorGroupView;

		if (locationView.groupsView === this) {
			const restoreFocus = this.shouldRestoreFocus(locationView.element);

			const shouldExpand = this.groupViews.size > 1 && this.isGroupExpanded(locationView);
			newGroupView = this.doCreateGroupView(groupToCopy);

			this.gridWidget.addView(
				newGroupView,
				this.getSplitSizingStyle(),
				locationView,
				this.toGridViewDirection(direction),
			);

			this.updateContainer();

			this._onDidAddGroup.fire(newGroupView);

			this.notifyGroupIndexChange();

			if (shouldExpand) {
				this.arrangeGroups(GroupsArrangement.EXPAND, newGroupView);
			}

			if (restoreFocus) {
				locationView.focus();
			}
		}

		else {
			newGroupView = locationView.groupsView.addGroup(locationView, direction, groupToCopy);
		}

		return newGroupView;
	}

	private getSplitSizingStyle(): Sizing {
		switch (this._partOptions.splitSizing) {
			case 'distribute':
				return Sizing.Distribute;
			case 'split':
				return Sizing.Split;
			default:
				return Sizing.Auto;
		}
	}

	protected getGroupViewOptions(): IEditorGroupViewOptions | undefined {
		return undefined;
	}

	private doCreateGroupView(from?: IEditorGroupView | ISerializedEditorGroupModel | null, options?: IEditorGroupViewOptions): IEditorGroupView {

		const resolvedOptions: IEditorGroupViewOptions | undefined = { ...this.getGroupViewOptions(), ...options };

		let groupView: IEditorGroupView;
		if (from instanceof EditorGroupView) {
			groupView = EditorGroupView.createCopy(from, this.editorPartsView, this, this.groupsLabel, this.count, this.scopedInstantiationService, resolvedOptions);
		} else if (isSerializedEditorGroupModel(from)) {
			groupView = EditorGroupView.createFromSerialized(from, this.editorPartsView, this, this.groupsLabel, this.count, this.scopedInstantiationService, resolvedOptions);
		} else {
			groupView = EditorGroupView.createNew(this.editorPartsView, this, this.groupsLabel, this.count, this.scopedInstantiationService, resolvedOptions);
		}

		this.groupViews.set(groupView.id, groupView);

		const groupDisposables = new DisposableStore();
		groupDisposables.add(groupView.onDidFocus(() => {
			this.doSetGroupActive(groupView);

			this._onDidFocus.fire();
		}));

		groupDisposables.add(groupView.onDidModelChange(e => {
			switch (e.kind) {
				case GroupModelChangeKind.GROUP_LOCKED:
					this._onDidChangeGroupLocked.fire(groupView);
					break;
				case GroupModelChangeKind.GROUP_INDEX:
					this._onDidChangeGroupIndex.fire(groupView);
					break;
				case GroupModelChangeKind.GROUP_LABEL:
					this._onDidChangeGroupLabel.fire(groupView);
					break;
			}
		}));

		groupDisposables.add(groupView.onDidActiveEditorChange(() => {
			this.updateContainer();
		}));

		Event.once(groupView.onWillDispose)(() => {
			dispose(groupDisposables);
			this.groupViews.delete(groupView.id);
			this.doUpdateMostRecentActive(groupView);
		});

		return groupView;
	}

	private doSetGroupActive(group: IEditorGroupView, reason = GroupActivationReason.DEFAULT): void {
		if (this._activeGroup !== group) {
			const previousActiveGroup = this._activeGroup;
			this._activeGroup = group;

			this.doUpdateMostRecentActive(group, true);

			if (previousActiveGroup && !previousActiveGroup.disposed) {
				previousActiveGroup.setActive(false);
			}

			group.setActive(true);

			this.doRestoreGroup(group);

			this._onDidChangeActiveGroup.fire(group);
		}

		this._onDidActivateGroup.fire({ group, reason });
	}

	private doRestoreGroup(group: IEditorGroupView): void {
		if (!this.gridWidget) {
			return;
		}

		try {
			if (this.hasMaximizedGroup() && !this.isGroupMaximized(group)) {
				this.unmaximizeGroup();
			}

			const viewSize = this.gridWidget.getViewSize(group);
			if (viewSize.width === group.minimumWidth || viewSize.height === group.minimumHeight) {
				this.arrangeGroups(GroupsArrangement.EXPAND, group);
			}
		} catch (error) {
		}
	}

	private doUpdateMostRecentActive(group: IEditorGroupView, makeMostRecentlyActive?: boolean): void {
		const index = this.mostRecentActiveGroups.indexOf(group.id);

		if (index !== -1) {
			this.mostRecentActiveGroups.splice(index, 1);
		}

		if (makeMostRecentlyActive) {
			this.mostRecentActiveGroups.unshift(group.id);
		}
	}

	private toGridViewDirection(direction: GroupDirection): Direction {
		switch (direction) {
			case GroupDirection.UP: return Direction.Up;
			case GroupDirection.DOWN: return Direction.Down;
			case GroupDirection.LEFT: return Direction.Left;
			case GroupDirection.RIGHT: return Direction.Right;
		}
	}

	private toGridViewOrientation(orientation: GroupOrientation, fallback: Orientation): Orientation {
		if (typeof orientation === 'number') {
			return orientation === GroupOrientation.HORIZONTAL ? Orientation.HORIZONTAL : Orientation.VERTICAL;
		}

		return fallback;
	}

	removeGroup(group: IEditorGroupView | GroupIdentifier, preserveFocus?: boolean): void {
		const groupView = this.assertGroupView(group);
		if (this.count === 1) {
			return;
		}

		if (groupView.isEmpty) {
			this.doRemoveEmptyGroup(groupView, preserveFocus);
		}

		else {
			this.doRemoveGroupWithEditors(groupView);
		}
	}

	private doRemoveGroupWithEditors(groupView: IEditorGroupView): void {
		const mostRecentlyActiveGroups = this.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);

		let lastActiveGroup: IEditorGroupView;
		if (this._activeGroup === groupView) {
			lastActiveGroup = mostRecentlyActiveGroups[1];
		} else {
			lastActiveGroup = mostRecentlyActiveGroups[0];
		}

		this.mergeGroup(groupView, lastActiveGroup);
	}

	private doRemoveEmptyGroup(groupView: IEditorGroupView, preserveFocus?: boolean): void {
		const restoreFocus = !preserveFocus && this.shouldRestoreFocus(this.container);

		if (this._activeGroup === groupView) {
			const mostRecentlyActiveGroups = this.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
			const nextActiveGroup = mostRecentlyActiveGroups[1];
			this.doSetGroupActive(nextActiveGroup);
		}

		this.gridWidget.removeView(groupView, this.getSplitSizingStyle());
		groupView.dispose();

		if (restoreFocus) {
			this._activeGroup.focus();
		}

		this.notifyGroupIndexChange();

		this.updateContainer();

		this._onDidRemoveGroup.fire(groupView);
	}

	moveGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView {
		const sourceView = this.assertGroupView(group);
		const targetView = this.assertGroupView(location);

		if (sourceView.id === targetView.id) {
			throw new Error('Cannot move group into its own');
		}

		const restoreFocus = this.shouldRestoreFocus(sourceView.element);
		let movedView: IEditorGroupView;

		if (sourceView.groupsView === targetView.groupsView) {
			this.gridWidget.moveView(sourceView, this.getSplitSizingStyle(), targetView, this.toGridViewDirection(direction));
			movedView = sourceView;
		}

		else {
			movedView = targetView.groupsView.addGroup(targetView, direction, sourceView);
			sourceView.closeAllEditors({ force: true });
			this.removeGroup(sourceView, restoreFocus);
		}

		if (restoreFocus) {
			movedView.focus();
		}

		this._onDidMoveGroup.fire(movedView);

		this.notifyGroupIndexChange();

		return movedView;
	}

	copyGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView {
		const groupView = this.assertGroupView(group);
		const locationView = this.assertGroupView(location);

		const restoreFocus = this.shouldRestoreFocus(groupView.element);

		const copiedGroupView = this.addGroup(locationView, direction, groupView);

		if (restoreFocus) {
			copiedGroupView.focus();
		}

		return copiedGroupView;
	}

	mergeGroup(group: IEditorGroupView | GroupIdentifier, target: IEditorGroupView | GroupIdentifier, options?: IMergeGroupOptions): boolean {
		const sourceView = this.assertGroupView(group);
		const targetView = this.assertGroupView(target);

		const editors: EditorInputWithOptions[] = [];
		let index = (options && typeof options.index === 'number') ? options.index : targetView.count;
		for (const editor of sourceView.editors) {
			const inactive = !sourceView.isActive(editor) || this._activeGroup !== sourceView;

			let actualIndex: number | undefined;
			if (targetView.contains(editor) &&
				(
					targetView.isSticky(editor) ||
					options?.preserveExistingIndex
				)
			) {
			} else {
				actualIndex = index;
				index++;
			}

			editors.push({
				editor,
				options: {
					index: actualIndex,
					inactive,
					preserveFocus: inactive
				}
			});
		}

		let result = true;
		if (options?.mode === MergeGroupMode.COPY_EDITORS) {
			sourceView.copyEditors(editors, targetView);
		} else {
			result = sourceView.moveEditors(editors, targetView);
		}

		if (sourceView.isEmpty && !sourceView.disposed ) {
			this.removeGroup(sourceView, true);
		}

		return result;
	}

	mergeAllGroups(target: IEditorGroupView | GroupIdentifier, options?: IMergeGroupOptions): boolean {
		const targetView = this.assertGroupView(target);

		let result = true;
		for (const group of this.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			if (group === targetView) {
				continue;
			}

			const merged = this.mergeGroup(group, targetView, options);
			if (!merged) {
				result = false;
			}
		}

		return result;
	}

	protected assertGroupView(group: IEditorGroupView | GroupIdentifier): IEditorGroupView {
		let groupView: IEditorGroupView | undefined;
		if (typeof group === 'number') {
			groupView = this.editorPartsView.getGroup(group);
		} else {
			groupView = group;
		}

		if (!groupView) {
			throw new Error('Invalid editor group provided!');
		}

		return groupView;
	}

	createEditorDropTarget(container: unknown, delegate: IEditorDropTargetDelegate): IDisposable {
		assertType(isHTMLElement(container));

		return this.scopedInstantiationService.createInstance(EditorDropTarget, this, container, delegate);
	}


	get minimumWidth(): number { return Math.min(this.centeredLayoutWidget.minimumWidth, this.layoutService.getMaximumEditorDimensions(this.layoutService.getContainer(getWindow(this.container))).width); }
	get maximumWidth(): number { return this.centeredLayoutWidget.maximumWidth; }
	get minimumHeight(): number { return Math.min(this.centeredLayoutWidget.minimumHeight, this.layoutService.getMaximumEditorDimensions(this.layoutService.getContainer(getWindow(this.container))).height); }
	get maximumHeight(): number { return this.centeredLayoutWidget.maximumHeight; }

	get snap(): boolean { return this.layoutService.getPanelAlignment() === 'center'; }

	override get onDidChange(): Event<IViewSize | undefined> { return Event.any(this.centeredLayoutWidget.onDidChange, this.onDidSetGridWidget.event); }
	readonly priority: LayoutPriority = LayoutPriority.High;

	private get gridSeparatorBorder(): Color {
		return this.theme.getColor(EDITOR_GROUP_BORDER) || this.theme.getColor(contrastBorder) || Color.transparent;
	}

	override updateStyles(): void {
		this.container.style.backgroundColor = this.getColor(editorBackground) || '';

		const separatorBorderStyle = { separatorBorder: this.gridSeparatorBorder, background: this.theme.getColor(EDITOR_PANE_BACKGROUND) || Color.transparent };
		this.gridWidget.style(separatorBorderStyle);
		this.centeredLayoutWidget.styles(separatorBorderStyle);
	}

	protected override createContentArea(parent: HTMLElement, options?: IEditorPartCreationOptions): HTMLElement {

		this.element = parent;
		if (this.windowId !== mainWindow.vscodeWindowId) {
			this.container.classList.add('auxiliary');
		}
		parent.appendChild(this.container);

		this._willRestoreState = !options || options.restorePreviousState;
		this.doCreateGridControl();

		this.centeredLayoutWidget = this._register(new CenteredViewLayout(this.container, this.gridWidgetView, this.profileMemento[EditorPart.EDITOR_PART_CENTERED_VIEW_STORAGE_KEY], this._partOptions.centeredLayoutFixedWidth));
		this._register(this.onDidChangeEditorPartOptions(e => this.centeredLayoutWidget.setFixedWidth(e.newPartOptions.centeredLayoutFixedWidth ?? false)));

		this.setupDragAndDropSupport(parent, this.container);

		this.handleContextKeys();

		this.whenReadyPromise.complete();
		this._isReady = true;

		Promises.settled(this.groups.map(group => group.whenRestored)).finally(() => {
			this.whenRestoredPromise.complete();
		});

		return this.container;
	}

	protected handleContextKeys(): void {
		EditorAreaFocusContext.bindTo(this.scopedContextKeyService).set(true);

		const multipleEditorGroupsContext = EditorPartMultipleEditorGroupsContext.bindTo(this.scopedContextKeyService);
		const maximizedEditorGroupContext = EditorPartMaximizedEditorGroupContext.bindTo(this.scopedContextKeyService);
		const editorTabsVisibleContext = EditorTabsVisibleContext.bindTo(this.scopedContextKeyService);

		const updateContextKeys = () => {
			const groupCount = this.count;
			if (groupCount > 1) {
				multipleEditorGroupsContext.set(true);
			} else {
				multipleEditorGroupsContext.reset();
			}

			if (this.hasMaximizedGroup()) {
				maximizedEditorGroupContext.set(true);
			} else {
				maximizedEditorGroupContext.reset();
			}
		};

		const updateEditorTabsVisibleContext = () => {
			editorTabsVisibleContext.set(this.partOptions.showTabs === 'multiple');
		};

		const updateTopRightGroupContextKey = () => {
			if (!this.gridWidget || !this._contentDimension) {
				return;
			}

			let topRightGroup: IEditorGroupView | undefined;
			for (const group of this.groups) {
				if (
					this.gridWidget.getNeighborViews(group, Direction.Up).length === 0 &&
					this.gridWidget.getNeighborViews(group, Direction.Right).length === 0
				) {
					topRightGroup = group;
					break;
				}
			}

			for (const group of this.groups) {
				const contextKey = this.editorPartsView.bind(IsTopRightEditorGroupContext, group);
				contextKey.set(group === topRightGroup);
			}
		};

		updateContextKeys();
		updateEditorTabsVisibleContext();
		updateTopRightGroupContextKey();

		this._register(this.onDidAddGroup(() => {
			updateContextKeys();
			updateTopRightGroupContextKey();
			this.applyContentRightInset();
		}));
		this._register(this.onDidRemoveGroup(() => {
			updateContextKeys();
			updateTopRightGroupContextKey();
			this.applyContentRightInset();
		}));
		this._register(this.onDidChangeGroupMaximized(() => {
			updateContextKeys();
			this.applyContentRightInset();
		}));
		this._register(this.onDidChangeEditorPartOptions(() => updateEditorTabsVisibleContext()));
		this._register(this.onDidMoveGroup(() => {
			updateTopRightGroupContextKey();
			this.applyContentRightInset();
		}));
		this._register(this.onDidLayout(() => updateTopRightGroupContextKey()));
	}

	private setupDragAndDropSupport(parent: HTMLElement, container: HTMLElement): void {

		this._register(this.createEditorDropTarget(container, Object.create(null)));

		const overlay = $('.drop-block-overlay');
		parent.appendChild(overlay);

		this._register(addDisposableGenericMouseDownListener(overlay, () => overlay.classList.remove('visible')));

		this._register(CompositeDragAndDropObserver.INSTANCE.registerTarget(this.element, {
			onDragStart: e => overlay.classList.add('visible'),
			onDragEnd: e => overlay.classList.remove('visible')
		}));

		let horizontalOpenerTimeout: Timeout | undefined;
		let verticalOpenerTimeout: Timeout | undefined;
		let lastOpenHorizontalPosition: Position | undefined;
		let lastOpenVerticalPosition: Position | undefined;
		const openPartAtPosition = (position: Position) => {
			if (!this.layoutService.isVisible(Parts.PANEL_PART) && position === this.layoutService.getPanelPosition()) {
				this.layoutService.setPartHidden(false, Parts.PANEL_PART);
			} else if (!this.layoutService.isVisible(Parts.AUXILIARYBAR_PART) && position === (this.layoutService.getSideBarPosition() === Position.RIGHT ? Position.LEFT : Position.RIGHT)) {
				this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
			}
		};

		const clearAllTimeouts = () => {
			if (horizontalOpenerTimeout) {
				clearTimeout(horizontalOpenerTimeout);
				horizontalOpenerTimeout = undefined;
			}

			if (verticalOpenerTimeout) {
				clearTimeout(verticalOpenerTimeout);
				verticalOpenerTimeout = undefined;
			}
		};

		this._register(CompositeDragAndDropObserver.INSTANCE.registerTarget(overlay, {
			onDragOver: e => {
				EventHelper.stop(e.eventData, true);
				if (e.eventData.dataTransfer) {
					e.eventData.dataTransfer.dropEffect = 'none';
				}

				const boundingRect = overlay.getBoundingClientRect();

				let openHorizontalPosition: Position | undefined = undefined;
				let openVerticalPosition: Position | undefined = undefined;
				const proximity = 100;
				if (e.eventData.clientX < boundingRect.left + proximity) {
					openHorizontalPosition = Position.LEFT;
				}

				if (e.eventData.clientX > boundingRect.right - proximity) {
					openHorizontalPosition = Position.RIGHT;
				}

				if (e.eventData.clientY > boundingRect.bottom - proximity) {
					openVerticalPosition = Position.BOTTOM;
				}

				if (e.eventData.clientY < boundingRect.top + proximity) {
					openVerticalPosition = Position.TOP;
				}

				if (horizontalOpenerTimeout && openHorizontalPosition !== lastOpenHorizontalPosition) {
					clearTimeout(horizontalOpenerTimeout);
					horizontalOpenerTimeout = undefined;
				}

				if (verticalOpenerTimeout && openVerticalPosition !== lastOpenVerticalPosition) {
					clearTimeout(verticalOpenerTimeout);
					verticalOpenerTimeout = undefined;
				}

				if (!horizontalOpenerTimeout && openHorizontalPosition !== undefined) {
					lastOpenHorizontalPosition = openHorizontalPosition;
					horizontalOpenerTimeout = setTimeout(() => openPartAtPosition(openHorizontalPosition), 200);
				}

				if (!verticalOpenerTimeout && openVerticalPosition !== undefined) {
					lastOpenVerticalPosition = openVerticalPosition;
					verticalOpenerTimeout = setTimeout(() => openPartAtPosition(openVerticalPosition), 200);
				}
			},
			onDragLeave: () => clearAllTimeouts(),
			onDragEnd: () => clearAllTimeouts(),
			onDrop: () => clearAllTimeouts()
		}));

		this._register(toDisposable(() => clearAllTimeouts()));
	}

	centerLayout(active: boolean): void {
		this.centeredLayoutWidget.activate(active);
	}

	isLayoutCentered(): boolean {
		if (this.centeredLayoutWidget) {
			return this.centeredLayoutWidget.isActive();
		}

		return false;
	}

	private doCreateGridControl(): void {

		let restoreError = false;
		if (this._willRestoreState) {
			restoreError = !this.doCreateGridControlWithPreviousState();
		}

		if (!this.gridWidget || restoreError) {
			const initialGroup = this.doCreateGroupView();
			this.doSetGridWidget(new SerializableGrid(initialGroup));

			this.doSetGroupActive(initialGroup);
		}

		this.updateContainer();

		this.notifyGroupIndexChange();
	}

	private doCreateGridControlWithPreviousState(): boolean {
		const state: IEditorPartUIState | undefined = this.loadState();
		if (state?.serializedGrid) {
			try {

				this.mostRecentActiveGroups = state.mostRecentActiveGroups;

				this.doCreateGridControlWithState(state.serializedGrid, state.activeGroup);
			} catch (error) {

				onUnexpectedError(new Error(`Error restoring editor grid widget: ${error} (with state: ${JSON.stringify(state)})`));

				this.disposeGroups();

				return false;
			}
		}

		return true;
	}

	private doCreateGridControlWithState(serializedGrid: ISerializedGrid, activeGroupId: GroupIdentifier, editorGroupViewsToReuse?: IEditorGroupView[], options?: IEditorGroupViewOptions): void {

		let reuseGroupViews: IEditorGroupView[];
		if (editorGroupViewsToReuse) {
			reuseGroupViews = editorGroupViewsToReuse.slice(0);
		} else {
			reuseGroupViews = [];
		}

		const groupViews: IEditorGroupView[] = [];
		const gridWidget = SerializableGrid.deserialize(serializedGrid, {
			fromJSON: (serializedEditorGroup: ISerializedEditorGroupModel | null) => {
				let groupView: IEditorGroupView;
				if (reuseGroupViews.length > 0) {
					groupView = reuseGroupViews.shift()!;
				} else {
					groupView = this.doCreateGroupView(serializedEditorGroup, options);
				}

				groupViews.push(groupView);

				if (groupView.id === activeGroupId) {
					this.doSetGroupActive(groupView);
				}

				return groupView;
			}
		}, { styles: { separatorBorder: this.gridSeparatorBorder } });

		if (!this._activeGroup) {
			this.doSetGroupActive(groupViews[0]);
		}

		if (this.mostRecentActiveGroups.some(groupId => !this.getGroup(groupId))) {
			this.mostRecentActiveGroups = groupViews.map(group => group.id);
		}

		this.doSetGridWidget(gridWidget);
	}

	private doSetGridWidget(gridWidget: SerializableGrid<IEditorGroupView>): void {
		let boundarySashes: IBoundarySashes = {};

		if (this.gridWidget) {
			boundarySashes = this.gridWidget.boundarySashes;
			this.gridWidget.dispose();
		}

		this.gridWidget = gridWidget;
		this.gridWidget.boundarySashes = boundarySashes;
		this.gridWidgetView.gridWidget = gridWidget;

		this._onDidChangeSizeConstraints.input = gridWidget.onDidChange;
		this._onDidScroll.input = gridWidget.onDidScroll;
		this.gridWidgetDisposables.clear();
		this.gridWidgetDisposables.add(gridWidget.onDidChangeViewMaximized(maximized => this._onDidChangeGroupMaximized.fire(maximized)));

		this.onDidSetGridWidget.fire(undefined);
	}

	private updateContainer(): void {
		this.container.classList.toggle('empty', this.isEmpty);
	}

	private notifyGroupIndexChange(): void {
		this.getGroups(GroupsOrder.GRID_APPEARANCE).forEach((group, index) => group.notifyIndexChanged(index));
	}

	notifyGroupsLabelChange(newLabel: string) {
		for (const group of this.groups) {
			group.notifyLabelChanged(newLabel);
		}
	}

	private get isEmpty(): boolean {
		return this.count === 1 && this._activeGroup.isEmpty;
	}

	setBoundarySashes(sashes: IBoundarySashes): void {
		this.gridWidget.boundarySashes = sashes;
		this.centeredLayoutWidget.boundarySashes = sashes;
	}

	override layout(width: number, height: number, top: number, left: number): void {
		this.top = top;
		this.left = left;

		if (this.windowId === mainWindow.vscodeWindowId && this.layoutService.isFloatingPanelsEnabled()) {

			const owners = getFloatingOuterEdgeOwners(this.layoutService);
			const outerLeft = owners.left === Parts.EDITOR_PART;
			const outerRight = owners.right === Parts.EDITOR_PART;

			const leftMargin = outerLeft ? FLOATING_PANEL_MARGIN * 2 : FLOATING_PANEL_MARGIN;
			const rightMargin = outerRight ? FLOATING_PANEL_MARGIN * 2 : FLOATING_PANEL_INNER_MARGIN;

			width = Math.max(0, width - leftMargin - rightMargin);
			const { top, bottom } = getFloatingEditorVerticalMargins(this.layoutService, mainWindow);
			height = Math.max(0, height - top - bottom);

			if (!this.element.classList.contains('modal-editor-part')) {
				width = Math.max(0, width - EDITOR_FRAME_BORDER_WIDTH * 2);
				height = Math.max(0, height - EDITOR_FRAME_BORDER_WIDTH * 2);
			}

			this.element.classList.toggle('floating-editor-outer-left', outerLeft);
			this.element.classList.toggle('floating-editor-outer-right', outerRight);
		} else {
			this.element.classList.remove('floating-editor-outer-left', 'floating-editor-outer-right');
		}

		const contentAreaSize = super.layoutContents(width, height).contentSize;

		this.doLayout(Dimension.lift(contentAreaSize), top, left);
	}

	private doLayout(dimension: Dimension, top = this.top, left = this.left): void {
		this._contentDimension = dimension;

		this.centeredLayoutWidget.layout(this._contentDimension.width, this._contentDimension.height, top, left);

		this._onDidLayout.fire(dimension);
	}

	protected override saveState(): void {

		if (this.gridWidget) {
			if (this.isEmpty) {
				delete this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY];
			} else {
				this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY] = this.createState();
			}
		}

		if (this.centeredLayoutWidget) {
			const centeredLayoutState = this.centeredLayoutWidget.state;
			if (this.centeredLayoutWidget.isDefault(centeredLayoutState)) {
				delete this.profileMemento[EditorPart.EDITOR_PART_CENTERED_VIEW_STORAGE_KEY];
			} else {
				this.profileMemento[EditorPart.EDITOR_PART_CENTERED_VIEW_STORAGE_KEY] = centeredLayoutState;
			}
		}

		super.saveState();
	}

	protected loadState(): IEditorPartUIState | undefined {
		return this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY];
	}

	createState(): IEditorPartUIState {
		return {
			serializedGrid: this.gridWidget.serialize(),
			activeGroup: this._activeGroup.id,
			mostRecentActiveGroups: this.mostRecentActiveGroups
		};
	}

	applyState(state: IEditorPartUIState | 'empty', options?: IEditorGroupViewOptions): Promise<void> {
		if (state === 'empty') {
			return this.doApplyEmptyState();
		} else {
			return this.doApplyState(state, options);
		}
	}

	private async doApplyState(state: IEditorPartUIState, options?: IEditorGroupViewOptions): Promise<void> {
		const groups = await this.doPrepareApplyState();


		this._onDidAddGroup.pause();
		this._onDidRemoveGroup.pause();

		this.disposeGroups();

		this.mostRecentActiveGroups = state.mostRecentActiveGroups;

		try {
			this.doApplyGridState(state.serializedGrid, state.activeGroup, undefined, options);
		} finally {
			this._onDidRemoveGroup.resume();
			this._onDidAddGroup.resume();
		}

		await this.activeGroup.openEditors(
			groups
				.flatMap(group => group.editors)
				.filter(editor => this.editorPartsView.groups.every(groupView => !groupView.contains(editor)))
				.map(editor => ({
					editor, options: { pinned: true, preserveFocus: true, inactive: true }
				}))
		);
	}

	private async doApplyEmptyState(): Promise<void> {
		await this.doPrepareApplyState();

		this.mergeAllGroups(this.activeGroup);
	}

	private async doPrepareApplyState(): Promise<IEditorGroupView[]> {


		const groups = this.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		for (const group of groups) {
			await group.closeAllEditors({ excludeConfirming: true, force: true });
		}

		return groups;
	}

	private doApplyGridState(gridState: ISerializedGrid, activeGroupId: GroupIdentifier, editorGroupViewsToReuse?: IEditorGroupView[], options?: IEditorGroupViewOptions): void {

		this.doCreateGridControlWithState(gridState, activeGroupId, editorGroupViewsToReuse, options);

		if (this._contentDimension) {
			this.doLayout(this._contentDimension);
		}

		this.updateContainer();

		for (const groupView of this.getGroups(GroupsOrder.GRID_APPEARANCE)) {
			if (!editorGroupViewsToReuse?.includes(groupView)) {
				this._onDidAddGroup.fire(groupView);
			}
		}

		this.notifyGroupIndexChange();
	}

	private onDidChangeMementoState(e: IStorageValueChangeEvent): void {
		if (e.external && e.scope === StorageScope.WORKSPACE) {
			this.reloadMemento(e.scope);

			const state = this.loadState();
			if (state) {
				this.applyState(state);
			}
		}
	}

	toJSON(): object {
		return {
			type: Parts.EDITOR_PART
		};
	}

	private disposeGroups(): void {
		for (const group of this.groups) {
			group.dispose();

			this._onDidRemoveGroup.fire(group);
		}

		this.groupViews.clear();
		this.mostRecentActiveGroups = [];
	}

	override dispose(): void {

		this._onWillDispose.fire();

		this.disposeGroups();

		this.gridWidget?.dispose();

		super.dispose();
	}

}

export class MainEditorPart extends EditorPart {

	constructor(
		editorPartsView: IEditorPartsView,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IHostService hostService: IHostService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(editorPartsView, Parts.EDITOR_PART, '', mainWindow.vscodeWindowId, instantiationService, themeService, configurationService, storageService, layoutService, hostService, contextKeyService);
	}
}
