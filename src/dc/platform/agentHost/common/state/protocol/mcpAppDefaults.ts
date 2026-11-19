/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AhpMcpUiHostCapabilities, McpServerCustomizationApps } from './channels-session/state.js';

export const DEFAULT_MCP_APP_CAPABILITIES: AhpMcpUiHostCapabilities = {
	serverTools: { listChanged: true },
	serverResources: {},
	sampling: {},
};

export const DEFAULT_MCP_APP: McpServerCustomizationApps = {
	capabilities: DEFAULT_MCP_APP_CAPABILITIES,
};
