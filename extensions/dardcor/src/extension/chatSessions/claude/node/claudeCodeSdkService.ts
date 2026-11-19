/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ForkSessionOptions, ForkSessionResult, GetSubagentMessagesOptions, ListSubagentsOptions, Options, Query, SDKSessionInfo, SDKUserMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { createServiceIdentifier } from '../../../../util/common/services';
import { IClaudeAgentSdkLoaderService } from '../common/claudeAgentSdkLoaderService';

export interface IClaudeCodeSdkService {
	readonly _serviceBrand: undefined;

	query(options: {
		prompt: AsyncIterable<SDKUserMessage>;
		options: Options;
	}): Promise<Query>;

	listSessions(dir?: string): Promise<SDKSessionInfo[]>;

	getSessionInfo(sessionId: string, dir?: string): Promise<SDKSessionInfo | undefined>;

	getSessionMessages(sessionId: string, dir?: string): Promise<SessionMessage[]>;

	renameSession(sessionId: string, title: string): Promise<void>;

	forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult>;

	listSubagents(sessionId: string, options?: ListSubagentsOptions): Promise<string[]>;

	getSubagentMessages(sessionId: string, agentId: string, options?: GetSubagentMessagesOptions): Promise<SessionMessage[]>;
}


export const IClaudeCodeSdkService = createServiceIdentifier<IClaudeCodeSdkService>('IClaudeCodeSdkService');

export class ClaudeCodeSdkService implements IClaudeCodeSdkService {
	readonly _serviceBrand: undefined;

	constructor(
		@IClaudeAgentSdkLoaderService private readonly _sdkLoader: IClaudeAgentSdkLoaderService,
	) { }

	private _loadSdk() {
		return this._sdkLoader.load();
	}

	public async query(options: {
		prompt: AsyncIterable<SDKUserMessage>;
		options: Options;
	}): Promise<Query> {
		const { query } = await this._loadSdk();
		return query(options);
	}

	public async listSessions(dir?: string): Promise<SDKSessionInfo[]> {
		const { listSessions } = await this._loadSdk();
		return listSessions(dir !== undefined ? { dir } : undefined);
	}

	public async getSessionInfo(sessionId: string, dir?: string): Promise<SDKSessionInfo | undefined> {
		const { getSessionInfo } = await this._loadSdk();
		return getSessionInfo(sessionId, dir !== undefined ? { dir } : undefined);
	}

	public async getSessionMessages(sessionId: string, dir?: string): Promise<SessionMessage[]> {
		const { getSessionMessages } = await this._loadSdk();
		return getSessionMessages(sessionId, dir !== undefined ? { dir } : undefined);
	}

	public async renameSession(sessionId: string, title: string): Promise<void> {
		const { renameSession } = await this._loadSdk();
		await renameSession(sessionId, title);
	}

	public async forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult> {
		const { forkSession } = await this._loadSdk();
		return forkSession(sessionId, options);
	}

	public async listSubagents(sessionId: string, options?: ListSubagentsOptions): Promise<string[]> {
		const { listSubagents } = await this._loadSdk();
		return listSubagents(sessionId, options);
	}

	public async getSubagentMessages(sessionId: string, agentId: string, options?: GetSubagentMessagesOptions): Promise<SessionMessage[]> {
		const { getSubagentMessages } = await this._loadSdk();
		return getSubagentMessages(sessionId, agentId, options);
	}
}
