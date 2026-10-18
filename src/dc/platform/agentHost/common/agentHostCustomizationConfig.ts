/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { createSchema, schemaProperty } from './agentHostSchema.js';
import { CustomizationType, type Customization, type PluginCustomization } from './state/protocol/state.js';
import { customizationId } from './state/sessionState.js';

export const enum AgentHostConfigKey {
	Customizations = 'customizations',
	DefaultShell = 'defaultShell',
	AllowSignedOutWhenUsable = 'allowSignedOutWhenUsable',
	SessionCustomizationDiscoveryMode = 'sessionCustomizationDiscoveryMode',
	GithubEnterpriseUri = 'githubEnterpriseUri',
}

export const SESSION_CUSTOMIZATION_DISCOVERY_MODES = ['scan', 'discover'] as const;
export type SessionCustomizationDiscoveryMode = typeof SESSION_CUSTOMIZATION_DISCOVERY_MODES[number];
export const DEFAULT_SESSION_CUSTOMIZATION_DISCOVERY_MODE: SessionCustomizationDiscoveryMode = 'discover';

interface IPersistedCustomizationConfigEntry {
	uri: string;
	displayName: string;
	description?: string;
}

export const agentHostCustomizationConfigSchema = createSchema({
	[AgentHostConfigKey.Customizations]: schemaProperty<IPersistedCustomizationConfigEntry[]>({
		type: 'array',
		title: localize('agentHost.config.customizations.title', "Plugins"),
		description: localize('agentHost.config.customizations.description', "Plugins configured on this agent host and available to remote sessions."),
		default: [],
		items: {
			type: 'object',
			title: localize('agentHost.config.customizations.itemTitle', "Plugin"),
			properties: {
				uri: {
					type: 'string',
					title: localize('agentHost.config.customizations.uri', "Plugin URI"),
				},
				displayName: {
					type: 'string',
					title: localize('agentHost.config.customizations.displayName', "Name"),
				},
				description: {
					type: 'string',
					title: localize('agentHost.config.customizations.descriptionField', "Description"),
				},
			},
			required: ['uri', 'displayName'],
		},
	}),
	[AgentHostConfigKey.DefaultShell]: schemaProperty<string>({
		type: 'string',
		title: localize('agentHost.config.defaultShell.title', "Default Shell"),
		description: localize('agentHost.config.defaultShell.description', "Absolute path to the shell executable used by host-managed terminals. Normally pushed by the connected VS Code client from `terminal.integrated.agentHostProfile.<os>` (falling back to `terminal.integrated.defaultProfile.<os>`); when unset, the agent host falls back to the system shell. Only the path is supported; `args` and `env` from the workbench profile are not piped through yet. The workbench only pushes this for the local agent host — remote agent host operators should set this directly in the remote machine's `agent-host-config.json`."),
	}),
	[AgentHostConfigKey.AllowSignedOutWhenUsable]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.allowSignedOutWhenUsable.title', "Allow Signed-Out Agent Host"),
		description: localize('agentHost.config.allowSignedOutWhenUsable.description', "Experimental. When enabled, Agent Host sessions remain available while signed out as long as the selected agent has a usable model and authentication (for example Codex with ChatGPT authentication or Claude in native mode with your own Anthropic credentials). When disabled (the default), GitHub sign-in is required."),
		default: false,
	}),
	[AgentHostConfigKey.SessionCustomizationDiscoveryMode]: schemaProperty<SessionCustomizationDiscoveryMode>({
		type: 'string',
		enum: [...SESSION_CUSTOMIZATION_DISCOVERY_MODES],
		title: localize('agentHost.config.sessionCustomizationDiscoveryMode.title', "Session Customization Discovery Mode"),
		description: localize('agentHost.config.sessionCustomizationDiscoveryMode.description', "Controls whether session-scoped customizations are populated from local file scanning or from Copilot SDK discovery."),
		default: DEFAULT_SESSION_CUSTOMIZATION_DISCOVERY_MODE,
	}),
	[AgentHostConfigKey.GithubEnterpriseUri]: schemaProperty<string>({
		type: 'string',
		title: localize('agentHost.config.githubEnterpriseUri.title', "GitHub Enterprise URI"),
		description: localize('agentHost.config.githubEnterpriseUri.description', "Optional base URI of a GitHub Enterprise instance (for example \"https://ghe.example.com\" for GitHub Enterprise Server, or \"https://tenant.ghe.com\" for GitHub Enterprise Cloud). When set, the agent host authenticates and makes GitHub API calls against this instance instead of github.com. Normally pushed by the connected VS Code client from the `github-enterprise.uri` setting; remote agent host operators can set it directly in the remote `agent-host-config.json`."),
	}),
});

export const defaultAgentHostCustomizationConfigValues = {
	[AgentHostConfigKey.Customizations]: [] as IPersistedCustomizationConfigEntry[],
};

export function getAgentHostConfiguredCustomizations(values: Record<string, unknown> | undefined): readonly Customization[] {
	const raw = values?.[AgentHostConfigKey.Customizations];
	const entries = agentHostCustomizationConfigSchema.validate(AgentHostConfigKey.Customizations, raw)
		? raw
		: defaultAgentHostCustomizationConfigValues[AgentHostConfigKey.Customizations];
	return entries.map(toContainerCustomization);
}

export function toContainerCustomization(entry: IPersistedCustomizationConfigEntry): PluginCustomization {
	return {
		type: CustomizationType.Plugin,
		id: customizationId(entry.uri),
		uri: entry.uri,
		name: entry.displayName,
	};
}
