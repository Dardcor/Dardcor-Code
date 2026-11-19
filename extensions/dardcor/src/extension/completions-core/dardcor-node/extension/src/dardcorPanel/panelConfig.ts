/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from '../constants';
import { DardcorPanelVisible } from '../constants';
import { PanelConfig } from '../panelShared/basePanelTypes';

export const dardcorPanelConfig: PanelConfig = {
	panelTitle: 'Dardcor Suggestions',
	webviewId: 'Dardcor Suggestions',
	webviewScriptName: 'suggestionsPanelWebview.js',
	contextVariable: DardcorPanelVisible,
	commands: {
		accept: constants.CMDAcceptCursorPanelSolutionClient,
		navigatePrevious: constants.CMDNavigatePreviousPanelSolutionClient,
		navigateNext: constants.CMDNavigateNextPanelSolutionClient,
	},
	renderingMode: 'streaming',
	shuffleSolutions: false,
};
