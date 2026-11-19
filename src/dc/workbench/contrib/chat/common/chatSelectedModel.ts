/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ChatContextKeys } from './actions/chatContextKeys.js';
import { DARD_COR_VENDOR_ID, ILanguageModelChatMetadata, ILanguageModelsService } from './languageModels.js';

export const SELECTED_MODEL_STORAGE_KEY_PREFIX = 'chat.currentLanguageModel.';

export const SELECTED_MODEL_STORAGE_SCOPE = StorageScope.PROFILE;
export const SELECTED_MODEL_STORAGE_TARGET = StorageTarget.USER;

export function getSelectedModelStorageKey(location: string, modelTarget?: string): string {
	if (modelTarget) {
		return `${SELECTED_MODEL_STORAGE_KEY_PREFIX}${location}.${modelTarget}`;
	}
	return `${SELECTED_MODEL_STORAGE_KEY_PREFIX}${location}`;
}

export function storeSelectedModel(
	storageService: IStorageService,
	location: string,
	modelTarget: string | undefined,
	identifier: string,
): void {
	storageService.store(getSelectedModelStorageKey(location, modelTarget), identifier, SELECTED_MODEL_STORAGE_SCOPE, SELECTED_MODEL_STORAGE_TARGET);
}

export function getStoredSelectedModel(
	storageService: IStorageService,
	location: string,
	modelTarget?: string,
): string | undefined {
	const key = getSelectedModelStorageKey(location, modelTarget);
	const isDefaultKey = `${key}.isDefault`;
	const identifier = storageService.get(key, SELECTED_MODEL_STORAGE_SCOPE);
	if (identifier) {
		const wasAutomaticDefault = storageService.getBoolean(isDefaultKey, SELECTED_MODEL_STORAGE_SCOPE);
		storageService.remove(isDefaultKey, SELECTED_MODEL_STORAGE_SCOPE);
		if (wasAutomaticDefault) {
			storageService.remove(key, SELECTED_MODEL_STORAGE_SCOPE);
			return undefined;
		}
		return identifier;
	}

	const legacyIdentifier = storageService.get(key, StorageScope.APPLICATION);
	if (!legacyIdentifier) {
		return undefined;
	}

	const wasAutomaticDefault = storageService.getBoolean(isDefaultKey, StorageScope.APPLICATION, true);
	storageService.remove(key, StorageScope.APPLICATION);
	storageService.remove(isDefaultKey, StorageScope.APPLICATION);
	if (wasAutomaticDefault) {
		return undefined;
	}

	storeSelectedModel(storageService, location, modelTarget, legacyIdentifier);
	return legacyIdentifier;
}

export function getSelectedModelIdentifier(
	contextKeyService: IContextKeyService,
	storageService: IStorageService,
): string | undefined {
	const contextKeyModelId = contextKeyService.getContextKeyValue<string>(ChatContextKeys.chatModelId.key);
	if (contextKeyModelId) {
		return contextKeyModelId;
	}

	return getPersistedSelectedModelIdentifier(contextKeyService, storageService);
}

export function getPersistedSelectedModelIdentifier(
	contextKeyService: IContextKeyService,
	storageService: IStorageService,
): string | undefined {
	const location = contextKeyService.getContextKeyValue<string>(ChatContextKeys.location.key) ?? 'panel';
	const sessionType = contextKeyService.getContextKeyValue<string>(ChatContextKeys.chatSessionType.key) ?? '';
	const candidateKeys = sessionType
		? [sessionType, undefined]
		: [undefined];

	for (const modelTarget of candidateKeys) {
		const persisted = getStoredSelectedModel(storageService, location, modelTarget);
		if (persisted) {
			return persisted;
		}
	}

	return undefined;
}

export function getSelectedModelMetadata(
	contextKeyService: IContextKeyService,
	storageService: IStorageService,
	languageModelsService: ILanguageModelsService,
): ILanguageModelChatMetadata | undefined {
	const modelId = getSelectedModelIdentifier(contextKeyService, storageService);
	if (!modelId) {
		return undefined;
	}

	const direct = languageModelsService.lookupLanguageModel(modelId);
	if (direct) {
		return direct;
	}

	const persistedId = getPersistedSelectedModelIdentifier(contextKeyService, storageService);
	if (persistedId && persistedId !== modelId) {
		return languageModelsService.lookupLanguageModel(persistedId);
	}

	return undefined;
}

export function getSelectedModelVendor(
	contextKeyService: IContextKeyService,
	storageService: IStorageService,
	languageModelsService: ILanguageModelsService,
): string | undefined {
	const metadata = getSelectedModelMetadata(contextKeyService, storageService, languageModelsService);
	if (metadata) {
		return metadata.vendor;
	}

	const modelId = getSelectedModelIdentifier(contextKeyService, storageService);
	if (modelId?.includes('/')) {
		return modelId.split('/')[0];
	}

	return undefined;
}

export function isByokModel(metadata: ILanguageModelChatMetadata): boolean {
	return metadata.isBYOK === true || metadata.byokModelIdentifier !== undefined;
}

export function isSelectedModelDardcor(
	contextKeyService: IContextKeyService,
	storageService: IStorageService,
	languageModelsService: ILanguageModelsService,
): boolean {
	const metadata = getSelectedModelMetadata(contextKeyService, storageService, languageModelsService);
	if (metadata) {
		return metadata.vendor === DARD_COR_VENDOR_ID && !isByokModel(metadata);
	}

	const vendor = getSelectedModelVendor(contextKeyService, storageService, languageModelsService);
	if (!vendor) {
		return false;
	}
	return vendor === DARD_COR_VENDOR_ID;
}
