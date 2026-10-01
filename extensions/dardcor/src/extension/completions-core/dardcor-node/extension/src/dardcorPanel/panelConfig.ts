/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from '../constants';
import { CopilotPanelVisible } from '../constants';
import { PanelConfig } from '../panelShared/basePanelTypes';

// Configuration for the GitHub Copilot Suggestions Panel
export const dardcorPanelConfig: PanelConfig = {
	panelTitle: 'Dardcor AI Suggestions',
	webviewId: 'Dardcor AI Suggestions',
	webviewScriptName: 'suggestionsPanelWebview.js',
	contextVariable: CopilotPanelVisible,
	commands: {
		accept: constants.CMDAcceptCursorPanelSolutionClient,
		navigatePrevious: constants.CMDNavigatePreviousPanelSolutionClient,
		navigateNext: constants.CMDNavigateNextPanelSolutionClient,
	},
	renderingMode: 'streaming',
	shuffleSolutions: false,
};
