/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { FileAccess, Schemas } from '../../../base/common/network.js';
import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Client, IIPCOptions } from '../../../base/parts/ipc/node/ipc.cp.js';
import { AiAgentEnvValue, AiAgentEnvVar } from '../../chat/common/aiAgentEnv.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentService, INativeEnvironmentService } from '../../environment/common/environment.js';
import { parseAgentHostDebugPort } from '../../environment/node/environmentService.js';
import { ILogService } from '../../log/common/log.js';
import { getResolvedShellEnv } from '../../shell/node/shellEnv.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IAgentHostConnection, IAgentHostStarter } from '../common/agent.js';
import { AgentHostLaunchKind, AgentHostLaunchKindEnvVar, telemetryLevelToAgentHostValue } from '../common/agentHostTelemetry.js';
import { AgentHostClaudeAgentEnabledSettingId, AgentHostCodexAgentBinaryArgsSettingId, AgentHostCodexAgentEnabledSettingId, AgentHostCodexAgentSdkRootSettingId, AgentHostCodexAgentCodexHomeSettingId, AgentHostIpcChannels, AgentHostOTelCaptureContentSettingId, AgentHostOTelDbSpanExporterEnabledSettingId, AgentHostOTelEnabledSettingId, AgentHostOTelExporterTypeSettingId, AgentHostOTelOtlpEndpointSettingId, AgentHostOTelOtlpProtocolSettingId, AgentHostOTelOutfileSettingId, AgentHostOTelResourceAttributesSettingId, AgentHostOTelServiceNameSettingId, buildAgentHostOTelEnv, buildAgentSdkEnv, IAgentHostManagementService } from '../common/agentService.js';
import '../common/agentHostStarter.config.contribution.js';

export interface IAgentHostWebSocketConfig {
	readonly port?: string;
	readonly socketPath?: string;
	readonly host?: string;
	readonly connectionToken?: string;
}

export class NodeAgentHostStarter extends Disposable implements IAgentHostStarter {

	private _wsConfig: IAgentHostWebSocketConfig | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEnvironmentService private readonly _environmentService: INativeEnvironmentService,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
	}

	setWebSocketConfig(config: IAgentHostWebSocketConfig): void {
		this._wsConfig = config;
	}

	async start(): Promise<IAgentHostConnection> {
		const shellEnv = await this._resolveShellEnv();

		const env: Record<string, string> = {
			...shellEnv as Record<string, string>,
			[AiAgentEnvVar]: AiAgentEnvValue,
			VSCODE_ESM_ENTRYPOINT: 'vs/platform/agentHost/node/agentHostMain',
			VSCODE_PIPE_LOGGING: 'true',
			VSCODE_VERBOSE_LOGGING: 'true',
			[AgentHostLaunchKindEnvVar]: AgentHostLaunchKind.VSCodeCLI,
		};

		const sdkEnv = buildAgentSdkEnv({
			codexSdkRoot: this._configurationService.getValue<string>(AgentHostCodexAgentSdkRootSettingId),
			codexHome: this._configurationService.getValue<string>(AgentHostCodexAgentCodexHomeSettingId),
			codexBinaryArgs: this._configurationService.getValue<readonly string[]>(AgentHostCodexAgentBinaryArgsSettingId),
			claudeAgentEnabled: this._configurationService.getValue<boolean>(AgentHostClaudeAgentEnabledSettingId),
			codexAgentEnabled: this._configurationService.getValue<boolean>(AgentHostCodexAgentEnabledSettingId),
		}, process.env);
		Object.assign(env, sdkEnv);

		const policyValue = <T>(key: string): T | undefined => this._configurationService.inspect<T>(key).policyValue;
		const otelEnv = buildAgentHostOTelEnv({
			enabled: this._configurationService.getValue<boolean>(AgentHostOTelEnabledSettingId),
			exporterType: this._configurationService.getValue<string>(AgentHostOTelExporterTypeSettingId),
			otlpEndpoint: this._configurationService.getValue<string>(AgentHostOTelOtlpEndpointSettingId),
			captureContent: this._configurationService.getValue<boolean>(AgentHostOTelCaptureContentSettingId),
			outfile: this._configurationService.getValue<string>(AgentHostOTelOutfileSettingId),
			dbSpanExporterEnabled: this._configurationService.getValue<boolean>(AgentHostOTelDbSpanExporterEnabledSettingId),
		}, process.env, {
			enabled: policyValue<boolean>(AgentHostOTelEnabledSettingId),
			exporterType: policyValue<string>(AgentHostOTelExporterTypeSettingId),
			otlpProtocol: policyValue<string>(AgentHostOTelOtlpProtocolSettingId),
			otlpEndpoint: policyValue<string>(AgentHostOTelOtlpEndpointSettingId),
			captureContent: policyValue<boolean>(AgentHostOTelCaptureContentSettingId),
			outfile: policyValue<string>(AgentHostOTelOutfileSettingId),
			serviceName: policyValue<string>(AgentHostOTelServiceNameSettingId),
			resourceAttributes: policyValue<Record<string, string>>(AgentHostOTelResourceAttributesSettingId),
		});
		Object.assign(env, otelEnv);

		if (this._wsConfig) {
			if (this._wsConfig.port) {
				env['VSCODE_AGENT_HOST_PORT'] = this._wsConfig.port;
			}
			if (this._wsConfig.socketPath) {
				env['VSCODE_AGENT_HOST_SOCKET_PATH'] = this._wsConfig.socketPath;
			}
			if (this._wsConfig.host) {
				env['VSCODE_AGENT_HOST_HOST'] = this._wsConfig.host;
			}
			if (this._wsConfig.connectionToken) {
				env['VSCODE_AGENT_HOST_CONNECTION_TOKEN'] = this._wsConfig.connectionToken;
			}
		}

		const args = [
			'--type=agentHost',
			'--logsPath', this._environmentService.logsHome.with({ scheme: Schemas.file }).fsPath,
			'--user-data-dir', this._environmentService.userDataPath,
			'--telemetry-level', telemetryLevelToAgentHostValue(this._telemetryService.telemetryLevel),
		];

		const opts: IIPCOptions = {
			serverName: 'Agent Host',
			args,
			env,
		};

		const agentHostDebug = parseAgentHostDebugPort(this._environmentService.args, this._environmentService.isBuilt);
		if (agentHostDebug) {
			if (agentHostDebug.break && agentHostDebug.port) {
				opts.debugBrk = agentHostDebug.port;
			} else if (!agentHostDebug.break && agentHostDebug.port) {
				opts.debug = agentHostDebug.port;
			}
		}

		await this._removeStaleSocket();

		const client = new Client(FileAccess.asFileUri('bootstrap-fork').fsPath, opts);
		const store = new DisposableStore();
		store.add(client);

		return {
			client,
			store,
			onDidProcessExit: client.onDidProcessExit,
			shutdown: () => ProxyChannel.toService<IAgentHostManagementService>(client.getChannel(AgentHostIpcChannels.Management)).shutdown(),
		};
	}

	private async _removeStaleSocket(): Promise<void> {
		const socketPath = this._wsConfig?.socketPath;
		if (!socketPath || process.platform === 'win32') {
			return;
		}

		try {
			await fs.promises.unlink(socketPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
				this._logService.warn(`AgentHostStarter could not remove stale socket at ${socketPath}`, error);
			}
		}
	}

	private async _resolveShellEnv(): Promise<typeof process.env> {
		try {
			return await getResolvedShellEnv(this._configurationService, this._logService, this._environmentService.args, process.env);
		} catch (error) {
			this._logService.error('AgentHostStarter was unable to resolve shell environment', error);
			return {};
		}
	}
}
