/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { refineServiceDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { Part } from '../../../browser/part.js';
import { IDimension } from '../../../../base/browser/dom.js';
import { Direction, IViewSize } from '../../../../base/browser/ui/grid/grid.js';
import { isMacintosh, isNative, isWeb } from '../../../../base/common/platform.js';
import { isAuxiliaryWindow, mainWindow } from '../../../../base/browser/window.js';
import { CustomTitleBarVisibility, TitleBarSetting, getMenuBarVisibility, hasCustomTitlebar, hasNativeMenu, hasNativeTitlebar } from '../../../../platform/window/common/window.js';
import { isFullscreen, isWCOEnabled } from '../../../../base/browser/browser.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

export const IWorkbenchLayoutService = refineServiceDecorator<ILayoutService, IWorkbenchLayoutService>(ILayoutService);

export const enum Parts {
	TITLEBAR_PART = 'workbench.parts.titlebar',
	BANNER_PART = 'workbench.parts.banner',
	ACTIVITYBAR_PART = 'workbench.parts.activitybar',
	SIDEBAR_PART = 'workbench.parts.sidebar',
	PANEL_PART = 'workbench.parts.panel',
	AUXILIARYBAR_PART = 'workbench.parts.auxiliarybar',
	SESSIONS_PART = 'workbench.parts.sessions',
	CUSTOM_VIEW_GRID_PART = 'workbench.parts.customViewGrid',
	EDITOR_PART = 'workbench.parts.editor',
	STATUSBAR_PART = 'workbench.parts.statusbar'
}

export const enum ZenModeSettings {
	SHOW_TABS = 'zenMode.showTabs',
	HIDE_LINENUMBERS = 'zenMode.hideLineNumbers',
	HIDE_STATUSBAR = 'zenMode.hideStatusBar',
	HIDE_ACTIVITYBAR = 'zenMode.hideActivityBar',
	CENTER_LAYOUT = 'zenMode.centerLayout',
	FULLSCREEN = 'zenMode.fullScreen',
	RESTORE = 'zenMode.restore',
	SILENT_NOTIFICATIONS = 'zenMode.silentNotifications',
}

export const enum LayoutSettings {
	ACTIVITY_BAR_LOCATION = 'workbench.activityBar.location',
	ACTIVITY_BAR_AUTO_HIDE = 'workbench.activityBar.autoHide',
	ACTIVITY_BAR_COMPACT = 'workbench.activityBar.compact',
	EDITOR_TABS_MODE = 'workbench.editor.showTabs',
	EDITOR_ACTIONS_LOCATION = 'workbench.editor.editorActionsLocation',
	COMMAND_CENTER = 'window.commandCenter',
	LAYOUT_ACTIONS = 'workbench.layoutControl.enabled',
	SHADOWS = 'workbench.shadows',
	MODERN_UI = 'workbench.experimental.modernUI',
	MODERN_UI_DENSITY = 'window.density.layout',
	MODERN_UI_EDITOR_TAB_STYLE = 'workbench.experimental.modernUIEditorTabStyle',
	MODERN_UI_UPPERCASE_VIEW_HEADERS = 'workbench.experimental.modernUIUppercaseViewHeaders'
}

export const enum ModernUIEditorTabStyle {
	Connected = 'connected',
	Pill = 'pill'
}

export const enum ModernUIDensity {
	Default = 'default',
	Compact = 'compact'
}

export const FLOATING_PANEL_MARGIN = 4;
export const COMPACT_FLOATING_PANEL_MARGIN = 0;
export const COMPACT_FLOATING_PANEL_OUTER_MARGIN = 4;


export const FLOATING_PANEL_INNER_MARGIN = 2;

export const enum ActivityBarPosition {
	DEFAULT = 'default',
	TOP = 'top',
	BOTTOM = 'bottom',
	HIDDEN = 'hidden'
}

export const enum EditorTabsMode {
	MULTIPLE = 'multiple',
	SINGLE = 'single',
	NONE = 'none'
}

export const enum EditorActionsLocation {
	DEFAULT = 'default',
	TITLEBAR = 'titleBar',
	HIDDEN = 'hidden'
}

export const enum Position {
	LEFT,
	RIGHT,
	BOTTOM,
	TOP
}

export function isHorizontal(position: Position): boolean {
	return position === Position.BOTTOM || position === Position.TOP;
}

export const enum PartOpensMaximizedOptions {
	ALWAYS,
	NEVER,
	REMEMBER_LAST
}

export type PanelAlignment = 'left' | 'center' | 'right' | 'justify';

export function positionToString(position: Position): string {
	switch (position) {
		case Position.LEFT: return 'left';
		case Position.RIGHT: return 'right';
		case Position.BOTTOM: return 'bottom';
		case Position.TOP: return 'top';
		default: return 'bottom';
	}
}

export function isFloatingTopEdgeExposed(layoutService: IWorkbenchLayoutService, targetWindow: Window): boolean {
	return !layoutService.isVisible(Parts.TITLEBAR_PART, targetWindow) && !layoutService.isVisible(Parts.BANNER_PART);
}

export function getFloatingOuterEdgeOwners(layoutService: IWorkbenchLayoutService): { left: Parts | undefined; right: Parts | undefined } {
	if (!layoutService.isFloatingPanelsEnabled()) {
		return { left: undefined, right: undefined };
	}

	const sideBarLeft = layoutService.getSideBarPosition() === Position.LEFT;
	const panelPosition = layoutService.getPanelPosition();
	const verticalPanelVisible = !isHorizontal(panelPosition) && layoutService.isVisible(Parts.PANEL_PART);

	const panelInLeftSequence = verticalPanelVisible && panelPosition === Position.LEFT;
	const panelInRightSequence = verticalPanelVisible && panelPosition === Position.RIGHT;

	const sideBarGroup: Parts[] = [Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART];
	const panelGroup: Parts[] = [Parts.PANEL_PART];
	const fullOrder: Parts[] = sideBarLeft
		? [
			...sideBarGroup,
			...(panelInLeftSequence ? panelGroup : []),
			Parts.EDITOR_PART,
			...(panelInRightSequence ? panelGroup : []),
			Parts.AUXILIARYBAR_PART
		]
		: [
			Parts.AUXILIARYBAR_PART,
			...(panelInLeftSequence ? panelGroup : []),
			Parts.EDITOR_PART,
			...(panelInRightSequence ? panelGroup : []),
			...[...sideBarGroup].reverse()
		];

	return {
		left: resolveFloatingOuterOwner(layoutService, fullOrder),
		right: resolveFloatingOuterOwner(layoutService, [...fullOrder].reverse())
	};
}

function resolveFloatingOuterOwner(layoutService: IWorkbenchLayoutService, orderedParts: Parts[]): Parts | undefined {
	for (const part of orderedParts) {
		const visible = part === Parts.EDITOR_PART
			? layoutService.isVisible(Parts.EDITOR_PART, mainWindow)
			: layoutService.isVisible(part as SINGLE_WINDOW_PARTS);
		if (!visible) {
			continue;
		}

		return part === Parts.ACTIVITYBAR_PART ? undefined : part;
	}

	return undefined;
}

export function getFloatingOuterGutterEdges(layoutService: IWorkbenchLayoutService, partId: Parts): { left: boolean; right: boolean } {
	if (!layoutService.isFloatingPanelsEnabled()) {
		return { left: false, right: false };
	}

	if (partId === Parts.PANEL_PART && isHorizontal(layoutService.getPanelPosition())) {
		return getFloatingHorizontalPanelOuterEdges(layoutService);
	}

	const owners = getFloatingOuterEdgeOwners(layoutService);
	return { left: owners.left === partId, right: owners.right === partId };
}

export function getFloatingSidebarSiblingToEditorStatus(
	layoutService: IWorkbenchLayoutService
): { sideBar: boolean; auxBar: boolean } {
	const alignment = layoutService.getPanelAlignment();
	const sideBarOnLeft = layoutService.getSideBarPosition() === Position.LEFT;
	return {
		sideBar: !(alignment === 'center' || (sideBarOnLeft && alignment === 'right') || (!sideBarOnLeft && alignment === 'left')),
		auxBar: !(alignment === 'center' || (!sideBarOnLeft && alignment === 'right') || (sideBarOnLeft && alignment === 'left')),
	};
}

export function getFloatingPaneCompositeVerticalMargins(
	layoutService: IWorkbenchLayoutService,
	partId: Parts,
	targetWindow: Window
): { top: number; bottom: number } {
	if (!layoutService.isFloatingPanelsEnabled()) {
		return { top: 0, bottom: 0 };
	}

	const topEdgeExposed = isFloatingTopEdgeExposed(layoutService, targetWindow);

	const panelPosition = layoutService.getPanelPosition();
	const panelVisible = layoutService.isVisible(Parts.PANEL_PART);
	const isSideBar = partId === Parts.SIDEBAR_PART || partId === Parts.AUXILIARYBAR_PART;
	const siblingStatus = getFloatingSidebarSiblingToEditorStatus(layoutService);
	const isSiblingToEditor = partId === Parts.SIDEBAR_PART ? siblingStatus.sideBar : siblingStatus.auxBar;
	const facesPanelAbove = panelVisible && panelPosition === Position.TOP && isSideBar && isSiblingToEditor;
	const facesEditorBelow = partId === Parts.PANEL_PART && panelPosition === Position.TOP;
	const facesPanelBelow = panelVisible && panelPosition === Position.BOTTOM && isSideBar && isSiblingToEditor;
	const atWindowBottom = !facesEditorBelow && !facesPanelBelow;
	const statusBarVisible = layoutService.isVisible(Parts.STATUSBAR_PART, targetWindow);

	return {
		top: facesPanelAbove ? FLOATING_PANEL_MARGIN
			: topEdgeExposed ? FLOATING_PANEL_MARGIN * 2 : FLOATING_PANEL_MARGIN,
		bottom: atWindowBottom
			? statusBarVisible ? FLOATING_PANEL_MARGIN : FLOATING_PANEL_MARGIN * 2
			: FLOATING_PANEL_INNER_MARGIN
	};
}

export function getFloatingEditorVerticalMargins(
	layoutService: IWorkbenchLayoutService,
	targetWindow: Window
): { top: number; bottom: number } {
	if (!layoutService.isFloatingPanelsEnabled()) {
		return { top: 0, bottom: 0 };
	}

	const panelVisible = layoutService.isVisible(Parts.PANEL_PART);
	const panelPosition = layoutService.getPanelPosition();
	const panelAtTop = panelVisible && panelPosition === Position.TOP;
	const panelAtBottom = panelVisible && panelPosition === Position.BOTTOM;

	return {
		top: panelAtTop ? FLOATING_PANEL_MARGIN
			: isFloatingTopEdgeExposed(layoutService, targetWindow) ? FLOATING_PANEL_MARGIN * 2 : FLOATING_PANEL_MARGIN,
		bottom: panelAtBottom ? FLOATING_PANEL_INNER_MARGIN
			: layoutService.isVisible(Parts.STATUSBAR_PART, targetWindow) ? FLOATING_PANEL_MARGIN : FLOATING_PANEL_MARGIN * 2
	};
}

function getFloatingHorizontalPanelOuterEdges(layoutService: IWorkbenchLayoutService): { left: boolean; right: boolean } {
	if (!layoutService.isVisible(Parts.PANEL_PART)) {
		return { left: false, right: false };
	}

	const sideBarLeft = layoutService.getSideBarPosition() === Position.LEFT;
	const { sideBar: sideBarSiblingToEditor, auxBar: auxSiblingToEditor } = getFloatingSidebarSiblingToEditorStatus(layoutService);

	const sideBarSideReached = !layoutService.isVisible(Parts.ACTIVITYBAR_PART) && (!layoutService.isVisible(Parts.SIDEBAR_PART) || sideBarSiblingToEditor);
	const auxSideReached = !layoutService.isVisible(Parts.AUXILIARYBAR_PART) || auxSiblingToEditor;

	return sideBarLeft
		? { left: sideBarSideReached, right: auxSideReached }
		: { left: auxSideReached, right: sideBarSideReached };
}

const positionsByString: { [key: string]: Position } = {
	[positionToString(Position.LEFT)]: Position.LEFT,
	[positionToString(Position.RIGHT)]: Position.RIGHT,
	[positionToString(Position.BOTTOM)]: Position.BOTTOM,
	[positionToString(Position.TOP)]: Position.TOP
};

export function positionFromString(str: string): Position {
	return positionsByString[str];
}

function partOpensMaximizedSettingToString(setting: PartOpensMaximizedOptions): string {
	switch (setting) {
		case PartOpensMaximizedOptions.ALWAYS: return 'always';
		case PartOpensMaximizedOptions.NEVER: return 'never';
		case PartOpensMaximizedOptions.REMEMBER_LAST: return 'preserve';
		default: return 'preserve';
	}
}

const partOpensMaximizedByString: { [key: string]: PartOpensMaximizedOptions } = {
	[partOpensMaximizedSettingToString(PartOpensMaximizedOptions.ALWAYS)]: PartOpensMaximizedOptions.ALWAYS,
	[partOpensMaximizedSettingToString(PartOpensMaximizedOptions.NEVER)]: PartOpensMaximizedOptions.NEVER,
	[partOpensMaximizedSettingToString(PartOpensMaximizedOptions.REMEMBER_LAST)]: PartOpensMaximizedOptions.REMEMBER_LAST
};

export function partOpensMaximizedFromString(str: string): PartOpensMaximizedOptions {
	return partOpensMaximizedByString[str];
}

export type MULTI_WINDOW_PARTS = Parts.EDITOR_PART | Parts.STATUSBAR_PART | Parts.TITLEBAR_PART;
export type SINGLE_WINDOW_PARTS = Exclude<Parts, MULTI_WINDOW_PARTS>;

export function isMultiWindowPart(part: Parts): part is MULTI_WINDOW_PARTS {
	return part === Parts.EDITOR_PART ||
		part === Parts.STATUSBAR_PART ||
		part === Parts.TITLEBAR_PART;
}

export interface IPartVisibilityChangeEvent {
	readonly partId: string;
	readonly visible: boolean;
	readonly source?: 'resize';
}

export interface IWorkbenchLayoutService extends ILayoutService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeZenMode: Event<boolean>;

	readonly onDidChangeWindowMaximized: Event<{ readonly windowId: number; readonly maximized: boolean }>;

	readonly onDidChangeMainEditorCenteredLayout: Event<boolean>;

	readonly onDidChangePanelPosition: Event<string>;

	readonly onDidChangePanelAlignment: Event<PanelAlignment>;

	readonly onDidChangePartVisibility: Event<IPartVisibilityChangeEvent>;

	readonly onDidChangeNotificationsVisibility: Event<boolean>;

	readonly onDidChangeAuxiliaryBarMaximized: Event<void>;

	readonly openedDefaultEditors: boolean;

	layout(): void;

	isRestored(): boolean;

	readonly whenRestored: Promise<void>;

	hasFocus(part: Parts): boolean;

	isFloatingPanelsEnabled(): boolean;
	isModernUICompact?(): boolean;

	focusPart(part: SINGLE_WINDOW_PARTS): void;
	focusPart(part: MULTI_WINDOW_PARTS, targetWindow: Window): void;
	focusPart(part: Parts, targetWindow: Window): void;

	getContainer(targetWindow: Window): HTMLElement;
	getContainer(targetWindow: Window, part: Parts): HTMLElement | undefined;

	isVisible(part: SINGLE_WINDOW_PARTS): boolean;
	isVisible(part: MULTI_WINDOW_PARTS, targetWindow: Window): boolean;
	isVisible(part: Parts, targetWindow: Window): boolean;

	setPartHidden(hidden: boolean, part: Parts): void;

	isSecondarySideBarVisible(): boolean;

	toggleSecondarySideBar(): void;

	toggleMaximizedPanel(): void;

	isPanelMaximized(): boolean;

	toggleMaximizedAuxiliaryBar(): void;

	setAuxiliaryBarMaximized(maximized: boolean): boolean;

	isAuxiliaryBarMaximized(): boolean;

	hasMainWindowBorder(): boolean;

	getMainWindowBorderRadius(): string | undefined;

	getSideBarPosition(): Position;

	toggleMenuBar(): void;

	getPanelPosition(): Position;

	setPanelPosition(position: Position): void;

	getPanelAlignment(): PanelAlignment;

	setPanelAlignment(alignment: PanelAlignment): void;

	getMaximumEditorDimensions(container: HTMLElement): IDimension;

	toggleZenMode(): void;

	isMainEditorLayoutCentered(): boolean;

	centerMainEditorLayout(active: boolean): void;

	getSize(part: Parts): IViewSize;

	setSize(part: Parts, size: IViewSize): void;

	resizePart(part: Parts, sizeChangeWidth: number, sizeChangeHeight: number): void;

	registerPart(part: Part): IDisposable;

	isWindowMaximized(targetWindow: Window): boolean;

	updateWindowMaximizedState(targetWindow: Window, maximized: boolean): void;

	getVisibleNeighborPart(part: Parts, direction: Direction): Parts | undefined;
}

export function shouldShowCustomTitleBar(configurationService: IConfigurationService, window: Window, menuBarToggled?: boolean): boolean {
	if (!hasCustomTitlebar(configurationService)) {
		return false;
	}

	const inFullscreen = isFullscreen(window);
	const nativeTitleBarEnabled = hasNativeTitlebar(configurationService);

	if (!isWeb) {
		const showCustomTitleBar = configurationService.getValue<CustomTitleBarVisibility>(TitleBarSetting.CUSTOM_TITLE_BAR_VISIBILITY);
		if (showCustomTitleBar === CustomTitleBarVisibility.NEVER && nativeTitleBarEnabled || showCustomTitleBar === CustomTitleBarVisibility.WINDOWED && inFullscreen) {
			return false;
		}
	}

	if (!isTitleBarEmpty(configurationService)) {
		return true;
	}

	if (nativeTitleBarEnabled && hasNativeMenu(configurationService)) {
		return false;
	}

	if (isMacintosh && isNative) {
		return !inFullscreen;
	}

	if (isNative && !inFullscreen) {
		return true;
	}

	if (isWCOEnabled() && !inFullscreen) {
		return true;
	}

	const menuBarVisibility = !isAuxiliaryWindow(window) ? getMenuBarVisibility(configurationService) : 'hidden';
	switch (menuBarVisibility) {
		case 'classic':
			return !inFullscreen || !!menuBarToggled;
		case 'compact':
		case 'hidden':
			return false;
		case 'toggle':
			return !!menuBarToggled;
		case 'visible':
			return true;
		default:
			return isWeb ? false : !inFullscreen || !!menuBarToggled;
	}
}

function isTitleBarEmpty(configurationService: IConfigurationService): boolean {

	if (configurationService.getValue<boolean>(LayoutSettings.COMMAND_CENTER)) {
		return false;
	}

	const activityBarPosition = configurationService.getValue<ActivityBarPosition>(LayoutSettings.ACTIVITY_BAR_LOCATION);
	if (activityBarPosition === ActivityBarPosition.TOP || activityBarPosition === ActivityBarPosition.BOTTOM) {
		return false;
	}

	const editorActionsLocation = configurationService.getValue<EditorActionsLocation>(LayoutSettings.EDITOR_ACTIONS_LOCATION);
	const editorTabsMode = configurationService.getValue<EditorTabsMode>(LayoutSettings.EDITOR_TABS_MODE);
	if (editorActionsLocation === EditorActionsLocation.TITLEBAR || editorActionsLocation === EditorActionsLocation.DEFAULT && editorTabsMode === EditorTabsMode.NONE) {
		return false;
	}

	if (configurationService.getValue<boolean>(LayoutSettings.LAYOUT_ACTIONS)) {
		return false;
	}

	return true;
}
