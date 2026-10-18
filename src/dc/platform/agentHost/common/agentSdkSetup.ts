/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RootState } from './state/protocol/state.js';

const AGENT_SDK_SETUP_STATUS_KEY_PREFIX = 'vscode.agentSdkSetup.status.';

export const AGENT_SDK_SETUP_DOWNLOAD_REQUEST_KEY = 'vscode.agentSdkSetup.downloadRequest';

/**
 * Ask an agent to look again at a setup the user completed outside the app
 * (`claude login`, an exported key) — the only completion signal there is.
 */
export const AGENT_SDK_SETUP_RELOAD_REQUEST_KEY = 'vscode.agentSdkSetup.reloadRequest';

export function agentSdkSetupStatusKey(agent: string): string {
	return `${AGENT_SDK_SETUP_STATUS_KEY_PREFIX}${agent}`;
}

export type AgentSdkDownloadStatus = 'notDownloaded' | 'downloadOnUse' | 'downloading' | 'ready';

export interface IAgentSdkSetupInfo {
	readonly agent: string;
	readonly download: AgentSdkDownloadStatus;
	/**
	 * Where the user goes to finish setup, for the agents whose setup happens
	 * outside the app (`claude login`, an exported API key).
	 */
	readonly setupDocsUrl?: string;
	readonly signInProviderName?: string;
}

export interface IAgentSdkSetupRequest {
	readonly agent: string;
	readonly request: string;
}

export function isAgentSdkSetupRequestFor(value: unknown, agent: string): value is IAgentSdkSetupRequest {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const request: Partial<IAgentSdkSetupRequest> = value;
	return request.agent === agent && typeof request.request === 'string' && request.request.length > 0;
}

function readOne(value: unknown, agent: string): IAgentSdkSetupInfo | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const info: Partial<IAgentSdkSetupInfo> = value;
	if (info.download !== 'notDownloaded' && info.download !== 'downloadOnUse' && info.download !== 'downloading' && info.download !== 'ready') {
		return undefined;
	}
	return {
		agent,
		download: info.download,
		setupDocsUrl: typeof info.setupDocsUrl === 'string' ? info.setupDocsUrl : undefined,
		signInProviderName: typeof info.signInProviderName === 'string' && info.signInProviderName.length > 0 ? info.signInProviderName : undefined,
	};
}

export function readAgentSdkSetupInfos(state: RootState | undefined): readonly IAgentSdkSetupInfo[] {
	const meta = state?._meta;
	const values = state?.config?.values;
	const infos: IAgentSdkSetupInfo[] = [];
	const seen = new Set<string>();
	for (const bag of [values, meta]) {
		for (const key of Object.keys(bag ?? {})) {
			if (!key.startsWith(AGENT_SDK_SETUP_STATUS_KEY_PREFIX)) {
				continue;
			}
			const agent = key.slice(AGENT_SDK_SETUP_STATUS_KEY_PREFIX.length);
			if (!agent || seen.has(agent)) {
				continue;
			}
			const info = readOne(bag?.[key], agent);
			if (info) {
				seen.add(agent);
				infos.push(info);
			}
		}
	}
	return infos;
}
