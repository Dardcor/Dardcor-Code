/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IManagedHoverContent } from '../../../../../base/browser/ui/hover/hover.js';
import { escapeMarkdownSyntaxTokens, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { DEFAULT_LOCAL_TRANSCRIPTION_MODEL } from '../../../../../platform/localTranscription/common/localTranscription.js';
import { DICTATION_MAI_MODEL_ID, DICTATION_MODEL_SETTING } from './chatSpeechToTextService.js';

function createMicButtonHover(title: string, description: string): MarkdownString {
	const markdown = new MarkdownString('', { supportThemeIcons: true });
	markdown.appendMarkdown(`**${escapeMarkdownSyntaxTokens(title)}**`);
	markdown.appendMarkdown('\n\n');
	markdown.appendMarkdown(escapeMarkdownSyntaxTokens(description));
	return markdown;
}

function asHoverContent(title: string, description: string): IManagedHoverContent {
	return { markdown: createMicButtonHover(title, description), markdownNotSupportedFallback: `${title}\n${description}` };
}

function getDictationDescription(configurationService: IConfigurationService): string {
	const modelId = configurationService.getValue<string>(DICTATION_MODEL_SETTING)?.trim();
	if (modelId === DICTATION_MAI_MODEL_ID) {
		return localize('dictation.hover.cloud', "Types what you say into the input. Transcribes in the cloud with the MAI speech model.");
	}
	if (!modelId || modelId === DEFAULT_LOCAL_TRANSCRIPTION_MODEL) {
		return localize('dictation.hover.nemotronMultilingual', "Types what you say into the input. Transcribes on-device with the Nemotron 3.5 ASR multilingual model.");
	}
	return localize('dictation.hover.onDevice', "Types what you say into the input. Transcribes on-device with {0}.", modelId);
}

function getVoiceModeDescription(): string {
	return localize('voiceMode.hover', "Talk with the agent and hear it reply. Uses the online real-time voice model.");
}

export function getDictationHoverMarkdown(title: string, configurationService: IConfigurationService): MarkdownString {
	return createMicButtonHover(title, getDictationDescription(configurationService));
}

export function getDictationHoverContent(title: string, configurationService: IConfigurationService): IManagedHoverContent {
	return asHoverContent(title, getDictationDescription(configurationService));
}

export function getVoiceModeHoverContent(title: string): IManagedHoverContent {
	return asHoverContent(title, getVoiceModeDescription());
}
