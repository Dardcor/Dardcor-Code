/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatAgentLocation, ChatModeKind } from '../../../common/constants.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, isLanguageModelVendorAbsenceConclusive } from '../../../common/languageModels.js';
import { URI } from '../../../../../../base/common/uri.js';
import { isAgentHostTarget, localChatSessionType } from '../../../common/chatSessionsService.js';
import { isByokModel } from '../../../common/chatSelectedModel.js';
import { getChatSessionType, isUntitledChatSession } from '../../../common/model/chatUri.js';

export type IsModelSupportedHere = (model: ILanguageModelChatMetadataAndIdentifier) => boolean;

function isOwnModel(model: ILanguageModelChatMetadataAndIdentifier): boolean {
	return model.metadata.byokModelIdentifier === undefined;
}

export function filterModelsForSession(
	models: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
	currentModeKind: ChatModeKind,
	location: ChatAgentLocation,
): ILanguageModelChatMetadataAndIdentifier[] {
	if (sessionType && sessionType !== 'local' && hasModelsTargetingSession(models, sessionType)) {
		return models.filter(entry =>
			entry.metadata?.targetChatSessionType === sessionType &&
			entry.metadata?.isUserSelectable !== false
		);
	}

	return models.filter(entry =>
		!entry.metadata?.targetChatSessionType &&
		entry.metadata?.isUserSelectable !== false &&
		isModelSupportedForMode(entry, currentModeKind) &&
		isModelSupportedForInlineChat(entry, location)
	);
}

export function isModelSupportedForMode(
	model: ILanguageModelChatMetadataAndIdentifier,
	currentModeKind: ChatModeKind,
): boolean {
	if (currentModeKind === ChatModeKind.Agent) {
		return ILanguageModelChatMetadata.suitableForAgentMode(model.metadata);
	}
	return true;
}

export function isModelSupportedForInlineChat(
	model: ILanguageModelChatMetadataAndIdentifier,
	location: ChatAgentLocation,
): boolean {
	if (location !== ChatAgentLocation.EditorInline) {
		return true;
	}
	return !!model.metadata.capabilities?.toolCalling;
}

export function hasModelsTargetingSession(
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
): boolean {
	if (!sessionType) {
		return false;
	}
	return allModels.some(m => m.metadata.targetChatSessionType === sessionType);
}

export function isModelValidForSession(
	model: ILanguageModelChatMetadataAndIdentifier,
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
): boolean {
	if (hasModelsTargetingSession(allModels, sessionType)) {
		return model.metadata.targetChatSessionType === sessionType;
	}
	return !model.metadata.targetChatSessionType;
}

/**
 * Reconstructs the "Manage Models" identifier that an agent-host copy of an
 * extension-provided BYOK model is toggled under, or `undefined` when the model
 * is not such a copy. Re-exported from the shared `ILanguageModelChatMetadata`
 * namespace (which also backs the `common` model-visibility layer) so picker and
 * management code reconstruct the identifier the same way.
 */
export const getAgentHostByokManageModelsIdentifier = ILanguageModelChatMetadata.getAgentHostByokManageModelsIdentifier;

export function isModelHiddenInPicker(
	model: ILanguageModelChatMetadataAndIdentifier,
	isModelHidden: (identifier: string) => boolean,
): boolean {
	if (isModelHidden(model.identifier)) {
		return true;
	}
	const manageModelsIdentifier = getAgentHostByokManageModelsIdentifier(model.metadata);
	return manageModelsIdentifier !== undefined && isModelHidden(manageModelsIdentifier);
}

export function shouldDropAgnosticDraftModel(
	draftModel: ILanguageModelChatMetadataAndIdentifier | undefined,
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
): boolean {
	return !!draftModel && !isModelValidForSession(draftModel, allModels, sessionType);
}

export function isNewConversation(sessionResource: URI, hasNoRequests: boolean): boolean {
	return hasNoRequests
		&& (getChatSessionType(sessionResource) === localChatSessionType || isUntitledChatSession(sessionResource));
}

export function isSessionStarted(hasBoundModel: boolean, hasRequests: boolean): boolean {
	return !hasBoundModel || hasRequests;
}

export function shouldRestorePerTypeModelOnSessionSwitch(isEmpty: boolean, sessionOwnsPool: boolean, hadIncomingModel: boolean): boolean {
	return isEmpty && sessionOwnsPool && !hadIncomingModel;
}

function isSameBillingIdentity(
	a: ILanguageModelChatMetadataAndIdentifier,
	b: ILanguageModelChatMetadataAndIdentifier,
): boolean {
	if (isByokModel(a.metadata) !== isByokModel(b.metadata)) {
		return false;
	}
	if (!isByokModel(a.metadata)) {
		return true;
	}
	return (a.metadata.byokModelIdentifier ?? a.identifier) === (b.metadata.byokModelIdentifier ?? b.identifier);
}

export function findBestMatchingModel(
	previous: ILanguageModelChatMetadataAndIdentifier | undefined,
	pool: readonly ILanguageModelChatMetadataAndIdentifier[],
): ILanguageModelChatMetadataAndIdentifier | undefined {
	if (!previous || pool.length === 0) {
		return undefined;
	}
	const candidates = pool.filter(m => isSameBillingIdentity(previous, m));
	if (candidates.length === 0) {
		return undefined;
	}
	const id = previous.metadata.id?.trim().toLowerCase();
	const family = previous.metadata.family?.trim().toLowerCase();
	const name = previous.metadata.name?.trim().toLowerCase();
	return (id ? candidates.find(m => m.metadata.id?.trim().toLowerCase() === id) : undefined)
		?? (family ? candidates.find(m => m.metadata.family?.trim().toLowerCase() === family) : undefined)
		?? (name ? candidates.find(m => m.metadata.name?.trim().toLowerCase() === name) : undefined);
}

export function shouldResetModelToDefault(
	currentModel: ILanguageModelChatMetadataAndIdentifier | undefined,
	availableModels: ILanguageModelChatMetadataAndIdentifier[],
	isModelSupportedHere: IsModelSupportedHere,
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
): boolean {
	if (!currentModel) {
		return false;
	}

	if (!availableModels.some(m => m.identifier === currentModel.identifier)) {
		return true;
	}

	if (!isModelSupportedHere(currentModel)) {
		return true;
	}

	if (!isModelValidForSession(currentModel, allModels, sessionType)) {
		return true;
	}

	return false;
}

export function resolveModelFromSyncState(
	stateModel: ILanguageModelChatMetadataAndIdentifier,
	currentModel: ILanguageModelChatMetadataAndIdentifier | undefined,
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
	isModelSupportedHere?: IsModelSupportedHere,
): { action: 'keep' | 'apply' | 'default' } {
	if (!isModelValidForSession(stateModel, allModels, sessionType)) {
		return { action: 'default' };
	}

	if (currentModel && currentModel.identifier === stateModel.identifier) {
		return { action: 'keep' };
	}

	if (isModelSupportedHere && !isModelSupportedHere(stateModel)) {
		return { action: 'default' };
	}

	return { action: 'apply' };
}

export function mergeModelsWithCache(
	liveModels: ILanguageModelChatMetadataAndIdentifier[],
	cachedModels: ILanguageModelChatMetadataAndIdentifier[],
	contributedVendors: Set<string>,
	resolvedVendors?: ReadonlySet<string>,
): ILanguageModelChatMetadataAndIdentifier[] {
	if (contributedVendors.size === 0 && liveModels.length === 0) {
		return cachedModels;
	}
	const liveVendors = new Set(liveModels.map(m => m.metadata.vendor));
	const ownLiveVendors = new Set(liveModels.filter(m => isOwnModel(m)).map(m => m.metadata.vendor));
	const usableCached = cachedModels.filter(m => {
		const vendor = m.metadata.vendor;
		if (!contributedVendors.has(vendor) || ownLiveVendors.has(vendor)) {
			return false;
		}
		if (liveVendors.has(vendor) && isAgentHostTarget(vendor)) {
			return isOwnModel(m);
		}
		if (isLanguageModelVendorAbsenceConclusive(vendor, liveVendors.has(vendor), resolvedVendors?.has(vendor) ?? false)) {
			return false;
		}
		return true;
	});
	return [...liveModels, ...usableCached];
}

export function shouldResetOnModelListChange(
	currentModelId: string | undefined,
	availableModels: ILanguageModelChatMetadataAndIdentifier[],
): boolean {
	if (!currentModelId) {
		return true;
	}
	return !availableModels.some(m => m.identifier === currentModelId);
}


export function resolveEditedRequestSelection<T>(edited: T | undefined, composer: T): T {
	return edited ?? composer;
}
