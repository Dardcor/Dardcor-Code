/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { CancellationToken } from '../../../base/common/cancellation.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { RemoteAgentHostsEnabledSettingId } from './remoteAgentHostService.js';
import { IReplayedTaskHistory } from './taskEventReplay.js';

export const CloudSandboxEnabledSettingId = 'chat.agentHost.cloudSandbox.enabled';

export function isCloudSandboxEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(CloudSandboxEnabledSettingId) === true
		&& configurationService.getValue<boolean>(RemoteAgentHostsEnabledSettingId) === true;
}

export const CLOUD_SANDBOX_ADDRESS_PREFIX = 'cloudsandbox:';

export const CLOUD_SANDBOX_SESSION_SCHEME = 'ahp-session';

export const CLOUD_SANDBOX_AGENT_PROVIDER = 'copilot';

export const CLOUD_SANDBOX_SEALED_TOKEN_PREFIX = 'copilot-sealed.v1.';

export function isCloudSandboxSealedToken(token: string | undefined): boolean {
	return typeof token === 'string' && token.startsWith(CLOUD_SANDBOX_SEALED_TOKEN_PREFIX);
}
export function cloudSandboxEnvironmentId(address: string): string | undefined {
	return address.startsWith(CLOUD_SANDBOX_ADDRESS_PREFIX)
		? address.slice(CLOUD_SANDBOX_ADDRESS_PREFIX.length)
		: undefined;
}

export const CLOUD_SANDBOX_AGENT_SLUG = 'copilot-developer-cli';

export const CLOUD_SANDBOX_ON_DEMAND_ENVIRONMENT_ID = 'github-sandbox';

export interface ICloudSandboxCreateSessionRequest {
	readonly repoNwo?: string;
	readonly prompt: string;
}

export interface ICloudSandboxCreatedSession {
	readonly taskId: string;
	readonly sessionId: string;
	readonly environmentId: string;
}

export interface ICloudSandboxDiscoveredSession {
	readonly environmentId: string;
	readonly sessionId: string;
	readonly taskId: string;
	readonly name: string;
	readonly repoName?: string;
	readonly updatedAt?: string;
}

export function cloudSandboxAddress(environmentId: string): string {
	return `${CLOUD_SANDBOX_ADDRESS_PREFIX}${environmentId}`;
}

export function buildWpsUrl(token: ICloudSandboxClientToken): string {
	const base = token.wps_endpoint.replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'wss://').replace(/^https:\/\//i, 'wss://');
	const withScheme = /^wss:\/\//i.test(base) ? base : `wss://${base}`;
	const separator = withScheme.includes('?') ? '&' : '?';
	return `${withScheme}${separator}access_token=${encodeURIComponent(token.access_token)}&clientId=${encodeURIComponent(token.client_id)}`;
}

export interface IWebPubSubClientGroups {
	readonly broadcast: string;
	readonly to_client: string;
	readonly to_host: string;
}

export interface IHostEncryptionKey {
	readonly key_id: string;
	readonly use: string;
	readonly algorithm: string;
	readonly public_key: string;
}

export interface ICloudSandboxClientToken {
	readonly access_token: string;
	readonly expires_at: string;
	readonly wps_endpoint: string;
	readonly hub: string;
	readonly subprotocol: string;
	readonly client_id: string;
	readonly groups: IWebPubSubClientGroups;
	readonly encrypted_github_token?: string;
	readonly host_encryption_key?: IHostEncryptionKey;
}

export interface ICloudSandboxWaking {
	readonly retryAfterSeconds: number;
}

export type CloudSandboxConnectResult =
	| { readonly kind: 'token'; readonly token: ICloudSandboxClientToken }
	| { readonly kind: 'waking'; readonly waking: ICloudSandboxWaking };

export type CloudSandboxEnvironmentStatus = 'online' | 'offline' | 'degraded' | 'waking' | 'draining';

export interface ICloudSandboxEnvironment {
	readonly id: string;
	readonly status: CloudSandboxEnvironmentStatus;
	readonly capabilities?: {
		readonly ahp_version?: string;
	};
}

export interface ICloudSandboxConnectionRequest {
	readonly environmentId: string;
	readonly sessionId?: string;
}

export const ICloudSandboxApiService = createDecorator<ICloudSandboxApiService>('cloudSandboxApiService');

export interface ICloudSandboxApiService {
	readonly _serviceBrand: undefined;

	connect(request: ICloudSandboxConnectionRequest, token: CancellationToken): Promise<CloudSandboxConnectResult>;

	reconnect(request: ICloudSandboxConnectionRequest, clientId: string, token: CancellationToken): Promise<CloudSandboxConnectResult>;

	getEnvironment(environmentId: string, token: CancellationToken): Promise<ICloudSandboxEnvironment>;

	listSessions(token: CancellationToken): Promise<ICloudSandboxDiscoveryResult>;

	createSession(request: ICloudSandboxCreateSessionRequest, token: CancellationToken): Promise<ICloudSandboxCreatedSession>;

	getSessionHistory(taskId: string, token: CancellationToken): Promise<IReplayedTaskHistory | undefined>;
}

export type ICloudSandboxDiscoveryResult =
	| { readonly kind: 'complete'; readonly sessions: readonly ICloudSandboxDiscoveredSession[] }
	| { readonly kind: 'partial'; readonly sessions: readonly ICloudSandboxDiscoveredSession[] }
	| { readonly kind: 'failed'; readonly reason: string };

export class CloudSandboxAuthenticationRequiredError extends Error {
	constructor() {
		super('Connecting to a cloud sandbox requires a signed-in GitHub account.');
		this.name = 'CloudSandboxAuthenticationRequiredError';
	}
}

export class CloudSandboxRequestError extends Error {
	constructor(readonly statusCode: number | undefined, message: string) {
		super(message);
		this.name = 'CloudSandboxRequestError';
	}
}

export function isRetryableCloudSandboxError(error: unknown): boolean {
	if (!(error instanceof CloudSandboxRequestError) || error.statusCode === undefined) {
		return true;
	}
	const status = error.statusCode;
	return status === 408 || status === 429 || status < 400 || status >= 500;
}

export const ICloudSandboxAgentHostService = createDecorator<ICloudSandboxAgentHostService>('cloudSandboxAgentHostService');

export interface ICloudSandboxConnectOptions {
	readonly environmentId: string;
	readonly sessionId?: string;
	readonly name: string;
}

export interface ICloudSandboxAgentHostService {
	readonly _serviceBrand: undefined;

	connect(options: ICloudSandboxConnectOptions, token: CancellationToken): Promise<string>;

	getSealedGitHubToken(environmentId: string): string | undefined;
}
