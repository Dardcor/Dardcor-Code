/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AgentHostMachineIdEnvKey = 'VSCODE_AGENT_HOST_MACHINE_ID';
export const AgentHostSqmIdEnvKey = 'VSCODE_AGENT_HOST_SQM_ID';
export const AgentHostDevDeviceIdEnvKey = 'VSCODE_AGENT_HOST_DEV_DEVICE_ID';

export const AgentHostTelemetryLevelEnvKey = 'VSCODE_AGENT_HOST_TELEMETRY_LEVEL';

export interface IAgentHostForwardedTelemetryIds {
	readonly machineId: string;
	readonly sqmId: string;
	readonly devDeviceId: string;
}

export function buildAgentHostTelemetryIdEnv(ids: IAgentHostForwardedTelemetryIds): Record<string, string> {
	const env: Record<string, string> = {};
	if (ids.machineId) {
		env[AgentHostMachineIdEnvKey] = ids.machineId;
	}
	if (ids.sqmId) {
		env[AgentHostSqmIdEnvKey] = ids.sqmId;
	}
	if (ids.devDeviceId) {
		env[AgentHostDevDeviceIdEnvKey] = ids.devDeviceId;
	}
	return env;
}
