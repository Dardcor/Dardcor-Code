/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Commands ending with "Client" refer to the command ID used in the legacy Copilot extension.
// - These IDs should not appear in the package.json file
// - These IDs should be registered to support all functionality (except if this command needs to be supported when both extensions are loaded/active).
// Commands ending with "Chat" refer to the command ID used in the Copilot Chat extension.
// - These IDs should be used in package.json
// - These IDs should only be registered if they appear in the package.json (meaning the command palette) or if the command needs to be supported when both extensions are loaded/active.

export const CMDOpenPanelClient = 'github.dardcor.generate';
export const CMDOpenPanelChat = 'github.dardcor.chat.openSuggestionsPanel'; // "github.dardcor.chat.generate" is already being used

export const CMDAcceptCursorPanelSolutionClient = 'github.dardcor.acceptCursorPanelSolution';
export const CMDNavigatePreviousPanelSolutionClient = 'github.dardcor.previousPanelSolution';
export const CMDNavigateNextPanelSolutionClient = 'github.dardcor.nextPanelSolution';

export const CMDToggleStatusMenuClient = 'github.dardcor.toggleStatusMenu';
export const CMDToggleStatusMenuChat = 'github.dardcor.chat.toggleStatusMenu';

// Needs to be supported in both extensions when they are loaded/active. Requires a different ID.
export const CMDSendCompletionsFeedbackChat = 'github.dardcor.chat.sendCompletionFeedback';

export const CMDEnableCompletionsChat = 'github.dardcor.chat.completions.enable';
export const CMDDisableCompletionsChat = 'github.dardcor.chat.completions.disable';
export const CMDToggleCompletionsChat = 'github.dardcor.chat.completions.toggle';
export const CMDEnableCompletionsClient = 'github.dardcor.completions.enable';
export const CMDDisableCompletionsClient = 'github.dardcor.completions.disable';
export const CMDToggleCompletionsClient = 'github.dardcor.completions.toggle';

export const CMDOpenLogsClient = 'github.dardcor.openLogs';
export const CMDOpenDocumentationClient = 'github.dardcor.openDocs';

// Existing chat command reused for diagnostics
export const CMDCollectDiagnosticsChat = 'github.dardcor.debug.collectDiagnostics';

// Context variable that enable/disable panel-specific commands
export const CopilotPanelVisible = 'github.dardcor.panelVisible';
export const ComparisonPanelVisible = 'github.dardcor.comparisonPanelVisible';
export const HasMultipleCompletionModels = 'github.dardcor.completions.hasMultipleModels';

export const CMDOpenModelPickerClient = 'github.dardcor.openModelPicker';
export const CMDOpenModelPickerChat = 'github.dardcor.chat.openModelPicker';
