/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { localize } from '../../../../../../../nls.js';
import { registerIcon } from '../../../../../../../platform/theme/common/iconRegistry.js';
import { ILanguageModelChatMetadataAndIdentifier, isAutoLanguageModel } from '../../../../common/languageModels.js';
import { getCompactCodicon } from '../../../chatIcons.js';

const dardcorModelProviderIcon = registerIcon('chat-model-provider-dardcor', Codicon.sparkle, localize('chatModelProviderDardcorIcon', "Icon for Dardcor models."));
const openAIModelProviderIcon = registerIcon('chat-model-provider-openai', Codicon.openai, localize('chatModelProviderOpenAIIcon', "Icon for OpenAI models."));
const claudeModelProviderIcon = registerIcon('chat-model-provider-claude', Codicon.claude, localize('chatModelProviderClaudeIcon', "Icon for Claude models."));
const geminiModelProviderIcon = registerIcon('chat-model-provider-gemini', Codicon.googleGemini, localize('chatModelProviderGeminiIcon', "Icon for Gemini models."));
const kimiModelProviderIcon = registerIcon('chat-model-provider-kimi', Codicon.kimi, localize('chatModelProviderKimiIcon', "Icon for Kimi models."));
const microsoftModelProviderIcon = registerIcon('chat-model-provider-microsoft', Codicon.microsoft, localize('chatModelProviderMicrosoftIcon', "Icon for Microsoft models."));
const xAIModelProviderIcon = registerIcon('chat-model-provider-xai', Codicon.xai, localize('chatModelProviderXAIIcon', "Icon for xAI models."));
const genericModelProviderIcon = registerIcon('chat-model-provider-generic', Codicon.sparkle, localize('chatModelProviderGenericIcon', "Icon for other model providers."));
const genericModelProviderCompactIcon = registerIcon('chat-model-provider-generic-compact', Codicon.sparkleCompact, localize('chatModelProviderGenericCompactIcon', "Compact icon for other model providers."));
const codebuddyModelProviderIcon = registerIcon('chat-model-provider-codebuddy', Codicon.hubot, localize('chatModelProviderCodebuddyIcon', "Icon for CodeBuddy models."));
const clineModelProviderIcon = registerIcon('chat-model-provider-cline', Codicon.robot, localize('chatModelProviderClineIcon', "Icon for Cline models."));
const antigravityModelProviderIcon = registerIcon('chat-model-provider-antigravity', Codicon.sparkle, localize('chatModelProviderAntigravityIcon', "Icon for Antigravity models."));
const qoderModelProviderIcon = registerIcon('chat-model-provider-qoder', Codicon.code, localize('chatModelProviderQoderIcon', "Icon for Qoder models."));
const kilocodeModelProviderIcon = registerIcon('chat-model-provider-kilocode', Codicon.serverProcess, localize('chatModelProviderKilocodeIcon', "Icon for KiloCode models."));

export function getProviderIconForIdentity(identity: string, modelIdentity: string = identity): ThemeIcon {
	const normalized = identity.toLowerCase();
	if (normalized.includes('codebuddy') || normalized.includes('cbai') || normalized.includes('cbcn')) {
		return codebuddyModelProviderIcon;
	}
	if (normalized.includes('cline') || /\bcl\b/.test(normalized) || normalized.includes('clinepass')) {
		return clineModelProviderIcon;
	}
	if (normalized.includes('antigravity') || /\bag\b/.test(normalized)) {
		return antigravityModelProviderIcon;
	}
	if (normalized.includes('qoder') || /\bqd\b/.test(normalized)) {
		return qoderModelProviderIcon;
	}
	if (normalized.includes('kilocode') || normalized.includes('kilo') || /\bkc\b/.test(normalized)) {
		return kilocodeModelProviderIcon;
	}
	if (normalized.includes('grok') || normalized.includes('xai')) {
		return xAIModelProviderIcon;
	}
	if (normalized.includes('claude') || normalized.includes('anthropic')) {
		return claudeModelProviderIcon;
	}
	if (normalized.includes('gemini') || normalized.includes('google')) {
		return geminiModelProviderIcon;
	}
	if (normalized.includes('kimi') || normalized.includes('moonshot')) {
		return kimiModelProviderIcon;
	}
	if (normalized.includes('microsoft') || /\bmai\b/.test(normalized)) {
		return microsoftModelProviderIcon;
	}
	if (normalized.includes('openai') || normalized.includes('chatgpt') || normalized.includes('gpt') || normalized.includes('codex') || /\bo[134]\b/.test(normalized)) {
		return openAIModelProviderIcon;
	}
	if (normalized.includes('dardcor') || modelIdentity.toLowerCase().includes('dardcor')) {
		return dardcorModelProviderIcon;
	}
	return genericModelProviderIcon;
}

export function getModelProviderIcon(model: ILanguageModelChatMetadataAndIdentifier): ThemeIcon {
	const identity = `${model.metadata.vendor} ${model.metadata.family} ${model.metadata.id} ${model.metadata.name}`;
	if (/grok|xai/i.test(identity)) {
		return xAIModelProviderIcon;
	}
	if (model.metadata.isBYOK) {
		return genericModelProviderIcon;
	}
	if (isAutoLanguageModel(model)) {
		return dardcorModelProviderIcon;
	}
	return getProviderIconForIdentity(identity, `${model.metadata.id} ${model.metadata.name}`);
}

export function getModelPickerIcon(model: ILanguageModelChatMetadataAndIdentifier): ThemeIcon {
	return model.metadata.statusIcon ?? getModelProviderIcon(model);
}

export function getCompactModelPickerIcon(model: ILanguageModelChatMetadataAndIdentifier): ThemeIcon {
	const icon = getModelPickerIcon(model);
	return icon.id === genericModelProviderIcon.id ? genericModelProviderCompactIcon : getCompactCodicon(icon);
}
