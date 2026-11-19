/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { defineAgentHostConformanceTests } from '../suites/agentHostE2ESuites.js';
import type { IAgentHostE2EProviderConfig } from '../harness/agentHostE2ETestHarness.js';

const REFERENCE_CONFIG: IAgentHostE2EProviderConfig = {
	suiteTitle: 'Agent Host E2E — Conformance',
	provider: 'copilotcli',
	scheme: 'copilotcli',
	shellToolName: 'bash',
	fileOperationStrategy: 'fileTools',
	subagentToolNames: ['task'],
	exitPlanModeToolName: 'exit_plan_mode',
	enabled: true,
	supportsWorktreeIsolation: true,
	supportsHostTerminalTool: true,
	supportsSubagents: true,
	planModeStyle: 'session-state',
	supportsMultipleChats: true,
	supportsChatFork: true,
	supportsChatForkE2E: true,
};

defineAgentHostConformanceTests(REFERENCE_CONFIG);
