/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqualOrParent } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { isCustomizationEnabled } from './customizationEnablement.js';
import { CustomizationType, type AgentCustomization, type ClientPluginCustomization, type Customization } from './state/protocol/state.js';

export function getEffectiveAgents(
	sessionCustomizations: readonly Customization[] | undefined,
): readonly AgentCustomization[] {
	const seen = new Map<string, AgentCustomization>();
	if (sessionCustomizations) {
		for (const container of sessionCustomizations) {
			if (container.type === CustomizationType.McpServer) {
				continue;
			}
			if ((container.type === CustomizationType.Plugin && !isCustomizationEnabled(container)) || (container.type === CustomizationType.Directory && !container.enabled) || !container.children) {
				continue;
			}
			for (const child of container.children) {
				if (child.type !== CustomizationType.Agent) {
					continue;
				}
				const key = child.uri.toString();
				if (!seen.has(key)) {
					seen.set(key, child);
				}
			}
		}
	}
	const result = [...seen.values()];
	result.sort((a, b) => a.name.localeCompare(b.name) || a.uri.toString().localeCompare(b.uri.toString()));
	return result;
}

export function getEffectiveClientAgents(
	clientCustomizations: readonly ClientPluginCustomization[] | undefined,
	clientAgents: readonly AgentCustomization[],
): readonly AgentCustomization[] {
	if (!clientCustomizations || clientCustomizations.length === 0) {
		return clientAgents;
	}
	return clientAgents.filter(agent => {
		const agentUri = URI.parse(agent.uri);
		const plugin = clientCustomizations.find(candidate => isEqualOrParent(agentUri, URI.parse(candidate.uri)));
		return !plugin || isCustomizationEnabled(plugin);
	});
}

export function agentHostAgentPickerStorageKey(resourceScheme: string): string {
	return `workbench.agentsession.agentHostAgentPicker.${resourceScheme}.selectedAgentUri`;
}

export function resolveAgentHostAgent(
	agents: readonly AgentCustomization[],
	sessionAgentUri: URI | string | undefined,
	storedAgentUri: string | undefined,
): AgentCustomization | undefined {
	if (sessionAgentUri !== undefined) {
		const sessionStr = typeof sessionAgentUri === 'string' ? sessionAgentUri : sessionAgentUri.toString();
		const match = agents.find(a => a.uri === sessionStr);
		if (match) {
			return match;
		}
	}
	return storedAgentUri ? agents.find(a => a.uri === storedAgentUri) : undefined;
}
