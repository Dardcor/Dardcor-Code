/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { AgentHostEndpointAddress, AgentHostServerType } from './agentHostEndpointRegistry.js';
import type { RemoteAgentHostLocationPreference } from './remoteAgentHostLocationPreference.js';
import type { IRelayMessage } from './relayTransport.js';

export type { IRelayMessage } from './relayTransport.js';

export type SSHAgentHostLifecycle = 'managed' | 'external';

export const ISSHRemoteAgentHostService = createDecorator<ISSHRemoteAgentHostService>('sshRemoteAgentHostService');

export const SSH_REMOTE_AGENT_HOST_CHANNEL = 'sshRemoteAgentHost';

export const enum SSHAuthMethod {
	Agent = 'agent',
	KeyFile = 'keyFile',
	Password = 'password',
}

export interface ISSHAgentHostConfig {
	readonly host: string;
	readonly port?: number;
	readonly username: string;
	readonly authMethod: SSHAuthMethod;
	readonly privateKeyPath?: string;
	readonly identityAgent?: string;
	readonly password?: string;
	readonly name: string;
	readonly sshConfigHost?: string;
	readonly remoteAgentHostCommand?: string;
	readonly agentForward?: boolean;
	readonly userInitiated?: boolean;
	readonly preferredAgentLocation?: RemoteAgentHostLocationPreference;
}

export function computeSSHConnectionKey(config: { sshConfigHost?: string; username?: string; host?: string; port?: number }): string {
	return config.sshConfigHost
		? `ssh:${config.sshConfigHost}`
		: `${config.username}@${config.host}:${config.port ?? 22}`;
}

export type ISSHAgentHostConfigSanitized = Omit<ISSHAgentHostConfig, 'password' | 'privateKeyPath'>;

export interface ISSHAgentHostConnection extends IDisposable {
	readonly config: ISSHAgentHostConfigSanitized;
	readonly localAddress: string;
	readonly name: string;
	readonly onDidClose: Event<void>;
	readonly serverType?: AgentHostServerType;
	readonly instanceId?: string;
	readonly primary?: boolean;
	readonly lifecycle?: SSHAgentHostLifecycle;
}

export interface ISSHRemoteAgentHostService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConnections: Event<void>;

	readonly onDidReportConnectProgress: Event<ISSHConnectProgress>;

	readonly connections: readonly ISSHAgentHostConnection[];

	connect(config: ISSHAgentHostConfig): Promise<ISSHAgentHostConnection>;

	disconnect(host: string): Promise<void>;

	listSSHConfigHosts(): Promise<string[]>;

	ensureUserSSHConfig(): Promise<URI>;

	listSSHConfigFiles(): Promise<URI[]>;

	resolveSSHConfig(host: string): Promise<ISSHResolvedConfig>;

	reconnect(sshConfigHost: string, name: string, userInitiated?: boolean): Promise<ISSHAgentHostConnection>;
}
export interface ISSHConnectResult {
	readonly connectionId: string;
	readonly address: string;
	readonly name: string;
	readonly connectionToken: string | undefined;
	readonly config: ISSHAgentHostConfigSanitized;
	readonly sshConfigHost?: string;
	readonly serverType?: AgentHostServerType;
	readonly instanceId?: string;
	readonly primary?: boolean;
	readonly lifecycle?: SSHAgentHostLifecycle;
}

export type SSHStrictHostKeyChecking = 'ask' | 'accept-new' | 'yes' | 'no' | 'off';

export function isSSHStrictHostKeyChecking(value: string): value is SSHStrictHostKeyChecking {
	return value === 'ask' || value === 'accept-new' || value === 'yes' || value === 'no' || value === 'off';
}

export interface ISSHResolvedConfig {
	readonly hostname: string;
	readonly user: string | undefined;
	readonly port: number;
	readonly identityFile: string[];
	readonly identityAgent: string | undefined;
	readonly forwardAgent: boolean;
	readonly userKnownHostsFiles: string[];
	readonly globalKnownHostsFiles: string[];
	readonly strictHostKeyChecking: SSHStrictHostKeyChecking | undefined;
}

export interface ISSHConnectProgress {
	readonly connectionKey: string;
	readonly message: string;
}

export interface ISSHKeyboardInteractivePrompt {
	readonly prompt: string;
	readonly echo: boolean;
}

export interface ISSHKeyboardInteractiveRequest {
	readonly requestId: string;
	readonly connectionKey: string;
	readonly displayHost: string;
	readonly username: string;
	readonly name: string;
	readonly instructions: string;
	readonly prompts: readonly ISSHKeyboardInteractivePrompt[];
}

export interface ISSHEndpointCandidate {
	readonly type: AgentHostServerType;
	readonly pid: number;
	readonly instanceId: string;
	readonly quality?: string;
	readonly endpoint: AgentHostEndpointAddress;
}

export interface ISSHEndpointSelectionRequest {
	readonly requestId: string;
	readonly connectionKey: string;
	readonly displayHost: string;
	readonly candidates: readonly ISSHEndpointCandidate[];
}

export type ISSHEndpointSelection =
	| { readonly kind: 'candidate'; readonly type: AgentHostServerType; readonly pid: number; readonly instanceId: string }
	| { readonly kind: 'spawn' };

export type SSHKnownHostsMatch = 'match' | 'mismatch' | 'revoked' | 'ca-only' | 'unknown';

export const SSH_HOST_KEY_DENIED_ERROR_NAME = 'SSHHostKeyDenied';

export class SSHHostKeyDeniedError extends Error {
	constructor(displayHost: string) {
		super(`Host key verification failed for ${displayHost}`);
		this.name = SSH_HOST_KEY_DENIED_ERROR_NAME;
	}
}

export function isSSHHostKeyDeniedError(error: unknown): boolean {
	return error instanceof Error && error.name === SSH_HOST_KEY_DENIED_ERROR_NAME;
}

export interface ISSHHostKeyVerificationRequest {
	readonly requestId: string;
	readonly connectionKey: string;
	readonly displayHost: string;
	readonly host: string;
	readonly port: number;
	readonly keyType: string;
	readonly fingerprint: string;
	readonly knownHostsMatch: SSHKnownHostsMatch;
	readonly strictHostKeyChecking?: SSHStrictHostKeyChecking;
	readonly userInitiated: boolean;
}

export interface ISSHHostKeysAnnouncement {
	readonly connectionKey: string;
	readonly host: string;
	readonly port: number;
	readonly keys: readonly { readonly keyType: string; readonly fingerprint: string }[];
}

export const ISSHRemoteAgentHostMainService = createDecorator<ISSHRemoteAgentHostMainService>('sshRemoteAgentHostMainService');

export interface ISSHRemoteAgentHostMainService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConnections: Event<void>;

	readonly onDidCloseConnection: Event<string >;

	readonly onDidReportConnectProgress: Event<ISSHConnectProgress>;

	readonly onDidRelayMessage: Event<IRelayMessage>;

	readonly onDidRelayClose: Event<string >;

	readonly onDidRequestKeyboardInteractive: Event<ISSHKeyboardInteractiveRequest>;

	readonly onDidCancelKeyboardInteractive: Event<string >;

	respondKeyboardInteractive(requestId: string, responses: readonly string[] | undefined): Promise<void>;

	readonly onDidRequestEndpointSelection: Event<ISSHEndpointSelectionRequest>;

	readonly onDidCancelEndpointSelection: Event<string >;

	respondEndpointSelection(requestId: string, selection: ISSHEndpointSelection | undefined): Promise<void>;

	readonly onDidRequestHostKeyVerification: Event<ISSHHostKeyVerificationRequest>;

	readonly onDidCancelHostKeyVerification: Event<string >;

	respondHostKeyVerification(requestId: string, trusted: boolean): Promise<void>;

	readonly onDidAnnounceHostKeys: Event<ISSHHostKeysAnnouncement>;

	connect(config: ISSHAgentHostConfig): Promise<ISSHConnectResult>;

	relaySend(connectionId: string, message: string): Promise<void>;

	disconnect(host: string): Promise<void>;

	listSSHConfigHosts(): Promise<string[]>;

	ensureUserSSHConfig(): Promise<URI>;

	listSSHConfigFiles(): Promise<URI[]>;

	resolveSSHConfig(host: string): Promise<ISSHResolvedConfig>;

	reconnect(sshConfigHost: string, name: string, remoteAgentHostCommand?: string, agentForward?: boolean, userInitiated?: boolean, preferredAgentLocation?: RemoteAgentHostLocationPreference): Promise<ISSHConnectResult>;
}
