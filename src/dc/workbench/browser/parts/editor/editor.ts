/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GroupIdentifier, IWorkbenchEditorConfiguration, IEditorIdentifier, IEditorCloseEvent, IEditorPartOptions, IEditorPartOptionsChangeEvent, SideBySideEditor, EditorCloseContext, IEditorPane, IEditorPartLimitOptions, IEditorPartDecorationOptions, IEditorWillOpenEvent, EditorInputWithOptions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IEditorGroup, GroupDirection, IMergeGroupOptions, GroupsOrder, GroupsArrangement, IAuxiliaryEditorPart, IEditorPart, IModalEditorPart, GroupActivationReason } from '../../../services/editor/common/editorGroupsService.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { Event } from '../../../../base/common/event.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ISerializableView } from '../../../../base/browser/ui/grid/grid.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { isObject } from '../../../../base/common/types.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IWindowsConfiguration } from '../../../../platform/window/common/window.js';
import { BooleanVerifier, EnumVerifier, NumberVerifier, ObjectVerifier, SetVerifier, verifyObject } from '../../../../base/common/verifier.js';
import { IAuxiliaryWindowOpenOptions } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { ContextKeyValue, IContextKey, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { coalesce } from '../../../../base/common/arrays.js';

export interface IEditorPartCreationOptions {
	readonly restorePreviousState: boolean;
}

export const DEFAULT_EDITOR_MIN_DIMENSIONS = new Dimension(220, 70);
export const DEFAULT_EDITOR_MAX_DIMENSIONS = new Dimension(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

export const DEFAULT_EDITOR_PART_OPTIONS: IEditorPartOptions = {
	showTabs: 'multiple',
	highlightModifiedTabs: false,
	tabActionLocation: 'right',
	tabActionCloseVisibility: true,
	tabActionUnpinVisibility: true,
	showTabIndex: false,
	alwaysShowEditorActions: false,
	tabSizing: 'fit',
	tabSizingFixedMinWidth: 50,
	tabSizingFixedMaxWidth: 160,
	pinnedTabSizing: 'normal',
	pinnedTabsOnSeparateRow: false,
	tabHeight: 'default',
	preventPinnedEditorClose: 'keyboardAndMouse',
	titleScrollbarSizing: 'default',
	titleScrollbarVisibility: 'auto',
	focusRecentEditorAfterClose: true,
	showIcons: true,
	hasIcons: true,
	enablePreview: false,
	openPositioning: 'right',
	openSideBySideDirection: 'right',
	closeEmptyGroups: true,
	labelFormat: 'default',
	splitSizing: 'auto',
	splitOnDragAndDrop: true,
	allowDropIntoGroup: true,
	dragToOpenWindow: true,
	centeredLayoutFixedWidth: false,
	doubleClickTabToToggleEditorGroupSizes: 'expand',
	editorActionsLocation: 'default',
	wrapTabs: false,
	enablePreviewFromQuickOpen: false,
	scrollToSwitchTabs: false,
	enablePreviewFromCodeNavigation: false,
	closeOnFileDelete: false,
	swipeToNavigate: false,
	mouseBackForwardToNavigate: true,
	restoreViewState: true,
	splitInGroupLayout: 'horizontal',
	revealIfOpen: false,
	get limit(): IEditorPartLimitOptions { return { enabled: false, value: 10, perEditorGroup: false, excludeDirty: false }; },
	get decorations(): IEditorPartDecorationOptions { return { badges: true, colors: true }; },
	get autoLockGroups(): Set<string> { return new Set<string>(); }
};

export function impactsEditorPartOptions(event: IConfigurationChangeEvent): boolean {
	return event.affectsConfiguration('workbench.editor') || event.affectsConfiguration('workbench.iconTheme') || event.affectsConfiguration('window.density');
}

export function getEditorPartOptions(configurationService: IConfigurationService, themeService: IThemeService): IEditorPartOptions {
	const options = {
		...DEFAULT_EDITOR_PART_OPTIONS,
		hasIcons: themeService.getFileIconTheme().hasFileIcons
	};

	const config = configurationService.getValue<IWorkbenchEditorConfiguration>();
	if (config?.workbench?.editor) {

		Object.assign(options, config.workbench.editor);

		if (isObject(config.workbench.editor.autoLockGroups)) {
			options.autoLockGroups = DEFAULT_EDITOR_PART_OPTIONS.autoLockGroups;

			for (const [editorId, enablement] of Object.entries(config.workbench.editor.autoLockGroups)) {
				if (enablement === true) {
					options.autoLockGroups.add(editorId);
				}
			}
		} else {
			options.autoLockGroups = DEFAULT_EDITOR_PART_OPTIONS.autoLockGroups;
		}
	}

	const windowConfig = configurationService.getValue<IWindowsConfiguration>();
	if (windowConfig?.window?.density?.editorTabHeight) {
		options.tabHeight = windowConfig.window.density.editorTabHeight;
	}

	return validateEditorPartOptions(options);
}

function validateEditorPartOptions(options: IEditorPartOptions): IEditorPartOptions {

	if (typeof options.showTabs === 'boolean') {
		options.showTabs = options.showTabs ? 'multiple' : 'single';
	}

	return verifyObject<IEditorPartOptions>({
		'wrapTabs': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['wrapTabs']),
		'scrollToSwitchTabs': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['scrollToSwitchTabs']),
		'highlightModifiedTabs': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['highlightModifiedTabs']),
		'tabActionCloseVisibility': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['tabActionCloseVisibility']),
		'tabActionUnpinVisibility': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['tabActionUnpinVisibility']),
		'showTabIndex': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['showTabIndex']),
		'alwaysShowEditorActions': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['alwaysShowEditorActions']),
		'pinnedTabsOnSeparateRow': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['pinnedTabsOnSeparateRow']),
		'focusRecentEditorAfterClose': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['focusRecentEditorAfterClose']),
		'showIcons': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['showIcons']),
		'enablePreview': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['enablePreview']),
		'enablePreviewFromQuickOpen': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['enablePreviewFromQuickOpen']),
		'enablePreviewFromCodeNavigation': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['enablePreviewFromCodeNavigation']),
		'closeOnFileDelete': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['closeOnFileDelete']),
		'closeEmptyGroups': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['closeEmptyGroups']),
		'revealIfOpen': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['revealIfOpen']),
		'swipeToNavigate': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['swipeToNavigate']),
		'mouseBackForwardToNavigate': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['mouseBackForwardToNavigate']),
		'restoreViewState': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['restoreViewState']),
		'splitOnDragAndDrop': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['splitOnDragAndDrop']),
		'allowDropIntoGroup': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['allowDropIntoGroup']),
		'dragToOpenWindow': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['dragToOpenWindow']),
		'centeredLayoutFixedWidth': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['centeredLayoutFixedWidth']),
		'hasIcons': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['hasIcons']),

		'tabSizingFixedMinWidth': new NumberVerifier(DEFAULT_EDITOR_PART_OPTIONS['tabSizingFixedMinWidth']),
		'tabSizingFixedMaxWidth': new NumberVerifier(DEFAULT_EDITOR_PART_OPTIONS['tabSizingFixedMaxWidth']),

		'showTabs': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['showTabs'], ['multiple', 'single', 'none']),
		'tabActionLocation': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['tabActionLocation'], ['left', 'right']),
		'tabSizing': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['tabSizing'], ['fit', 'shrink', 'fixed']),
		'pinnedTabSizing': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['pinnedTabSizing'], ['normal', 'compact', 'shrink']),
		'tabHeight': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['tabHeight'], ['default', 'compact']),
		'preventPinnedEditorClose': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['preventPinnedEditorClose'], ['keyboardAndMouse', 'keyboard', 'mouse', 'never']),
		'titleScrollbarSizing': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['titleScrollbarSizing'], ['default', 'large']),
		'titleScrollbarVisibility': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['titleScrollbarVisibility'], ['auto', 'visible', 'hidden']),
		'openPositioning': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['openPositioning'], ['left', 'right', 'first', 'last']),
		'openSideBySideDirection': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['openSideBySideDirection'], ['right', 'down']),
		'labelFormat': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['labelFormat'], ['default', 'short', 'medium', 'long']),
		'splitInGroupLayout': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['splitInGroupLayout'], ['vertical', 'horizontal']),
		'splitSizing': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['splitSizing'], ['distribute', 'split', 'auto']),
		'doubleClickTabToToggleEditorGroupSizes': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['doubleClickTabToToggleEditorGroupSizes'], ['maximize', 'expand', 'off']),
		'editorActionsLocation': new EnumVerifier(DEFAULT_EDITOR_PART_OPTIONS['editorActionsLocation'], ['default', 'titleBar', 'hidden']),
		'autoLockGroups': new SetVerifier<string>(DEFAULT_EDITOR_PART_OPTIONS['autoLockGroups']),

		'limit': new ObjectVerifier<IEditorPartLimitOptions>(DEFAULT_EDITOR_PART_OPTIONS['limit'], {
			'enabled': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['limit']['enabled']),
			'value': new NumberVerifier(DEFAULT_EDITOR_PART_OPTIONS['limit']['value']),
			'perEditorGroup': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['limit']['perEditorGroup']),
			'excludeDirty': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['limit']['excludeDirty'])
		}),
		'decorations': new ObjectVerifier<IEditorPartDecorationOptions>(DEFAULT_EDITOR_PART_OPTIONS['decorations'], {
			'badges': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['decorations']['badges']),
			'colors': new BooleanVerifier(DEFAULT_EDITOR_PART_OPTIONS['decorations']['colors'])
		}),
	}, options);
}

export interface IEditorPartsView {

	readonly mainPart: IEditorGroupsView;
	registerPart(part: IEditorPart): IDisposable;

	readonly activeGroup: IEditorGroupView;
	readonly groups: IEditorGroupView[];
	getGroup(identifier: GroupIdentifier): IEditorGroupView | undefined;
	getGroups(order?: GroupsOrder): IEditorGroupView[];

	readonly count: number;

	createAuxiliaryEditorPart(options?: IAuxiliaryWindowOpenOptions): Promise<IAuxiliaryEditorPart>;
	createModalEditorPart(): Promise<IModalEditorPart>;

	bind<T extends ContextKeyValue>(contextKey: RawContextKey<T>, group: IEditorGroupView): IContextKey<T>;
}

export interface IEditorGroupsView {

	readonly windowId: number;

	readonly groups: IEditorGroupView[];
	readonly activeGroup: IEditorGroupView;

	readonly partOptions: IEditorPartOptions;
	readonly onDidChangeEditorPartOptions: Event<IEditorPartOptionsChangeEvent>;

	readonly onDidVisibilityChange: Event<boolean>;

	getGroup(identifier: GroupIdentifier): IEditorGroupView | undefined;
	getGroups(order: GroupsOrder): IEditorGroupView[];

	activateGroup(identifier: IEditorGroupView | GroupIdentifier, preserveWindowOrder?: boolean, reason?: GroupActivationReason): IEditorGroupView;
	restoreGroup(identifier: IEditorGroupView | GroupIdentifier): IEditorGroupView;

	addGroup(location: IEditorGroupView | GroupIdentifier, direction: GroupDirection, groupToCopy?: IEditorGroupView): IEditorGroupView;
	mergeGroup(group: IEditorGroupView | GroupIdentifier, target: IEditorGroupView | GroupIdentifier, options?: IMergeGroupOptions): boolean;

	moveGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView;
	copyGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView;

	removeGroup(group: IEditorGroupView | GroupIdentifier, preserveFocus?: boolean): void;

	arrangeGroups(arrangement: GroupsArrangement, target?: IEditorGroupView | GroupIdentifier): void;
	toggleMaximizeGroup(group?: IEditorGroupView | GroupIdentifier): void;
	toggleExpandGroup(group?: IEditorGroupView | GroupIdentifier): void;
}

export interface IEditorGroupTitleHeight {

	readonly total: number;

	readonly offset: number;
}

export interface IEditorGroupViewOptions {

	readonly preserveFocus?: boolean;

	readonly menuIds?: IEditorGroupMenuIds;

	readonly showHeader?: boolean;
}

export interface IEditorGroupMenuIds {
	readonly headerPrimary?: MenuId;
	readonly headerSecondary?: MenuId;
	readonly headerLayout?: MenuId;
	readonly editorActions?: MenuId;
	readonly tabsBarContext?: MenuId;
	readonly tabsBarAddTab?: MenuId;
}

export interface IEditorGroupView extends IDisposable, ISerializableView, IEditorGroup {

	readonly onDidFocus: Event<void>;

	readonly onWillOpenEditor: Event<IEditorWillOpenEvent>;
	readonly onDidOpenEditorFail: Event<EditorInput>;

	readonly onDidCloseEditor: Event<IEditorCloseEvent>;

	readonly groupsView: IEditorGroupsView;

	readonly whenRestored: Promise<void>;

	readonly titleHeight: IEditorGroupTitleHeight;

	readonly disposed: boolean;

	setActive(isActive: boolean): void;

	notifyIndexChanged(newIndex: number): void;
	notifyLabelChanged(newLabel: string): void;

	openEditor(editor: EditorInput, options?: IEditorOptions, internalOptions?: IInternalEditorOpenOptions): Promise<IEditorPane | undefined>;

	relayout(): void;
}

export function fillActiveEditorViewState(group: IEditorGroup, expectedActiveEditor?: EditorInput, presetOptions?: IEditorOptions): IEditorOptions {
	if (!expectedActiveEditor || !group.activeEditor || expectedActiveEditor.matches(group.activeEditor)) {
		const options: IEditorOptions = {
			...presetOptions,
			viewState: group.activeEditorPane?.getViewState()
		};

		return options;
	}

	return presetOptions || Object.create(null);
}

export function prepareMoveCopyEditors(sourceGroup: IEditorGroup, editors: EditorInput[], preserveFocus?: boolean): EditorInputWithOptions[] {
	if (editors.length === 0) {
		return [];
	}

	const editorsWithOptions: EditorInputWithOptions[] = [];

	let activeEditor: EditorInput | undefined;
	const inactiveEditors: EditorInput[] = [];
	for (const editor of editors) {
		if (!activeEditor && sourceGroup.isActive(editor)) {
			activeEditor = editor;
		} else {
			inactiveEditors.push(editor);
		}
	}

	if (!activeEditor) {
		activeEditor = inactiveEditors.shift();
	}

	inactiveEditors.sort((a, b) => sourceGroup.getIndexOfEditor(b) - sourceGroup.getIndexOfEditor(a));

	const sortedEditors = coalesce([activeEditor, ...inactiveEditors]);
	for (let i = 0; i < sortedEditors.length; i++) {
		const editor = sortedEditors[i];
		editorsWithOptions.push({
			editor,
			options: {
				pinned: true,
				sticky: sourceGroup.isSticky(editor),
				inactive: i > 0,
				preserveFocus
			}
		});
	}

	return editorsWithOptions;
}

export interface EditorServiceImpl extends IEditorService {

	readonly onDidOpenEditorFail: Event<IEditorIdentifier>;

	readonly onDidMostRecentlyActiveEditorsChange: Event<void>;
}

export interface IInternalEditorTitleControlOptions {

	readonly skipTitleUpdate?: boolean;
}

export interface IInternalEditorOpenOptions extends IInternalEditorTitleControlOptions {

	readonly supportSideBySide?: SideBySideEditor.ANY | SideBySideEditor.BOTH;

	readonly focusTabControl?: boolean;

	readonly preserveWindowOrder?: boolean;

	readonly inactiveSelection?: EditorInput[];
}

export interface IInternalEditorCloseOptions extends IInternalEditorTitleControlOptions {

	readonly fromError?: boolean;

	readonly context?: EditorCloseContext;

	readonly force?: boolean;
}

export interface IInternalMoveCopyOptions extends IInternalEditorOpenOptions {

	readonly keepCopy?: boolean;
}
