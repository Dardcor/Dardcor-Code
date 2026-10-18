/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { startRealServer, type IServerHandle } from '../../serverIntegrationTestHelpers.js';
import type { CapiReplayMode, CapiReplayProxy, ICapiReplayResponse } from './capiReplayProxy.js';

export interface IAgentHostTargetLaunchOptions {
	readonly homeDir: string;
	readonly userDataDir: string;
	readonly codexHomeDir: string;
	readonly capiReplay: { readonly fixturePath: string; readonly mode?: CapiReplayMode; readonly real?: boolean; readonly recordingModelResponse?: ICapiReplayResponse };
	readonly existingCapiReplay?: CapiReplayProxy;
	readonly claudeSdkRoot?: string;
	readonly codexSdkRoot?: string;
	readonly logLevel?: string;
	readonly env?: Readonly<Record<string, string>>;
}

export interface IAgentHostTarget {
	readonly id: string;
	launch(options: IAgentHostTargetLaunchOptions): Promise<IServerHandle>;
}

export const vscodeAgentHostTarget: IAgentHostTarget = {
	id: 'vscode-agent-host',
	launch(options) {
		return startRealServer({
			homeDir: options.homeDir,
			userDataDir: options.userDataDir,
			codexHomeDir: options.codexHomeDir,
			capiReplay: options.capiReplay,
			existingCapiReplay: options.existingCapiReplay,
			claudeSdkRoot: options.claudeSdkRoot,
			codexSdkRoot: options.codexSdkRoot,
			logLevel: options.logLevel,
			env: options.env,
		});
	},
};

export const defaultAgentHostTarget: IAgentHostTarget = vscodeAgentHostTarget;
