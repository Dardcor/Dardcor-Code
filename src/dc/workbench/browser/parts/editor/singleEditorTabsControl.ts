/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/singleeditortabscontrol.css';
import { EditorResourceAccessor, Verbosity, IEditorPartOptions, SideBySideEditor, preventEditorClose, EditorCloseMethod, IToolbarActions, EditorInputCapabilities } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorTabsControl } from './editorTabsControl.js';
import { ResourceLabel, IResourceLabel } from '../../labels.js';
import { TAB_ACTIVE_FOREGROUND, TAB_UNFOCUSED_ACTIVE_FOREGROUND } from '../../../common/theme.js';
import { EventType as TouchEventType, GestureEvent, Gesture } from '../../../../base/browser/touch.js';
import { addDisposableListener, EventType, EventHelper, Dimension, isAncestor, DragAndDropObserver, isHTMLElement, $ } from '../../../../base/browser/dom.js';
import { CLOSE_EDITOR_COMMAND_ID, UNLOCK_GROUP_COMMAND_ID } from './editorCommands.js';
import { Color } from '../../../../base/common/color.js';
import { assertReturnsDefined, assertReturnsAllDefined } from '../../../../base/common/types.js';
import { equals } from '../../../../base/common/objects.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { defaultBreadcrumbsWidgetStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IEditorTitleControlDimensions } from './editorTitleControl.js';
import { BreadcrumbsControlFactory } from './breadcrumbsControl.js';

interface IRenderedEditorLabel {
	readonly editor?: EditorInput;
	readonly pinned: boolean;
}

export class SingleEditorTabsControl extends EditorTabsControl {

	private titleContainer: HTMLElement | undefined;
	private editorLabel: IResourceLabel | undefined;
	private activeLabel: IRenderedEditorLabel = Object.create(null);

	private breadcrumbsControlFactory: BreadcrumbsControlFactory | undefined;
	private get breadcrumbsControl() { return this.breadcrumbsControlFactory?.control; }

	protected override create(parent: HTMLElement): HTMLElement {
		super.create(parent);

		const titleContainer = this.titleContainer = parent;
		titleContainer.draggable = true;

		this.registerContainerListeners(titleContainer);

		this._register(Gesture.addTarget(titleContainer));

		const labelContainer = $('.label-container');
		titleContainer.appendChild(labelContainer);

		this.editorLabel = this._register(this.instantiationService.createInstance(ResourceLabel, labelContainer, {})).element;
		this._register(addDisposableListener(this.editorLabel.element, EventType.CLICK, e => this.onTitleLabelClick(e)));

		this.breadcrumbsControlFactory = this._register(this.instantiationService.createInstance(BreadcrumbsControlFactory, labelContainer, this.groupView, {
			showFileIcons: false,
			showSymbolIcons: true,
			showDecorationColors: false,
			widgetStyles: { ...defaultBreadcrumbsWidgetStyles, breadcrumbsBackground: Color.transparent.toString() },
			showPlaceholder: false,
			dragEditor: true,
		}));
		this._register(this.breadcrumbsControlFactory.onDidEnablementChange(() => this.handleBreadcrumbsEnablementChange()));
		titleContainer.classList.toggle('breadcrumbs', Boolean(this.breadcrumbsControl));
		this._register(toDisposable(() => titleContainer.classList.remove('breadcrumbs')));

		this.createEditorActionsToolBar(titleContainer, ['title-actions']);

		return titleContainer;
	}

	private registerContainerListeners(titleContainer: HTMLElement): void {

		let lastDragEvent: DragEvent | undefined = undefined;
		let isNewWindowOperation = false;
		this._register(new DragAndDropObserver(titleContainer, {
			onDragStart: e => { isNewWindowOperation = this.onGroupDragStart(e, titleContainer); },
			onDrag: e => { lastDragEvent = e; },
			onDragEnd: e => { this.onGroupDragEnd(e, lastDragEvent, titleContainer, isNewWindowOperation); },
		}));

		this._register(addDisposableListener(titleContainer, EventType.DBLCLICK, e => this.onTitleDoubleClick(e)));

		this._register(addDisposableListener(titleContainer, EventType.AUXCLICK, e => this.onTitleAuxClick(e)));

		this._register(addDisposableListener(titleContainer, TouchEventType.Tap, (e: GestureEvent) => this.onTitleTap(e)));

		for (const event of [EventType.CONTEXT_MENU, TouchEventType.Contextmenu]) {
			this._register(addDisposableListener(titleContainer, event, e => {
				if (this.tabsModel.activeEditor) {
					this.onTabContextMenu(this.tabsModel.activeEditor, e, titleContainer);
				}
			}));
		}
	}

	private onTitleLabelClick(e: MouseEvent): void {
		EventHelper.stop(e, false);

		setTimeout(() => this.quickInputService.quickAccess.show());
	}

	private onTitleDoubleClick(e: MouseEvent): void {
		EventHelper.stop(e);

		this.groupView.pinEditor();
	}

	private onTitleAuxClick(e: MouseEvent): void {
		if (e.button === 1 && this.tabsModel.activeEditor) {
			EventHelper.stop(e, true );

			if (!this.tabsModel.activeEditor.hasCapability(EditorInputCapabilities.CannotClose) && !preventEditorClose(this.tabsModel, this.tabsModel.activeEditor, EditorCloseMethod.MOUSE, this.groupsView.partOptions)) {
				this.groupView.closeEditor(this.tabsModel.activeEditor);
			}
		}
	}

	private onTitleTap(e: GestureEvent): void {

		const target = e.initialTarget;
		if (!(isHTMLElement(target)) || !this.editorLabel || !isAncestor(target, this.editorLabel.element)) {
			return;
		}

		setTimeout(() => this.quickInputService.quickAccess.show(), 50);
	}

	openEditor(editor: EditorInput): boolean {
		return this.doHandleOpenEditor();
	}

	openEditors(editors: EditorInput[]): boolean {
		return this.doHandleOpenEditor();
	}

	private doHandleOpenEditor(): boolean {
		const activeEditorChanged = this.ifActiveEditorChanged(() => this.redraw());
		if (!activeEditorChanged) {
			this.ifActiveEditorPropertiesChanged(() => this.redraw());
		}

		return activeEditorChanged;
	}

	beforeCloseEditor(editor: EditorInput): void {
	}

	closeEditor(editor: EditorInput): void {
		this.ifActiveEditorChanged(() => this.redraw());
	}

	closeEditors(editors: EditorInput[]): void {
		this.ifActiveEditorChanged(() => this.redraw());
	}

	moveEditor(editor: EditorInput, fromIndex: number, targetIndex: number): void {
		this.ifActiveEditorChanged(() => this.redraw());
	}

	pinEditor(editor: EditorInput): void {
		this.ifEditorIsActive(editor, () => this.redraw());
	}

	stickEditor(editor: EditorInput): void { }

	unstickEditor(editor: EditorInput): void { }

	setActive(isActive: boolean): void {
		this.redraw();
	}

	updateEditorSelections(): void { }

	updateEditorLabel(editor: EditorInput): void {
		this.ifEditorIsActive(editor, () => this.redraw());
	}

	updateEditorCapabilities(editor: EditorInput): void {
		this.ifEditorIsActive(editor, () => this.redraw());
	}

	updateEditorDirty(editor: EditorInput): void {
		this.ifEditorIsActive(editor, () => {
			const titleContainer = assertReturnsDefined(this.titleContainer);

			if (editor.isDirty() && !editor.isSaving()) {
				titleContainer.classList.add('dirty');
			}

			else {
				titleContainer.classList.remove('dirty');
			}
		});
	}

	override updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {
		super.updateOptions(oldOptions, newOptions);

		if (oldOptions.labelFormat !== newOptions.labelFormat || !equals(oldOptions.decorations, newOptions.decorations)) {
			this.redraw();
		}
	}

	override updateStyles(): void {
		this.redraw();
	}

	protected handleBreadcrumbsEnablementChange(): void {
		const titleContainer = assertReturnsDefined(this.titleContainer);
		titleContainer.classList.toggle('breadcrumbs', Boolean(this.breadcrumbsControl));

		this.redraw();
	}

	private ifActiveEditorChanged(fn: () => void): boolean {
		if (
			!this.activeLabel.editor && this.tabsModel.activeEditor ||
			this.activeLabel.editor && !this.tabsModel.activeEditor ||
			(!this.activeLabel.editor || !this.tabsModel.isActive(this.activeLabel.editor))
		) {
			fn();

			return true;
		}

		return false;
	}

	private ifActiveEditorPropertiesChanged(fn: () => void): void {
		if (!this.activeLabel.editor || !this.tabsModel.activeEditor) {
			return;
		}

		if (this.activeLabel.pinned !== this.tabsModel.isPinned(this.tabsModel.activeEditor)) {
			fn();
		}
	}

	private ifEditorIsActive(editor: EditorInput, fn: () => void): void {
		if (this.tabsModel.isActive(editor)) {
			fn();
		}
	}

	private redraw(): void {
		const editor = this.tabsModel.activeEditor ?? undefined;
		const options = this.groupsView.partOptions;

		const isEditorPinned = editor ? this.tabsModel.isPinned(editor) : false;
		const isGroupActive = this.groupsView.activeGroup === this.groupView;

		this.activeLabel = { editor, pinned: isEditorPinned };

		if (this.breadcrumbsControl) {
			if (isGroupActive) {
				this.breadcrumbsControl.update();
				this.breadcrumbsControl.domNode.classList.toggle('preview', !isEditorPinned);
			} else {
				this.breadcrumbsControl.hide();
			}
		}

		const [titleContainer, editorLabel] = assertReturnsAllDefined(this.titleContainer, this.editorLabel);
		if (!editor) {
			titleContainer.classList.remove('dirty');
			editorLabel.clear();
			this.clearEditorActionsToolbar();
		}

		else {

			this.updateEditorDirty(editor);

			const { labelFormat } = this.groupsView.partOptions;
			let description: string;
			if (this.breadcrumbsControl && !this.breadcrumbsControl.isHidden()) {
				description = '';
			} else if (labelFormat === 'default' && !isGroupActive) {
				description = '';
			} else {
				description = editor.getDescription(this.getVerbosity(labelFormat)) || '';
			}

			editorLabel.setResource(
				{
					resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }),
					name: editor.getName(),
					description
				},
				{
					title: this.getHoverTitle(editor),
					italic: !isEditorPinned,
					extraClasses: ['single-tab', 'title-label'].concat(editor.getLabelExtraClasses()),
					fileDecorations: {
						colors: Boolean(options.decorations?.colors),
						badges: Boolean(options.decorations?.badges)
					},
					icon: editor.getIcon(),
					hideIcon: options.showIcons === false,
				}
			);

			if (isGroupActive) {
				titleContainer.style.color = this.getColor(TAB_ACTIVE_FOREGROUND) || '';
			} else {
				titleContainer.style.color = this.getColor(TAB_UNFOCUSED_ACTIVE_FOREGROUND) || '';
			}

			this.updateEditorActionsToolbar();
		}
	}

	private getVerbosity(style: string | undefined): Verbosity {
		switch (style) {
			case 'short': return Verbosity.SHORT;
			case 'long': return Verbosity.LONG;
			default: return Verbosity.MEDIUM;
		}
	}

	protected override prepareEditorActions(editorActions: IToolbarActions): IToolbarActions {
		const isGroupActive = this.groupsView.activeGroup === this.groupView;

		if (isGroupActive) {
			return editorActions;
		}

		else {
			return {
				primary: this.groupsView.partOptions.alwaysShowEditorActions ? editorActions.primary : editorActions.primary.filter(action => action.id === CLOSE_EDITOR_COMMAND_ID || action.id === UNLOCK_GROUP_COMMAND_ID),
				secondary: editorActions.secondary
			};
		}
	}

	protected override prepareEditorLayoutActions(editorActions: IToolbarActions): IToolbarActions {
		return editorActions;
	}

	getHeight(): number {
		return this.tabHeight;
	}

	layout(dimensions: IEditorTitleControlDimensions): Dimension {
		this.breadcrumbsControl?.layout(undefined);

		return new Dimension(dimensions.container.width, this.getHeight());
	}
}
