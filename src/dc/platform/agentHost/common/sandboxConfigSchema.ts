/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { AgentNetworkDomainSettingId } from '../../networkFilter/common/settings.js';
import { AgentSandboxEnabledValue, AgentSandboxSettingId } from '../../sandbox/common/settings.js';
import { createSchema, schemaProperty } from './agentHostSchema.js';

export const enum AgentHostSandboxConfigKey {
	Sandbox = 'sandbox',
}

export const enum AgentHostSandboxKey {
	Enabled = 'enabled',
	WindowsEnabled = 'enabled.windows',
	AllowNetwork = 'allowNetwork',
	AllowUnsandboxedCommands = 'allowUnsandboxedCommands',
	LinuxFileSystem = 'fileSystem.linux',
	MacFileSystem = 'fileSystem.mac',
	WindowsFileSystem = 'fileSystem.windows',
	AdvancedRuntime = 'advanced.runtime',
	AllowedNetworkDomains = 'allowedNetworkDomains',
	DeniedNetworkDomains = 'deniedNetworkDomains',
}

export type ISandboxConfigValue = Partial<{
	[AgentHostSandboxKey.Enabled]: AgentSandboxEnabledValue;
	[AgentHostSandboxKey.WindowsEnabled]: AgentSandboxEnabledValue;
	[AgentHostSandboxKey.AllowNetwork]: boolean;
	[AgentHostSandboxKey.AllowUnsandboxedCommands]: boolean;
	[AgentHostSandboxKey.LinuxFileSystem]: Record<string, unknown>;
	[AgentHostSandboxKey.MacFileSystem]: Record<string, unknown>;
	[AgentHostSandboxKey.WindowsFileSystem]: Record<string, unknown>;
	[AgentHostSandboxKey.AdvancedRuntime]: Record<string, unknown>;
	[AgentHostSandboxKey.AllowedNetworkDomains]: string[];
	[AgentHostSandboxKey.DeniedNetworkDomains]: string[];
}>;

export const sandboxConfigSchema = createSchema({
	[AgentHostSandboxConfigKey.Sandbox]: schemaProperty<ISandboxConfigValue>({
		type: 'object',
		title: localize('agentHost.config.sandbox.title', "Agent Sandbox"),
		properties: {
			[AgentHostSandboxKey.Enabled]: {
				type: 'string',
				title: localize('agentHost.config.sandbox.enabled.title', "Sandbox Enabled"),
				enum: [AgentSandboxEnabledValue.Off, AgentSandboxEnabledValue.On],
			},
			[AgentHostSandboxKey.WindowsEnabled]: {
				type: 'string',
				title: localize('agentHost.config.sandbox.windowsEnabled.title', "Sandbox Enabled (Windows)"),
				enum: [AgentSandboxEnabledValue.Off, AgentSandboxEnabledValue.On],
			},
			[AgentHostSandboxKey.AllowNetwork]: {
				type: 'boolean',
				title: localize('agentHost.config.sandbox.allowNetwork.title', "Allow Network"),
			},
			[AgentHostSandboxKey.AllowUnsandboxedCommands]: {
				type: 'boolean',
				title: localize('agentHost.config.sandbox.allowUnsandboxedCommands.title', "Allow Unsandboxed Commands"),
			},
			[AgentHostSandboxKey.LinuxFileSystem]: {
				type: 'object',
				title: localize('agentHost.config.sandbox.linuxFileSystem.title', "Linux Sandbox Filesystem"),
			},
			[AgentHostSandboxKey.MacFileSystem]: {
				type: 'object',
				title: localize('agentHost.config.sandbox.macFileSystem.title', "macOS Sandbox Filesystem"),
			},
			[AgentHostSandboxKey.WindowsFileSystem]: {
				type: 'object',
				title: localize('agentHost.config.sandbox.windowsFileSystem.title', "Windows Sandbox Filesystem"),
			},
			[AgentHostSandboxKey.AdvancedRuntime]: {
				type: 'object',
				title: localize('agentHost.config.sandbox.advancedRuntime.title', "Advanced Sandbox Runtime"),
			},
			[AgentHostSandboxKey.AllowedNetworkDomains]: {
				type: 'array',
				title: localize('agentHost.config.sandbox.allowedDomains.title', "Allowed Network Domains"),
				items: { type: 'string', title: localize('agentHost.config.sandbox.allowedDomains.item.title', "Domain") },
			},
			[AgentHostSandboxKey.DeniedNetworkDomains]: {
				type: 'array',
				title: localize('agentHost.config.sandbox.deniedDomains.title', "Denied Network Domains"),
				items: { type: 'string', title: localize('agentHost.config.sandbox.deniedDomains.item.title', "Domain") },
			},
		},
	}),
});

export const sandboxSettingIdToAgentHostKey: Readonly<Record<string, AgentHostSandboxKey>> = {
	[AgentSandboxSettingId.AgentSandboxEnabled]: AgentHostSandboxKey.Enabled,
	[AgentSandboxSettingId.AgentSandboxWindowsEnabled]: AgentHostSandboxKey.WindowsEnabled,
	[AgentSandboxSettingId.AgentSandboxAllowNetwork]: AgentHostSandboxKey.AllowNetwork,
	[AgentSandboxSettingId.AgentSandboxAllowUnsandboxedCommands]: AgentHostSandboxKey.AllowUnsandboxedCommands,
	[AgentSandboxSettingId.AgentSandboxLinuxFileSystem]: AgentHostSandboxKey.LinuxFileSystem,
	[AgentSandboxSettingId.AgentSandboxMacFileSystem]: AgentHostSandboxKey.MacFileSystem,
	[AgentSandboxSettingId.AgentSandboxWindowsFileSystem]: AgentHostSandboxKey.WindowsFileSystem,
	[AgentSandboxSettingId.AgentSandboxAdvancedRuntime]: AgentHostSandboxKey.AdvancedRuntime,
	[AgentNetworkDomainSettingId.AllowedNetworkDomains]: AgentHostSandboxKey.AllowedNetworkDomains,
	[AgentNetworkDomainSettingId.DeniedNetworkDomains]: AgentHostSandboxKey.DeniedNetworkDomains,
};
