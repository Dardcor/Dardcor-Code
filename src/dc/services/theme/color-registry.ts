/**
 * Dardcor Code - Design System Color Token Registry (Task 129)
 */

import { createDecorator } from '../instantiation/annotations';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { Color } from '../../core/math/color';

export type ColorThemeKind = 'light' | 'dark' | 'hc';

export interface IColorDefaults {
	readonly light?: Color | string;
	readonly dark?: Color | string;
	readonly hc?: Color | string;
}

export interface IColorRegistration {
	readonly id: string;
	readonly defaults: IColorDefaults;
	readonly description: string;
}

export interface IColorRegistry {
	readonly _serviceBrand: undefined;
	registerColor(id: string, defaults: IColorDefaults, description?: string): IDisposable;
	getColor(id: string, kind?: ColorThemeKind): Color | undefined;
	getColorHex(id: string, kind?: ColorThemeKind): string | undefined;
	getRegistration(id: string): IColorRegistration | undefined;
	getAllColorIds(): string[];
	getAllRegistrations(): IColorRegistration[];
}

export const IColorRegistry = createDecorator<IColorRegistry>('colorRegistry');

export class ColorRegistry extends Disposable implements IColorRegistry {
	declare readonly _serviceBrand: undefined;

	private readonly _colors = new Map<string, IColorRegistration>();

	public registerColor(id: string, defaults: IColorDefaults, description: string = ''): IDisposable {
		this._colors.set(id, { id, defaults, description });
		return toDisposable(() => this._colors.delete(id));
	}

	public getColor(id: string, kind: ColorThemeKind = 'dark'): Color | undefined {
		const registration = this._colors.get(id);
		if (!registration) {
			return undefined;
		}
		const value = registration.defaults[kind] ?? registration.defaults.dark;
		if (value === undefined) {
			return undefined;
		}
		return typeof value === 'string' ? Color.fromHex(value) : value;
	}

	public getColorHex(id: string, kind: ColorThemeKind = 'dark'): string | undefined {
		const color = this.getColor(id, kind);
		return color ? color.toString() : undefined;
	}

	public getRegistration(id: string): IColorRegistration | undefined {
		return this._colors.get(id);
	}

	public getAllColorIds(): string[] {
		return [...this._colors.keys()];
	}

	public getAllRegistrations(): IColorRegistration[] {
		return [...this._colors.values()];
	}
}

let _globalRegistry: ColorRegistry | null = null;

export function getColorRegistry(): ColorRegistry {
	if (!_globalRegistry) {
		_globalRegistry = new ColorRegistry();
	}
	return _globalRegistry;
}

export function registerColor(id: string, defaults: IColorDefaults, description?: string): IDisposable {
	return getColorRegistry().registerColor(id, defaults, description);
}

export function resolveColorValue(id: string, kind: ColorThemeKind): string | undefined {
	return getColorRegistry().getColorHex(id, kind);
}

export namespace ColorTokens {
	export const editorBackground = 'editor.background';
	export const editorForeground = 'editor.foreground';
	export const editorCursorForeground = 'editorCursor.foreground';
	export const editorSelectionBackground = 'editor.selectionBackground';
	export const editorLineHighlightBackground = 'editor.lineHighlightBackground';
	export const editorLineNumberForeground = 'editorLineNumber.foreground';
	export const editorGutterBackground = 'editorGutter.background';
	export const editorIndentGuideBackground = 'editorIndentGuide.background';
	export const editorWidgetBackground = 'editorWidget.background';
	export const editorWidgetBorder = 'editorWidget.border';
	export const editorHoverWidgetBackground = 'editorHoverWidget.background';
	export const editorFindMatchBackground = 'editor.findMatchBackground';
	export const focusBorder = 'focusBorder';
	export const inputBackground = 'input.background';
	export const inputForeground = 'input.foreground';
	export const inputBorder = 'input.border';
	export const buttonBackground = 'button.background';
	export const buttonForeground = 'button.foreground';
	export const dropdownBackground = 'dropdown.background';
	export const dropdownBorder = 'dropdown.border';
	export const listHoverBackground = 'list.hoverBackground';
	export const listActiveSelectionBackground = 'list.activeSelectionBackground';
	export const listActiveSelectionForeground = 'list.activeSelectionForeground';
	export const listFocusBackground = 'list.focusBackground';
	export const sideBarBackground = 'sideBar.background';
	export const sideBarForeground = 'sideBar.foreground';
	export const activityBarBackground = 'activityBar.background';
	export const activityBarForeground = 'activityBar.foreground';
	export const statusBarBackground = 'statusBar.background';
	export const statusBarForeground = 'statusBar.foreground';
	export const titleBarActiveBackground = 'titleBar.activeBackground';
	export const titleBarActiveForeground = 'titleBar.activeForeground';
	export const panelBackground = 'panel.background';
	export const panelBorder = 'panel.border';
	export const scrollbarSliderBackground = 'scrollbarSlider.background';
	export const terminalBackground = 'terminal.background';
	export const terminalForeground = 'terminal.foreground';
	export const minimapBackground = 'minimap.background';
	export const breadcrumbsForeground = 'breadcrumbs.foreground';
	export const notificationCenterBackground = 'notificationCenter.background';
	export const menuBackground = 'menu.background';
	export const menuForeground = 'menu.foreground';
	// Debug
	export const debugToolBarBackground = 'debugToolBar.background';
	export const debugToolBarBorder = 'debugToolBar.border';
	export const debugIconStartForeground = 'debugIcon.startForeground';
	export const debugIconPauseForeground = 'debugIcon.pauseForeground';
	export const debugIconStopForeground = 'debugIcon.stopForeground';
	export const debugIconStepOverForeground = 'debugIcon.stepOverForeground';
	export const debugIconStepIntoForeground = 'debugIcon.stepIntoForeground';
	export const debugIconStepOutForeground = 'debugIcon.stepOutForeground';
	export const debugIconContinueForeground = 'debugIcon.continueForeground';
	export const debugIconStepBackForeground = 'debugIcon.stepBackForeground';
	export const debugConsoleInfoForeground = 'debugConsole.infoForeground';
	export const debugConsoleWarningForeground = 'debugConsole.warningForeground';
	export const debugConsoleErrorForeground = 'debugConsole.errorForeground';
	export const debugConsoleSourceForeground = 'debugConsole.sourceForeground';
	export const debugConsoleInputIconForeground = 'debugConsoleInputIcon.foreground';
	
	// Git
	export const gitDecorationAddedResourceForeground = 'gitDecoration.addedResourceForeground';
	export const gitDecorationModifiedResourceForeground = 'gitDecoration.modifiedResourceForeground';
	export const gitDecorationDeletedResourceForeground = 'gitDecoration.deletedResourceForeground';
	export const gitDecorationUntrackedResourceForeground = 'gitDecoration.untrackedResourceForeground';
	export const gitDecorationIgnoredResourceForeground = 'gitDecoration.ignoredResourceForeground';
	export const gitDecorationConflictingResourceForeground = 'gitDecoration.conflictingResourceForeground';
	export const gitDecorationSubmoduleResourceForeground = 'gitDecoration.submoduleResourceForeground';

	// Chat
	export const chatRequestBackground = 'chat.requestBackground';
	export const chatRequestBorder = 'chat.requestBorder';

	// Notebook
	export const notebookCellBorderColor = 'notebook.cellBorderColor';
	export const notebookCellHoverBackground = 'notebook.cellHoverBackground';
	export const notebookCellInsertionIndicator = 'notebook.cellInsertionIndicator';
	export const notebookCellStatusBarItemHoverBackground = 'notebook.cellStatusBarItemHoverBackground';
	export const notebookCellToolbarSeparator = 'notebook.cellToolbarSeparator';
	export const notebookEditorBackground = 'notebook.editorBackground';
	export const notebookFocusedCellBackground = 'notebook.focusedCellBackground';
	export const notebookFocusedCellBorder = 'notebook.focusedCellBorder';
	export const notebookFocusedEditorBorder = 'notebook.focusedEditorBorder';
	export const notebookInactiveFocusedCellBorder = 'notebook.inactiveFocusedCellBorder';
	export const notebookInactiveSelectedCellBorder = 'notebook.inactiveSelectedCellBorder';
	export const notebookOutputContainerBackgroundColor = 'notebook.outputContainerBackgroundColor';
	export const notebookOutputContainerBorderColor = 'notebook.outputContainerBorderColor';
	export const notebookSelectedCellBackground = 'notebook.selectedCellBackground';
	export const notebookSelectedCellBorder = 'notebook.selectedCellBorder';
	export const notebookSymbolHighlightBackground = 'notebook.symbolHighlightBackground';
	export const notebookScrollbarSliderActiveBackground = 'notebookScrollbarSlider.activeBackground';
	export const notebookScrollbarSliderBackground = 'notebookScrollbarSlider.background';
	export const notebookScrollbarSliderHoverBackground = 'notebookScrollbarSlider.hoverBackground';
	export const notebookStatusErrorIcon = 'notebookStatusErrorIcon.foreground';
	export const notebookStatusRunningIcon = 'notebookStatusRunningIcon.foreground';
	export const notebookStatusSuccessIcon = 'notebookStatusSuccessIcon.foreground';

	// Others
	export const widgetShadow = 'widget.shadow';
}

function registerDefaultColors(): void {
	const registry = getColorRegistry();
	const colors: Array<[string, IColorDefaults]> = [
		[ColorTokens.editorBackground, { light: '#ffffff', dark: '#1e1e1e', hc: '#000000' }],
		[ColorTokens.editorForeground, { light: '#000000', dark: '#d4d4d4', hc: '#ffffff' }],
		[ColorTokens.editorCursorForeground, { light: '#000000', dark: '#aeafad', hc: '#ffffff' }],
		[ColorTokens.editorSelectionBackground, { light: '#add6ff', dark: '#264f78', hc: '#ffffff' }],
		[ColorTokens.editorLineHighlightBackground, { light: '#f2f2f2', dark: '#2f3133' }],
		[ColorTokens.editorLineNumberForeground, { light: '#237893', dark: '#858585' }],
		[ColorTokens.editorGutterBackground, { light: '#ffffff', dark: '#1e1e1e' }],
		[ColorTokens.editorIndentGuideBackground, { light: '#d3d3d3', dark: '#404040' }],
		[ColorTokens.editorWidgetBackground, { light: '#f3f3f3', dark: '#252526' }],
		[ColorTokens.editorWidgetBorder, { light: '#c8c8c8', dark: '#454545' }],
		[ColorTokens.editorHoverWidgetBackground, { light: '#f3f3f3', dark: '#252526' }],
		[ColorTokens.editorFindMatchBackground, { light: '#a8ac94', dark: '#515c6a' }],
		[ColorTokens.focusBorder, { light: '#0090f1', dark: '#007fd4', hc: '#f38518' }],
		[ColorTokens.inputBackground, { light: '#ffffff', dark: '#3c3c3c', hc: '#000000' }],
		[ColorTokens.inputForeground, { light: '#000000', dark: '#cccccc', hc: '#ffffff' }],
		[ColorTokens.inputBorder, { light: '#cecece', dark: '#3c3c3c' }],
		[ColorTokens.buttonBackground, { light: '#007acc', dark: '#0e639c', hc: '#0e639c' }],
		[ColorTokens.buttonForeground, { light: '#ffffff', dark: '#ffffff', hc: '#ffffff' }],
		[ColorTokens.dropdownBackground, { light: '#ffffff', dark: '#3c3c3c' }],
		[ColorTokens.dropdownBorder, { light: '#cecece', dark: '#3c3c3c' }],
		[ColorTokens.listHoverBackground, { light: '#e8e8e8', dark: '#2a2d2e', hc: '#ffffff' }],
		[ColorTokens.listActiveSelectionBackground, { light: '#0060c0', dark: '#094771', hc: '#f38518' }],
		[ColorTokens.listActiveSelectionForeground, { light: '#ffffff', dark: '#ffffff', hc: '#000000' }],
		[ColorTokens.listFocusBackground, { light: '#0060c0', dark: '#062f4a' }],
		[ColorTokens.sideBarBackground, { light: '#f3f3f3', dark: '#252526', hc: '#000000' }],
		[ColorTokens.sideBarForeground, { light: '#616161', dark: '#cccccc', hc: '#ffffff' }],
		[ColorTokens.activityBarBackground, { light: '#2c2c2c', dark: '#333333', hc: '#000000' }],
		[ColorTokens.activityBarForeground, { light: '#ffffff', dark: '#ffffff', hc: '#ffffff' }],
		[ColorTokens.statusBarBackground, { light: '#007acc', dark: '#007acc', hc: '#000000' }],
		[ColorTokens.statusBarForeground, { light: '#ffffff', dark: '#ffffff', hc: '#ffffff' }],
		[ColorTokens.titleBarActiveBackground, { light: '#dddddd', dark: '#000000' }],
		[ColorTokens.titleBarActiveForeground, { light: '#333333', dark: '#cccccc' }],
		[ColorTokens.panelBackground, { light: '#ffffff', dark: '#000000' }],
		[ColorTokens.panelBorder, { light: '#e7e7e7', dark: '#4A148C' }],
		[ColorTokens.scrollbarSliderBackground, { light: '#64646466', dark: '#3B0A5E66' }],
		[ColorTokens.terminalBackground, { light: '#ffffff', dark: '#000000' }],
		[ColorTokens.terminalForeground, { light: '#333333', dark: '#cccccc' }],
		[ColorTokens.minimapBackground, { light: '#ffffff', dark: '#000000' }],
		[ColorTokens.breadcrumbsForeground, { light: '#616161', dark: '#cccccc' }],
		[ColorTokens.notificationCenterBackground, { light: '#ffffff', dark: '#252526' }],
		[ColorTokens.menuBackground, { light: '#ffffff', dark: '#252526' }],
		[ColorTokens.menuForeground, { light: '#333333', dark: '#cccccc' }],
		// Debug
		[ColorTokens.debugToolBarBackground, { light: '#f3f3f3', dark: '#333333' }],
		[ColorTokens.debugToolBarBorder, { light: '#eaeaea', dark: '#474747' }],
		[ColorTokens.debugIconStartForeground, { light: '#388a34', dark: '#89d185' }],
		[ColorTokens.debugIconPauseForeground, { light: '#007acc', dark: '#75beff' }],
		[ColorTokens.debugIconStopForeground, { light: '#a1260d', dark: '#f48771' }],
		[ColorTokens.debugIconStepOverForeground, { light: '#007acc', dark: '#75beff' }],
		[ColorTokens.debugIconStepIntoForeground, { light: '#007acc', dark: '#75beff' }],
		[ColorTokens.debugIconStepOutForeground, { light: '#007acc', dark: '#75beff' }],
		[ColorTokens.debugIconContinueForeground, { light: '#007acc', dark: '#75beff' }],
		[ColorTokens.debugIconStepBackForeground, { light: '#007acc', dark: '#75beff' }],
		[ColorTokens.debugConsoleInfoForeground, { light: '#1a1a1a', dark: '#cccccc' }],
		[ColorTokens.debugConsoleWarningForeground, { light: '#bf8803', dark: '#cca700' }],
		[ColorTokens.debugConsoleErrorForeground, { light: '#a1260d', dark: '#f48771' }],
		[ColorTokens.debugConsoleSourceForeground, { light: '#1a1a1a', dark: '#cccccc' }],
		[ColorTokens.debugConsoleInputIconForeground, { light: '#1a1a1a', dark: '#cccccc' }],
		
		// Git
		[ColorTokens.gitDecorationAddedResourceForeground, { light: '#587c0c', dark: '#81b88b' }],
		[ColorTokens.gitDecorationModifiedResourceForeground, { light: '#895503', dark: '#e2c08d' }],
		[ColorTokens.gitDecorationDeletedResourceForeground, { light: '#ad0707', dark: '#c74e39' }],
		[ColorTokens.gitDecorationUntrackedResourceForeground, { light: '#007100', dark: '#73c991' }],
		[ColorTokens.gitDecorationIgnoredResourceForeground, { light: '#8e8e90', dark: '#8c8c8c' }],
		[ColorTokens.gitDecorationConflictingResourceForeground, { light: '#ad0707', dark: '#e4676b' }],
		[ColorTokens.gitDecorationSubmoduleResourceForeground, { light: '#1258a7', dark: '#8db9e2' }],

		// Chat
		[ColorTokens.chatRequestBackground, { light: '#f2f2f2', dark: '#252526' }],
		[ColorTokens.chatRequestBorder, { light: '#e5e5e5', dark: '#303031' }],

		// Notebook
		[ColorTokens.notebookCellBorderColor, { light: '#e5e5e5', dark: '#37373d' }],
		[ColorTokens.notebookCellHoverBackground, { light: '#f2f2f2', dark: '#252526' }],
		[ColorTokens.notebookCellInsertionIndicator, { light: '#007acc', dark: '#007acc' }],
		[ColorTokens.notebookCellStatusBarItemHoverBackground, { light: '#e5e5e5', dark: '#37373d' }],
		[ColorTokens.notebookCellToolbarSeparator, { light: '#e5e5e5', dark: '#37373d' }],
		[ColorTokens.notebookEditorBackground, { light: '#f2f2f2', dark: '#1e1e1e' }],
		[ColorTokens.notebookFocusedCellBackground, { light: '#ffffff', dark: '#252526' }],
		[ColorTokens.notebookFocusedCellBorder, { light: '#007acc', dark: '#007acc' }],
		[ColorTokens.notebookFocusedEditorBorder, { light: '#007acc', dark: '#007acc' }],
		[ColorTokens.notebookInactiveFocusedCellBorder, { light: '#e5e5e5', dark: '#37373d' }],
		[ColorTokens.notebookInactiveSelectedCellBorder, { light: '#e5e5e5', dark: '#37373d' }],
		[ColorTokens.notebookOutputContainerBackgroundColor, { light: '#f2f2f2', dark: '#1e1e1e' }],
		[ColorTokens.notebookOutputContainerBorderColor, { light: '#e5e5e5', dark: '#37373d' }],
		[ColorTokens.notebookSelectedCellBackground, { light: '#f2f2f2', dark: '#252526' }],
		[ColorTokens.notebookSelectedCellBorder, { light: '#e5e5e5', dark: '#37373d' }],
		[ColorTokens.notebookSymbolHighlightBackground, { light: '#fdff0033', dark: '#ffffff0b' }],
		[ColorTokens.notebookScrollbarSliderActiveBackground, { light: '#00000033', dark: '#bfbfbf33' }],
		[ColorTokens.notebookScrollbarSliderBackground, { light: '#0000001a', dark: '#7979791a' }],
		[ColorTokens.notebookScrollbarSliderHoverBackground, { light: '#00000026', dark: '#64646426' }],
		[ColorTokens.notebookStatusErrorIcon, { light: '#a1260d', dark: '#f48771' }],
		[ColorTokens.notebookStatusRunningIcon, { light: '#007acc', dark: '#75beff' }],
		[ColorTokens.notebookStatusSuccessIcon, { light: '#388a34', dark: '#89d185' }],

		// Others
		[ColorTokens.widgetShadow, { light: '#00000029', dark: '#0000005c' }]
	];
	for (const [id, defaults] of colors) {
		registry.registerColor(id, defaults);
	}
}

registerDefaultColors();
