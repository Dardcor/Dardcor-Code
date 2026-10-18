/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { type AICustomizationSource, AICustomizationSources } from '../../common/aiCustomizationWorkspaceService.js';

export const aiCustomizationViewIcon = registerIcon('ai-customization-view-icon', Codicon.sparkle, localize('aiCustomizationViewIcon', "Icon for the Agent Customization view."));

export const agentIcon = registerIcon('ai-customization-agent', Codicon.agent, localize('aiCustomizationAgentIcon', "Icon for custom agents."));

export const skillIcon = registerIcon('ai-customization-skill', Codicon.lightbulb, localize('aiCustomizationSkillIcon', "Icon for skills."));

export const instructionsIcon = registerIcon('ai-customization-instructions', Codicon.book, localize('aiCustomizationInstructionsIcon', "Icon for instruction files."));

export const promptIcon = registerIcon('ai-customization-prompt', Codicon.bookmark, localize('aiCustomizationPromptIcon', "Icon for prompt files."));

export const hookIcon = registerIcon('ai-customization-hook', Codicon.zap, localize('aiCustomizationHookIcon', "Icon for hooks."));

export const addIcon = registerIcon('ai-customization-add', Codicon.add, localize('aiCustomizationAddIcon', "Icon for adding new items."));

export const runIcon = registerIcon('ai-customization-run', Codicon.play, localize('aiCustomizationRunIcon', "Icon for running a prompt or agent."));

export const workspaceIcon = registerIcon('ai-customization-workspace', Codicon.folder, localize('aiCustomizationWorkspaceIcon', "Icon for workspace items."));

export const userIcon = registerIcon('ai-customization-user', Codicon.account, localize('aiCustomizationUserIcon', "Icon for user items."));

export const extensionIcon = registerIcon('ai-customization-extension', Codicon.extensions, localize('aiCustomizationExtensionIcon', "Icon for extension-contributed items."));

export const pluginIcon = registerIcon('ai-customization-plugin', Codicon.plug, localize('aiCustomizationPluginIcon', "Icon for plugin-contributed items."));

export const toolsIcon = registerIcon('ai-customization-tools', Codicon.tools, localize('aiCustomizationToolsIcon', "Icon for the Tools section."));

export const builtinIcon = registerIcon('ai-customization-builtin', Codicon.starFull, localize('aiCustomizationBuiltinIcon', "Icon for built-in items."));

export const mcpServerIcon = registerIcon('ai-customization-mcp-server', Codicon.server, localize('aiCustomizationMcpServerIcon', "Icon for MCP servers."));

export function sourceToIcon(source: AICustomizationSource): ThemeIcon {
	switch (source) {
		case AICustomizationSources.local: return workspaceIcon;
		case AICustomizationSources.user: return userIcon;
		case AICustomizationSources.extension: return extensionIcon;
		case AICustomizationSources.plugin: return pluginIcon;
		case AICustomizationSources.builtin: return builtinIcon;
		default: return instructionsIcon;
	}
}
