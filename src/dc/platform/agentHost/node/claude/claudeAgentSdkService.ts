/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AnyZodRawShape, ForkSessionOptions, ForkSessionResult, GetSessionMessagesOptions, GetSubagentMessagesOptions, InferShape, ListSessionsOptions, ListSubagentsOptions, McpSdkServerConfigWithInstance, Options, Query, SDKSessionInfo, SDKUserMessage, SdkMcpToolDefinition, SessionMessage, SessionMutationOptions, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'url';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { join } from '../../../../base/common/path.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { IAgentSdkDownloader, IAgentSdkPackage } from '../agentSdkDownloader.js';
import { AgentHostClaudeSdkRootEnvVar } from '../../common/agentService.js';

export const ClaudeSdkPackage: IAgentSdkPackage = {
	id: 'claude',
	displayName: 'Claude',
	devOverrideEnvVar: AgentHostClaudeSdkRootEnvVar,
	hasSeparateMuslLinuxPackage: true,
};

const ClaudeDisablePrecompactSkipEnvVar = 'CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP';

export const IClaudeAgentSdkService = createDecorator<IClaudeAgentSdkService>('claudeAgentSdkService');

export interface IClaudeAgentSdkService {
	readonly _serviceBrand: undefined;

	listSessions(): Promise<readonly SDKSessionInfo[]>;
	getSessionInfo(sessionId: string): Promise<SDKSessionInfo | undefined>;
	startup(params: { options: Options; initializeTimeoutMs?: number }): Promise<WarmQuery>;
	query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Promise<Query>;
	getSessionMessages(sessionId: string, options?: GetSessionMessagesOptions): Promise<readonly SessionMessage[]>;
	listSubagents(sessionId: string, options?: ListSubagentsOptions): Promise<readonly string[]>;
	getSubagentMessages(sessionId: string, agentId: string, options?: GetSubagentMessagesOptions): Promise<readonly SessionMessage[]>;

	canLoadWithoutDownload(): Promise<boolean>;
	ensureAvailable(): Promise<void>;

	forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult>;
	deleteSession(sessionId: string, options?: SessionMutationOptions): Promise<void>;
	createSdkMcpServer(options: {
		name: string;
		version?: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		tools?: Array<SdkMcpToolDefinition<any>>;
	}): Promise<McpSdkServerConfigWithInstance>;

	tool<Schema extends AnyZodRawShape>(
		name: string,
		description: string,
		inputSchema: Schema,
		handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>
	): Promise<SdkMcpToolDefinition<Schema>>;
}

export interface IClaudeSdkBindings {
	listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
	getSessionInfo(sessionId: string): Promise<SDKSessionInfo | undefined>;
	startup(params: { options: Options; initializeTimeoutMs?: number }): Promise<WarmQuery>;
	query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query;
	getSessionMessages(sessionId: string, options?: GetSessionMessagesOptions): Promise<SessionMessage[]>;
	listSubagents(sessionId: string, options?: ListSubagentsOptions): Promise<string[]>;
	getSubagentMessages(sessionId: string, agentId: string, options?: GetSubagentMessagesOptions): Promise<SessionMessage[]>;
	forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult>;
	deleteSession(sessionId: string, options?: SessionMutationOptions): Promise<void>;
	createSdkMcpServer(options: {
		name: string;
		version?: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		tools?: Array<SdkMcpToolDefinition<any>>;
	}): McpSdkServerConfigWithInstance;
	tool<Schema extends AnyZodRawShape>(
		name: string,
		description: string,
		inputSchema: Schema,
		handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>
	): SdkMcpToolDefinition<Schema>;
}

export class ClaudeAgentSdkService implements IClaudeAgentSdkService {
	declare readonly _serviceBrand: undefined;

	private _sdkModule: IClaudeSdkBindings | undefined;

	private _firstLoadFailureLogged = false;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IAgentSdkDownloader private readonly _downloader: IAgentSdkDownloader,
	) {
		if (process.env[ClaudeDisablePrecompactSkipEnvVar] === undefined) {
			process.env[ClaudeDisablePrecompactSkipEnvVar] = '1';
		}
	}

	async listSessions(): Promise<readonly SDKSessionInfo[]> {
		const sdk = await this._getSdk();
		return sdk.listSessions(undefined);
	}

	async canLoadWithoutDownload(): Promise<boolean> {
		if (process.env[AgentHostClaudeSdkRootEnvVar] || !this._downloader.isAvailable(ClaudeSdkPackage)) {
			return true;
		}
		return this._downloader.isSdkResolvableWithoutDownload(ClaudeSdkPackage);
	}

	async ensureAvailable(): Promise<void> {
		if (!(await this.canLoadWithoutDownload())) {
			await this._downloader.loadSdkRoot(ClaudeSdkPackage, CancellationToken.None);
		}
	}

	async getSessionInfo(sessionId: string): Promise<SDKSessionInfo | undefined> {
		const sdk = await this._getSdk();
		return sdk.getSessionInfo(sessionId);
	}

	async startup(params: { options: Options; initializeTimeoutMs?: number }): Promise<WarmQuery> {
		const sdk = await this._getSdk();
		return sdk.startup(params);
	}

	async query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Promise<Query> {
		const sdk = await this._getSdk();
		return sdk.query(params);
	}

	async getSessionMessages(sessionId: string, options?: GetSessionMessagesOptions): Promise<readonly SessionMessage[]> {
		const sdk = await this._getSdk();
		return sdk.getSessionMessages(sessionId, options);
	}

	async listSubagents(sessionId: string, options?: ListSubagentsOptions): Promise<readonly string[]> {
		const sdk = await this._getSdk();
		return sdk.listSubagents(sessionId, options);
	}

	async getSubagentMessages(sessionId: string, agentId: string, options?: GetSubagentMessagesOptions): Promise<readonly SessionMessage[]> {
		const sdk = await this._getSdk();
		return sdk.getSubagentMessages(sessionId, agentId, options);
	}

	async forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult> {
		const sdk = await this._getSdk();
		return sdk.forkSession(sessionId, options);
	}

	async deleteSession(sessionId: string, options?: SessionMutationOptions): Promise<void> {
		const sdk = await this._getSdk();
		return sdk.deleteSession(sessionId, options);
	}

	async createSdkMcpServer(options: {
		name: string;
		version?: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		tools?: Array<SdkMcpToolDefinition<any>>;
	}): Promise<McpSdkServerConfigWithInstance> {
		const sdk = await this._getSdk();
		return sdk.createSdkMcpServer(options);
	}

	async tool<Schema extends AnyZodRawShape>(
		name: string,
		description: string,
		inputSchema: Schema,
		handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>
	): Promise<SdkMcpToolDefinition<Schema>> {
		const sdk = await this._getSdk();
		return sdk.tool(name, description, inputSchema, handler);
	}

	private async _getSdk(): Promise<IClaudeSdkBindings> {
		if (this._sdkModule) {
			return this._sdkModule;
		}
		try {
			this._sdkModule = await this._loadSdk();
			return this._sdkModule;
		} catch (err) {
			if (!this._firstLoadFailureLogged) {
				this._firstLoadFailureLogged = true;
				this._logService.error('[Claude] Failed to load @anthropic-ai/claude-agent-sdk', err);
			}
			throw err;
		}
	}

	protected async _loadSdk(): Promise<IClaudeSdkBindings> {
		const override = process.env[AgentHostClaudeSdkRootEnvVar];
		if (override) {
			const entry = join(override, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs');
			return import(pathToFileURL(entry).href);
		}

		if (this._downloader.isAvailable(ClaudeSdkPackage)) {
			const root = await this._downloader.loadSdkRoot(ClaudeSdkPackage, CancellationToken.None);
			const entry = join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs');
			return import(pathToFileURL(entry).href);
		}

		return import('@anthropic-ai/claude-agent-sdk');
	}
}


type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

type AssertBindingsMatchSdk = {
	[K in keyof IClaudeSdkBindings]: K extends keyof SdkModule
	? SdkModule[K] extends IClaudeSdkBindings[K]
	? true
	: ['SDK export signature drifted from IClaudeSdkBindings', K, SdkModule[K], IClaudeSdkBindings[K]]
	: ['Not an export of @anthropic-ai/claude-agent-sdk', K];
};

const _assertBindingsMatchSdk: { [K in keyof IClaudeSdkBindings]: true } = null as unknown as AssertBindingsMatchSdk;
void _assertBindingsMatchSdk;

