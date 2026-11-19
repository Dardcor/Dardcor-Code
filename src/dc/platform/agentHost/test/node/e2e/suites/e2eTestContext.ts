/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TestProtocolClient } from '../../serverIntegrationTestHelpers.js';
import type { IAgentHostE2EProviderConfig } from '../harness/agentHostE2ETestHarness.js';
import type { ICapiReplayResponse } from '../harness/capiReplayProxy.js';

export type AgentHostE2ETier = 'conformance' | 'parity';

export interface IAgentHostE2ETestContext {
	readonly tier: AgentHostE2ETier;
	readonly targetId: string;
	readonly config: IAgentHostE2EProviderConfig;
	readonly client: TestProtocolClient;
	readonly createdSessions: string[];
	readonly tempDirs: string[];
	readonly portableShellToolReplayEnabled: boolean;
	readonly isLinux: boolean;
	readonly isWindows: boolean;
	readonly runRecordOnlyTests: boolean;
	readonly runKnownIssueTests: boolean;
	readonly runHostOnlyKnownIssueTests: boolean;
	readonly registerNoModelTrafficTest: (title: string) => void;
	readonly observedModelRequestBodies: readonly string[];
	readonly setRecordingModelResponse: (response: ICapiReplayResponse, path?: string) => void;
	readonly restartServer: () => Promise<void>;
	readonly connectClient: () => Promise<TestProtocolClient>;
}

function registerHostOnlyTest(context: IAgentHostE2ETestContext, title: string, run: Mocha.AsyncFunc, enabled: boolean): void {
	context.registerNoModelTrafficTest(title);
	(enabled ? test : test.skip)(title, function () {
		this.timeout(120_000);
		return run.call(this);
	});
}

export function conformanceTest(context: IAgentHostE2ETestContext, title: string, run: Mocha.AsyncFunc, enabled = true): void {
	if (context.tier !== 'conformance') {
		return;
	}
	registerHostOnlyTest(context, title, run, enabled);
}

export function providerHostOnlyTest(context: IAgentHostE2ETestContext, title: string, run: Mocha.AsyncFunc, enabled = true): void {
	if (context.tier !== 'parity') {
		return;
	}
	registerHostOnlyTest(context, title, run, enabled);
}
