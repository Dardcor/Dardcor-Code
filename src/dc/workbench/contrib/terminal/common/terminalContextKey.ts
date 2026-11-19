/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { TerminalSettingId } from '../../../../platform/terminal/common/terminal.js';
import { TERMINAL_VIEW_ID } from './terminal.js';
import { TerminalContribContextKeyStrings } from '../terminalContribExports.js';

export const enum TerminalContextKeyStrings {
	IsOpen = 'terminalIsOpen',
	Count = 'terminalCount',
	GroupCount = 'terminalGroupCount',
	TabsNarrow = 'isTerminalTabsNarrow',
	HasFixedWidth = 'terminalHasFixedWidth',
	ProcessSupported = 'terminalProcessSupported',
	Focus = 'terminalFocus',
	FocusInAny = 'terminalFocusInAny',
	AccessibleBufferFocus = 'terminalAccessibleBufferFocus',
	AccessibleBufferOnLastLine = 'terminalAccessibleBufferOnLastLine',
	EditorFocus = 'terminalEditorFocus',
	TabsFocus = 'terminalTabsFocus',
	WebExtensionContributedProfile = 'terminalWebExtensionContributedProfile',
	TerminalHasBeenCreated = 'terminalHasBeenCreated',
	TerminalEditorActive = 'terminalEditorActive',
	TabsMouse = 'terminalTabsMouse',
	AltBufferActive = 'terminalAltBufferActive',
	SuggestWidgetVisible = 'terminalSuggestWidgetVisible',
	A11yTreeFocus = 'terminalA11yTreeFocus',
	ViewShowing = 'terminalViewShowing',
	TextSelected = 'terminalTextSelected',
	TextSelectedInFocused = 'terminalTextSelectedInFocused',
	FindVisible = 'terminalFindVisible',
	FindInputFocused = 'terminalFindInputFocused',
	FindFocused = 'terminalFindFocused',
	TabsSingularSelection = 'terminalTabsSingularSelection',
	SplitTerminal = 'terminalSplitTerminal',
	SplitPaneActive = 'terminalSplitPaneActive',
	ShellType = 'terminalShellType',
	InTerminalRunCommandPicker = 'inTerminalRunCommandPicker',
	TerminalShellIntegrationEnabled = 'terminalShellIntegrationEnabled',
	DictationInProgress = 'terminalDictationInProgress'
}

export namespace TerminalContextKeys {
	export const isOpen = new RawContextKey<boolean>(TerminalContextKeyStrings.IsOpen, false, true);

	export const focus = new RawContextKey<boolean>(TerminalContextKeyStrings.Focus, false, localize('terminalFocusContextKey', "Whether the terminal is focused."));

	export const focusInAny = new RawContextKey<boolean>(TerminalContextKeyStrings.FocusInAny, false, localize('terminalFocusInAnyContextKey', "Whether any terminal is focused, including detached terminals used in other UI."));

	export const editorFocus = new RawContextKey<boolean>(TerminalContextKeyStrings.EditorFocus, false, localize('terminalEditorFocusContextKey', "Whether a terminal in the editor area is focused."));

	export const count = new RawContextKey<number>(TerminalContextKeyStrings.Count, 0, localize('terminalCountContextKey', "The current number of terminals."));

	export const groupCount = new RawContextKey<number>(TerminalContextKeyStrings.GroupCount, 0, true);

	export const tabsNarrow = new RawContextKey<boolean>(TerminalContextKeyStrings.TabsNarrow, false, true);

	export const terminalHasFixedWidth = new RawContextKey<boolean>(TerminalContextKeyStrings.HasFixedWidth, false, true);

	export const tabsFocus = new RawContextKey<boolean>(TerminalContextKeyStrings.TabsFocus, false, localize('terminalTabsFocusContextKey', "Whether the terminal tabs widget is focused."));

	export const webExtensionContributedProfile = new RawContextKey<boolean>(TerminalContextKeyStrings.WebExtensionContributedProfile, false, true);

	export const terminalHasBeenCreated = new RawContextKey<boolean>(TerminalContextKeyStrings.TerminalHasBeenCreated, false, true);

	export const terminalEditorActive = new RawContextKey<boolean>(TerminalContextKeyStrings.TerminalEditorActive, false, true);

	export const tabsMouse = new RawContextKey<boolean>(TerminalContextKeyStrings.TabsMouse, false, true);

	export const shellType = new RawContextKey<string>(TerminalContextKeyStrings.ShellType, undefined, { type: 'string', description: localize('terminalShellTypeContextKey', "The shell type of the active terminal, this is set if the type can be detected.") });

	export const altBufferActive = new RawContextKey<boolean>(TerminalContextKeyStrings.AltBufferActive, false, localize('terminalAltBufferActive', "Whether the terminal's alt buffer is active."));

	export const suggestWidgetVisible = new RawContextKey<boolean>(TerminalContextKeyStrings.SuggestWidgetVisible, false, localize('terminalSuggestWidgetVisible', "Whether the terminal's suggest widget is visible."));

	export const notFocus = focus.toNegated();

	export const viewShowing = new RawContextKey<boolean>(TerminalContextKeyStrings.ViewShowing, false, localize('terminalViewShowing', "Whether the terminal view is showing"));

	export const textSelected = new RawContextKey<boolean>(TerminalContextKeyStrings.TextSelected, false, localize('terminalTextSelectedContextKey', "Whether text is selected in the active terminal."));

	export const textSelectedInFocused = new RawContextKey<boolean>(TerminalContextKeyStrings.TextSelectedInFocused, false, localize('terminalTextSelectedInFocusedContextKey', "Whether text is selected in a focused terminal."));

	export const notTextSelected = textSelected.toNegated();

	export const findVisible = new RawContextKey<boolean>(TerminalContextKeyStrings.FindVisible, false, true);

	export const notFindVisible = findVisible.toNegated();

	export const findInputFocus = new RawContextKey<boolean>(TerminalContextKeyStrings.FindInputFocused, false, true);

	export const findFocus = new RawContextKey<boolean>(TerminalContextKeyStrings.FindFocused, false, true);

	export const notFindFocus = findInputFocus.toNegated();

	export const processSupported = new RawContextKey<boolean>(TerminalContextKeyStrings.ProcessSupported, false, localize('terminalProcessSupportedContextKey', "Whether terminal processes can be launched in the current workspace."));

	export const tabsSingularSelection = new RawContextKey<boolean>(TerminalContextKeyStrings.TabsSingularSelection, false, localize('terminalTabsSingularSelectedContextKey', "Whether one terminal is selected in the terminal tabs list."));

	export const splitTerminalTabFocused = new RawContextKey<boolean>(TerminalContextKeyStrings.SplitTerminal, false, localize('isSplitTerminalContextKey', "Whether the focused tab's terminal is a split terminal."));

	export const splitTerminalActive = new RawContextKey<boolean>(TerminalContextKeyStrings.SplitPaneActive, false, localize('splitPaneActive', "Whether the active terminal is a split pane."));

	export const inTerminalRunCommandPicker = new RawContextKey<boolean>(TerminalContextKeyStrings.InTerminalRunCommandPicker, false, localize('inTerminalRunCommandPickerContextKey', "Whether the terminal run command picker is currently open."));

	export const terminalShellIntegrationEnabled = new RawContextKey<boolean>(TerminalContextKeyStrings.TerminalShellIntegrationEnabled, false, localize('terminalShellIntegrationEnabled', "Whether shell integration is enabled in the active terminal"));

	export const terminalDictationInProgress = new RawContextKey<boolean>(TerminalContextKeyStrings.DictationInProgress, false);

	export const shouldShowViewInlineActions = ContextKeyExpr.and(
		ContextKeyExpr.equals('view', TERMINAL_VIEW_ID),
		ContextKeyExpr.notEquals(`config.${TerminalSettingId.TabsHideCondition}`, 'never'),
		ContextKeyExpr.not(TerminalContribContextKeyStrings.ChatHasHiddenTerminals),
		ContextKeyExpr.or(
			ContextKeyExpr.not(`config.${TerminalSettingId.TabsEnabled}`),
			ContextKeyExpr.and(
				ContextKeyExpr.equals(`config.${TerminalSettingId.TabsShowActions}`, 'singleTerminal'),
				ContextKeyExpr.equals(TerminalContextKeyStrings.GroupCount, 1)
			),
			ContextKeyExpr.and(
				ContextKeyExpr.equals(`config.${TerminalSettingId.TabsShowActions}`, 'singleTerminalOrNarrow'),
				ContextKeyExpr.or(
					ContextKeyExpr.equals(TerminalContextKeyStrings.GroupCount, 1),
					ContextKeyExpr.has(TerminalContextKeyStrings.TabsNarrow)
				)
			),
			ContextKeyExpr.and(
				ContextKeyExpr.equals(`config.${TerminalSettingId.TabsShowActions}`, 'singleGroup'),
				ContextKeyExpr.equals(TerminalContextKeyStrings.GroupCount, 1)
			),
			ContextKeyExpr.equals(`config.${TerminalSettingId.TabsShowActions}`, 'always')
		)
	);
}
