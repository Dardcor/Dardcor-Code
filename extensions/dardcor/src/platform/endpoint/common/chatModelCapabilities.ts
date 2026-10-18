/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelChat } from 'vscode';
import { getCachedSha256Hash } from '../../../util/common/crypto';
import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import type { IChatEndpoint } from '../../networking/common/networking';

const HIDDEN_MODEL_A_HASHES = [
	'a99dd17dfee04155d863268596b7f6dd36d0a6531cd326348dbe7416142a21a3',
	'6b0f165d0590bf8d508540a796b4fda77bf6a0a4ed4e8524d5451b1913100a95'
];


const HIDDEN_MODEL_B_HASHES = [
	'1f48b3271e760c69ab2b17dcae5f5c661fa5b644c5976a8a99b23e05ae3cb6d6',
	'ffc50c70661c227edf8daae6f8dbed2dd0645386c12d43bc7fc44da166e043bd',
	'257c934076307881132be702a901618969591f0e11e1df51b22b1d4010f0a0d0',
];

const VSC_MODEL_HASHES_A = [
	'6db59e9bfe6e2ce608c0ee0ade075c64e4d054f05305e3034481234703381bb5',
	'd7b81f23b6ab47d41130359bc203a6c653bba461b3da0185406353ce2b3abfa7',
];

const VSC_MODEL_HASHES_B = [
	'6b0f165d0590bf8d508540a796b4fda77bf6a0a4ed4e8524d5451b1913100a95',
	'1cdd4febbc7ee6b1abe0fbdd42217744c5912c79366db4befd91698b46c40a3c',
];

const VSC_MODEL_HASHES_C = [
	'0425aeda24d2fd93e2a879c4d813e4f3997aa444f1f4a633241236f9f773df73',
];

const VSC_MODEL_HASHES_D = [
	'e82ff0e2d4e4bae1f012dc599d520f8d61becfc4762f3717577b270be199db92',
];

const VSC_MODEL_HASHES_E: string[] = [];


const VSC_MODEL_HASHES_EDIT_TOOL_SET = [
	'6db59e9bfe6e2ce608c0ee0ade075c64e4d054f05305e3034481234703381bb5',
	'6b0f165d0590bf8d508540a796b4fda77bf6a0a4ed4e8524d5451b1913100a95',
	'd7b81f23b6ab47d41130359bc203a6c653bba461b3da0185406353ce2b3abfa7',
	'1cdd4febbc7ee6b1abe0fbdd42217744c5912c79366db4befd91698b46c40a3c',
	'0425aeda24d2fd93e2a879c4d813e4f3997aa444f1f4a633241236f9f773df73',
	'e82ff0e2d4e4bae1f012dc599d520f8d61becfc4762f3717577b270be199db92',
];

const HIDDEN_MODEL_E_HASHES: string[] = [
	'6013de0381f648b7f21518885c02b40b7583adfb33c6d9b64d3aed52c3934798'
];

const HIDDEN_MODEL_F_HASHES: string[] = [
	'ab45e8474269b026f668d49860b36850122e18a50d5ea38f3fefdae08261865c',
	'9542d5c077c2bc379f92be32272b14be8b94a8841323465db0d5b3d6f4f0dab0',
];

const HIDDEN_MODEL_J_HASHES: string[] = [
	'0a4346f806b28b3ce94905c3ac56fcd5ee2337d8613161696aba52eb0c3551cc',
	'2a7b79b0151aa44a0abee17adc0e18df1c07d8d15d7affa989c3b3afb6bee0a0',
	'f3c2984127dd2db50a555194925ca0d55c3c7b676e889c9406b2e6875a67e29c',
	'5a81e6aa7556585ba7c569881d1103683adc9e0124ff7952df423afba2f167b5',
];

const HIDDEN_MODEL_K_HASH = 'a62e299160a1075d9973c28a7aa77f446c21c09887c7aa65c11022918cf83eda';

const HIDDEN_FAMILY_H_HASHES: string[] = [
	'70fcded3f255d368e868cc807d8838a62108bfa5c86ce7d37966f58cda229e33',
];

export interface IModelCapabilityOverride {
	family?: string;
}

export function getModelCapabilityOverride(
	modelId: string,
	configurationService: IConfigurationService,
): IModelCapabilityOverride | undefined {
	const map = configurationService.getConfig(ConfigKey.Advanced.ModelCapabilityOverrides);
	return map?.[modelId];
}

export function getModelId(model: LanguageModelChat | IChatEndpoint): string {
	return 'id' in model ? model.id : model.model;
}

export function isHiddenModelA(model: LanguageModelChat | IChatEndpoint) {
	const h = getCachedSha256Hash(model.family);
	return HIDDEN_MODEL_A_HASHES.includes(h);
}

export function isHiddenModelB(model: LanguageModelChat | IChatEndpoint | string) {
	const h = getCachedSha256Hash(typeof model === 'string' ? model : model.family);
	return HIDDEN_MODEL_B_HASHES.includes(h);
}


export function isHiddenModelE(model: LanguageModelChat | IChatEndpoint) {
	const h = getCachedSha256Hash(model.family);
	return HIDDEN_MODEL_E_HASHES.includes(h);
}

export function isHiddenModelF(model: LanguageModelChat | IChatEndpoint) {
	const h = getCachedSha256Hash(model.family);
	return HIDDEN_MODEL_F_HASHES.includes(h);
}

export function isHiddenFamilyH(model: LanguageModelChat | IChatEndpoint) {
	const family_hash = getCachedSha256Hash(model.family);
	return HIDDEN_FAMILY_H_HASHES.includes(family_hash);
}

export function isHiddenModelK(model: LanguageModelChat | IChatEndpoint) {
	const h = getCachedSha256Hash(model.family);
	return h === HIDDEN_MODEL_K_HASH;
}


export function isGpt54(model: LanguageModelChat | IChatEndpoint | string) {
	const h = getCachedSha256Hash(typeof model === 'string' ? model : model.family);
	const family = typeof model === 'string' ? model : model.family;
	return family.startsWith('gpt-5.4') || HIDDEN_MODEL_J_HASHES.includes(h);
}

export function isGpt55(model: LanguageModelChat | IChatEndpoint | string) {
	const h = getCachedSha256Hash(typeof model === 'string' ? model : model.family);
	const family = typeof model === 'string' ? model : model.family;
	return family.startsWith('gpt-5.5') || HIDDEN_MODEL_B_HASHES.includes(h);
}

export function isGpt56(model: LanguageModelChat | IChatEndpoint | string) {
	const family = typeof model === 'string' ? model : model.family;
	return family === 'gpt-5.6-sol' || family === 'gpt-5.6-terra' || family === 'gpt-5.6-luna';
}

export function isGpt53Codex(model: LanguageModelChat | IChatEndpoint | string) {
	const family = typeof model === 'string' ? model : model.family;
	return family.startsWith('gpt-5.3-codex');
}

export function isKimiFamily(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const matches = (value: string): boolean => {
		const normalized = value.toLowerCase();
		return normalized.includes('kimi-k2.6') || normalized.includes('kimi-k2.7-code') || normalized.includes('kimi-k3');
	};

	if (typeof model === 'string') {
		return matches(model);
	}

	return matches(model.family) || matches(getModelId(model));
}

export function isVSCModelA(model: LanguageModelChat | IChatEndpoint) {

	const ID_hash = getCachedSha256Hash(getModelId(model));
	const family_hash = getCachedSha256Hash(model.family);
	return VSC_MODEL_HASHES_A.includes(ID_hash) || VSC_MODEL_HASHES_A.includes(family_hash);
}

export function isVSCModelB(model: LanguageModelChat | IChatEndpoint) {
	const ID_hash = getCachedSha256Hash(getModelId(model));
	const family_hash = getCachedSha256Hash(model.family);
	return VSC_MODEL_HASHES_B.includes(ID_hash) || VSC_MODEL_HASHES_B.includes(family_hash);
}

export function isVSCModelReplaceStringSet(model: LanguageModelChat | IChatEndpoint) {
	const ID_hash = getCachedSha256Hash(getModelId(model));
	const family_hash = getCachedSha256Hash(model.family);
	return VSC_MODEL_HASHES_EDIT_TOOL_SET.includes(ID_hash) || VSC_MODEL_HASHES_EDIT_TOOL_SET.includes(family_hash);
}

export function isVSCModelC(model: LanguageModelChat | IChatEndpoint) {
	const ID_hash = getCachedSha256Hash(getModelId(model));
	const family_hash = getCachedSha256Hash(model.family);
	return VSC_MODEL_HASHES_C.includes(ID_hash) || VSC_MODEL_HASHES_C.includes(family_hash);
}

export function isVSCModelD(model: LanguageModelChat | IChatEndpoint) {
	const ID_hash = getCachedSha256Hash(getModelId(model));
	const family_hash = getCachedSha256Hash(model.family);
	return VSC_MODEL_HASHES_D.includes(ID_hash) || VSC_MODEL_HASHES_D.includes(family_hash);
}

export function isVSCModelE(model: LanguageModelChat | IChatEndpoint) {
	const modelId = getModelId(model);
	const ID_hash = getCachedSha256Hash(modelId);
	const family_hash = getCachedSha256Hash(model.family);
	return model.name.startsWith('vscModelE') || model.family.startsWith('vscModelE') || modelId.startsWith('vscModelE') || VSC_MODEL_HASHES_E.includes(ID_hash) || VSC_MODEL_HASHES_E.includes(family_hash);
}

export function isGpt52CodexFamily(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const family = typeof model === 'string' ? model : model.family;
	return family === 'gpt-5.2-codex';
}

export function isGpt52Family(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const family = typeof model === 'string' ? model : model.family;
	return family === 'gpt-5.2';
}

export function modelPrefersInstructionsInUserMessage(modelFamily: string) {
	return modelFamily.includes('claude-3.5-sonnet');
}

export function modelPrefersInstructionsAfterHistory(modelFamily: string) {
	return modelFamily.includes('claude-3.5-sonnet');
}

export function modelSupportsApplyPatch(model: LanguageModelChat | IChatEndpoint): boolean {
	if (isVSCModelReplaceStringSet(model)) {
		return false;
	}
	return (model.family.startsWith('gpt') && !model.family.includes('gpt-4o'))
		|| model.family === 'o4-mini'
		|| isGpt52CodexFamily(model.family)
		|| isGpt53Codex(model.family)
		|| isVSCModelA(model)
		|| isVSCModelB(model)
		|| isGpt52Family(model.family)
		|| isGpt54(model)
		|| isHiddenModelB(model)
		|| isGpt56(model);
}

export function modelPrefersJsonNotebookRepresentation(model: LanguageModelChat | IChatEndpoint): boolean {
	return (model.family.startsWith('gpt') && !model.family.includes('gpt-4o'))
		|| model.family === 'o4-mini'
		|| isGpt52CodexFamily(model.family)
		|| isGpt53Codex(model.family)
		|| isGpt52Family(model.family)
		|| isGpt54(model)
		|| isHiddenModelB(model)
		|| isGpt56(model);
}

export function modelSupportsReplaceString(model: LanguageModelChat | IChatEndpoint): boolean {
	return isGeminiFamily(model) || isXAiFamily(model) || modelSupportsMultiReplaceString(model) || isHiddenModelF(model) || isMinimaxFamily(model) || isHiddenFamilyH(model) || isKimiFamily(model);
}

export function modelSupportsMultiReplaceString(model: LanguageModelChat | IChatEndpoint): boolean {
	return isAnthropicFamily(model) || isXAiFamily(model) || isHiddenModelE(model) || isVSCModelReplaceStringSet(model) || isMinimaxFamily(model) || isHiddenFamilyH(model) || isKimiFamily(model);
}

export function modelCanUseReplaceStringExclusively(model: LanguageModelChat | IChatEndpoint): boolean {
	return isAnthropicFamily(model) || isXAiFamily(model) || isHiddenModelE(model) || model.family.toLowerCase().includes('gemini-3') || isVSCModelReplaceStringSet(model) || isHiddenModelF(model) || isMinimaxFamily(model) || isHiddenFamilyH(model) || isKimiFamily(model);
}

export function modelShouldUseReplaceStringHealing(model: LanguageModelChat | IChatEndpoint) {
	return model.family.includes('gemini-2');
}

export function modelCanUseMcpResultImageURL(model: LanguageModelChat | IChatEndpoint): boolean {
	return !isAnthropicFamily(model) && !isHiddenModelE(model);
}

export function modelCanUseImageURL(model: LanguageModelChat | IChatEndpoint): boolean {
	return true;
}

export function modelSupportsPDFDocuments(model: LanguageModelChat | IChatEndpoint): boolean {
	return isAnthropicFamily(model) || isGpt5PlusFamily(model) || isGpt56(model);
}

export function modelSupportCacheBreakPoints(model: LanguageModelChat | IChatEndpoint): boolean {
	return isGpt56(model);
}

export function modelCanUseApplyPatchExclusively(model: LanguageModelChat | IChatEndpoint): boolean {
	if (isVSCModelReplaceStringSet(model)) {
		return false;
	}
	return isGpt5PlusFamily(model) || isVSCModelA(model) || isVSCModelB(model);
}

export function modelNeedsStrongReplaceStringHint(model: LanguageModelChat | IChatEndpoint): boolean {
	return isGeminiFamily(model) || isHiddenModelF(model);
}

export function modelSupportsSimplifiedApplyPatchInstructions(model: LanguageModelChat | IChatEndpoint): boolean {
	return isGpt5PlusFamily(model) || isVSCModelA(model) || isVSCModelB(model);
}

export function isAnthropicFamily(model: LanguageModelChat | IChatEndpoint): boolean {
	return model.family.startsWith('claude') || model.family.startsWith('Anthropic');
}

export function isGeminiFamily(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const family = typeof model === 'string' ? model : model.family;
	return family.toLowerCase().startsWith('gemini') || getCachedSha256Hash(family) === HIDDEN_MODEL_K_HASH;
}

export function isMinimaxFamily(model: LanguageModelChat | IChatEndpoint): boolean {
	return model.family.toLowerCase().includes('minimax');
}

export function isXAiFamily(model: LanguageModelChat | IChatEndpoint): boolean {
	return model.family.startsWith('grok');
}

export function isGpt5PlusFamily(model: LanguageModelChat | IChatEndpoint | string | undefined): boolean {
	if (!model) {
		return false;
	}

	const family = typeof model === 'string' ? model : model.family;
	return !!family.startsWith('gpt-5');
}

export function isGptCodexFamily(model: LanguageModelChat | IChatEndpoint | string | undefined): boolean {
	if (!model) {
		return false;
	}

	const family = typeof model === 'string' ? model : model.family;
	return (!!family.startsWith('gpt-') && family.includes('-codex'));
}

export function isGpt5Family(model: LanguageModelChat | IChatEndpoint | string | undefined): boolean {
	if (!model) {
		return false;
	}

	const family = typeof model === 'string' ? model : model.family;
	return family === 'gpt-5' || family === 'gpt-5-mini' || family === 'gpt-5-codex';
}

export function isGptFamily(model: LanguageModelChat | IChatEndpoint | string | undefined): boolean {
	if (!model) {
		return false;
	}

	const family = typeof model === 'string' ? model : model.family;
	return !!family.startsWith('gpt-');
}

export function isGpt51Family(model: LanguageModelChat | IChatEndpoint | string | undefined): boolean {
	if (!model) {
		return false;
	}

	const family = typeof model === 'string' ? model : model.family;
	return !!family.startsWith('gpt-5.1');
}

export function getVerbosityForModelSync(model: IChatEndpoint, responsesApiVerbosityEnabled?: boolean): 'low' | 'medium' | 'high' | undefined {
	if (model.family === 'gpt-5.1' || model.family === 'gpt-5-mini' || (isGpt56(model) && responsesApiVerbosityEnabled)) {
		return 'low';
	}
	return undefined;
}

export function modelSupportsToolSearch(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const id = typeof model === 'string' ? model : getModelId(model);
	const family = typeof model === 'string' ? model : model.family;
	const isGpt56Model: boolean = isGpt56(model);
	const matches = (s: string) => {
		const n = s.toLowerCase().replace(/\./g, '-');
		if (n === 'gpt-5-4' || n === 'gpt-5-5' || isGpt56Model) {
			return true;
		}
		if (!n.startsWith('claude')) {
			return false;
		}
		if (n.startsWith('claude-haiku')) {
			return false;
		}
		const isPre45 =
			n.startsWith('claude-1') ||
			n.startsWith('claude-2') ||
			n.startsWith('claude-3') ||
			n.startsWith('claude-instant') ||
			n === 'claude-sonnet-4' || n.startsWith('claude-sonnet-4-2') ||
			n === 'claude-opus-4' || n.startsWith('claude-opus-4-1') || n.startsWith('claude-opus-4-2');
		return !isPre45;
	};
	return matches(id) || matches(family);
}

export function modelSupportsContextEditing(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const id = typeof model === 'string' ? model : getModelId(model);
	const family = typeof model === 'string' ? model : model.family;
	const normalize = (s: string) => s.toLowerCase().replace(/\./g, '-');
	const normalizedId = normalize(id);
	const normalizedFamily = normalize(family);
	if (normalizedId.includes('1m') || normalizedFamily.includes('1m')) {
		return false;
	}
	const matches = (n: string) =>
		n.startsWith('claude-fable-5') ||
		n.startsWith('claude-haiku-4-5') ||
		n.startsWith('claude-sonnet-4-6') ||
		n.startsWith('claude-sonnet-4-5') ||
		n.startsWith('claude-sonnet-4') ||
		n.startsWith('claude-opus-4-8') ||
		n.startsWith('claude-opus-4-7') ||
		n.startsWith('claude-opus-4-6') ||
		n.startsWith('claude-opus-4-5') ||
		n.startsWith('claude-opus-4-1') ||
		n.startsWith('claude-opus-4');
	return matches(normalizedId) || matches(normalizedFamily);
}
