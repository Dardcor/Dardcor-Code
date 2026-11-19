/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../../../../../base/common/collections.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { isDefined } from '../../../../../../../base/common/types.js';
import { localize } from '../../../../../../../nls.js';
import { DARD_COR_VENDOR_ID, ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService, IModelControlEntry } from '../../../../common/languageModels.js';
import { buildModelToProviderGroupMap, getProviderGroupForModel, getProviderGroupKey, isVersionAtLeast } from './modelPickerItemPrimitives.js';
import { isDeprecated } from './modelPickerBadges.js';
import { getProviderIconForIdentity } from './modelProviderIcons.js';
import { isAutoModel } from './modelPickerPresentation.js';

export const MODEL_PICKER_BUILT_IN_DESTINATION = 'builtIn';
const PROVIDER_DESTINATION_PREFIX = 'provider:';

export interface IModelPickerProviderPlaceholder {
	readonly vendor: string;
	readonly label: string;
	readonly message: string;
	readonly action?: { readonly label: string; readonly run: () => void };
}

export interface IModelPickerDestination {
	readonly id: string;
	readonly label: string;
	readonly icon: ThemeIcon;
	readonly models: readonly ILanguageModelChatMetadataAndIdentifier[];
	readonly placeholders: readonly IModelPickerProviderPlaceholder[];
}

export interface IModelPickerUnavailableEntry {
	readonly id: string;
	readonly entry: IModelControlEntry;
	readonly needsUpdate: boolean;
}

export interface IModelPickerSections {
	readonly pinned: readonly ILanguageModelChatMetadataAndIdentifier[];
	readonly suggested: readonly ILanguageModelChatMetadataAndIdentifier[];
	readonly other: readonly ILanguageModelChatMetadataAndIdentifier[];
	readonly unavailable: readonly IModelPickerUnavailableEntry[];
}

const BUILT_IN_GROUP_IDS: ReadonlySet<string> = new Set([DARD_COR_VENDOR_ID, 'copilotcli']);

export function isUserProvidedModel(
	model: ILanguageModelChatMetadataAndIdentifier,
	languageModelsService: ILanguageModelsService,
): boolean {
	const groupId = model.metadata.modelGroup?.id ?? model.metadata.vendor;
	if (BUILT_IN_GROUP_IDS.has(groupId)) {
		return false;
	}
	return groupId !== languageModelsService.getVendors().find(vendor => vendor.isDefault)?.vendor;
}

export function getModelProviderLabel(
	model: ILanguageModelChatMetadataAndIdentifier,
	languageModelsService: ILanguageModelsService,
	modelToGroup = buildModelToProviderGroupMap(languageModelsService),
): string {
	return getProviderGroupForModel(model, modelToGroup, languageModelsService).groupName;
}

export function buildModelPickerDestinations(
	models: readonly ILanguageModelChatMetadataAndIdentifier[],
	languageModelsService: ILanguageModelsService,
	placeholders: readonly IModelPickerProviderPlaceholder[] = [],
): IModelPickerDestination[] {
	const builtInModels: ILanguageModelChatMetadataAndIdentifier[] = [];
	const userModels: ILanguageModelChatMetadataAndIdentifier[] = [];
	for (const model of models) {
		if (isAutoModel(model)) {
			continue;
		}
		(isUserProvidedModel(model, languageModelsService) ? userModels : builtInModels).push(model);
	}

	const builtInVendor = languageModelsService.getVendors().find(vendor => vendor.isDefault);
	const builtInVendorId = builtInVendor?.vendor ?? DARD_COR_VENDOR_ID;
	const builtInLabel = builtInVendor?.displayName ?? localize('chat.modelPicker.builtInProvider', "Dardcor Router");
	const builtInPlaceholders = placeholders.filter(placeholder => placeholder.vendor === builtInVendorId);
	const userPlaceholders = placeholders.filter(placeholder => placeholder.vendor !== builtInVendorId);

	const hasAutoModel = models.some(isAutoModel);
	const destinations: IModelPickerDestination[] = [];
	if (builtInModels.length || builtInPlaceholders.length || hasAutoModel) {
		destinations.push({
			id: MODEL_PICKER_BUILT_IN_DESTINATION,
			label: builtInLabel,
			icon: getProviderIconForIdentity(`${builtInLabel} ${builtInVendorId}`),
			models: builtInModels,
			placeholders: builtInPlaceholders,
		});
	}

	const modelToGroup = buildModelToProviderGroupMap(languageModelsService);
	const byProvider = new Map<string, { label: string; models: ILanguageModelChatMetadataAndIdentifier[]; placeholders: IModelPickerProviderPlaceholder[] }>();
	const providerEntry = (key: string, label: string) => {
		let entry = byProvider.get(key);
		if (!entry) {
			entry = { label, models: [], placeholders: [] };
			byProvider.set(key, entry);
		}
		return entry;
	};
	for (const model of userModels) {
		const { vendor, groupName } = getProviderGroupForModel(model, modelToGroup, languageModelsService);
		providerEntry(getProviderGroupKey(vendor, groupName), groupName).models.push(model);
	}
	for (const placeholder of userPlaceholders) {
		providerEntry(getProviderGroupKey(placeholder.vendor, placeholder.label), placeholder.label).placeholders.push(placeholder);
	}
	const sortedProviders = [...byProvider].sort(([leftKey, left], [rightKey, right]) =>
		left.label.localeCompare(right.label) || leftKey.localeCompare(rightKey));
	for (const [key, entry] of sortedProviders) {
		destinations.push({
			id: `${PROVIDER_DESTINATION_PREFIX}${key}`,
			label: entry.label,
			icon: getProviderIconForIdentity(entry.label),
			models: entry.models,
			placeholders: entry.placeholders,
		});
	}
	return destinations;
}

export interface IModelPickerSectionsOptions {
	readonly models: readonly ILanguageModelChatMetadataAndIdentifier[];
	readonly selectedModelId: string | undefined;
	readonly recentModelIds: readonly string[];
	readonly pinnedModelIds: readonly string[];
	readonly controlModels: IStringDictionary<IModelControlEntry>;
	readonly showSuggested: boolean;
	readonly showUnavailable?: boolean;
	readonly currentVSCodeVersion?: string;
}

export function buildModelPickerSections(options: IModelPickerSectionsOptions): IModelPickerSections {
	const unavailable = buildUnavailableEntries(options);
	const gated = new Set(unavailable.filter(entry => entry.needsUpdate).map(entry => entry.id));
	const selectable = gated.size === 0
		? options.models
		: options.models.filter(model => !gated.has(model.metadata.id) && !gated.has(model.identifier));

	const byIdentifier = new Map(selectable.map(model => [model.identifier, model]));
	const byMetadataId = new Map(selectable.map(model => [model.metadata.id, model]));
	const placed = new Set<string>();
	const take = (id: string | undefined): ILanguageModelChatMetadataAndIdentifier | undefined => {
		const model = id ? byIdentifier.get(id) ?? byMetadataId.get(id) : undefined;
		if (!model || placed.has(model.identifier)) {
			return undefined;
		}
		placed.add(model.identifier);
		return model;
	};

	const pinned = options.pinnedModelIds.map(take).filter(isDefined);

	const suggested: ILanguageModelChatMetadataAndIdentifier[] = [];

	const byName = (left: ILanguageModelChatMetadataAndIdentifier, right: ILanguageModelChatMetadataAndIdentifier) =>
		left.metadata.name.localeCompare(right.metadata.name);
	const byPromoThenName = (left: ILanguageModelChatMetadataAndIdentifier, right: ILanguageModelChatMetadataAndIdentifier) =>
		(hasPromo(right) ? 1 : 0) - (hasPromo(left) ? 1 : 0) || byName(left, right);
	const byRetiringThenName = (left: ILanguageModelChatMetadataAndIdentifier, right: ILanguageModelChatMetadataAndIdentifier) =>
		(isDeprecated(left) ? 1 : 0) - (isDeprecated(right) ? 1 : 0) || byName(left, right);
	const rest = selectable.filter(model => !placed.has(model.identifier)).sort(byRetiringThenName);

	return {
		pinned: pinned.sort(byName),
		suggested: suggested.sort(byPromoThenName),
		other: rest,
		unavailable,
	};
}

function hasPromo(model: ILanguageModelChatMetadataAndIdentifier): boolean {
	return ILanguageModelChatMetadata.hasPromoDiscount(model.metadata);
}

function buildUnavailableEntries(options: IModelPickerSectionsOptions): IModelPickerUnavailableEntry[] {
	if (!options.showUnavailable) {
		return [];
	}
	const present = new Set(options.models.flatMap(model => [model.identifier, model.metadata.id]));
	const entries: IModelPickerUnavailableEntry[] = [];
	for (const [id, entry] of Object.entries(options.controlModels)) {
		if (!entry.featured) {
			continue;
		}
		const outOfDate = isOutOfDate(entry, options.currentVSCodeVersion);
		if (present.has(id) ? outOfDate : !entry.exists) {
			entries.push({ id, entry, needsUpdate: outOfDate });
		}
	}
	return entries.sort((left, right) => left.entry.label.localeCompare(right.entry.label));
}

function isOutOfDate(entry: IModelControlEntry, currentVSCodeVersion: string | undefined): boolean {
	return !!entry.minVSCodeVersion && !!currentVSCodeVersion && !isVersionAtLeast(currentVSCodeVersion, entry.minVSCodeVersion);
}

export function hasPromotedModels(sections: IModelPickerSections): boolean {
	return sections.suggested.length > 0;
}
