/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ILanguageModelChatMetadata, ILanguageModelsService } from '../common/languageModels.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

export interface DefaultModelArrays {
	readonly modelIds: string[];
	readonly modelLabels: string[];
	readonly modelDescriptions: string[];
}

export interface DefaultModelContributionOptions {
	readonly configKey: string;
	readonly configSectionId: string | undefined;
	readonly logPrefix: string;
	readonly filter?: (metadata: ILanguageModelChatMetadata) => boolean;
	readonly storageFormat?: 'qualifiedName' | 'vendorAndId';
	readonly defaultEntryLabel?: string;
	readonly defaultEntryDescription?: string;
}

export function createDefaultModelArrays(defaultEntryLabel?: string, defaultEntryDescription?: string): DefaultModelArrays {
	return {
		modelIds: [''],
		modelLabels: [defaultEntryLabel ?? localize('defaultModel', 'Auto (Vendor Default)')],
		modelDescriptions: [defaultEntryDescription ?? localize('defaultModelDescription', "Use the vendor's default model")],
	};
}

export abstract class DefaultModelContribution extends Disposable {

	constructor(
		private readonly _arrays: DefaultModelArrays,
		private readonly _options: DefaultModelContributionOptions,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(_languageModelsService.onDidChangeLanguageModels(() => this._updateModelValues()));
		this._updateModelValues();
	}

	private _updateModelValues(): void {
		const { modelIds, modelLabels, modelDescriptions } = this._arrays;
		const { configKey, configSectionId, logPrefix, filter, storageFormat, defaultEntryLabel, defaultEntryDescription } = this._options;

		try {
			modelIds.length = 0;
			modelLabels.length = 0;
			modelDescriptions.length = 0;

			modelIds.push('');
			modelLabels.push(defaultEntryLabel ?? localize('defaultModel', 'Auto (Vendor Default)'));
			modelDescriptions.push(defaultEntryDescription ?? localize('defaultModelDescription', "Use the vendor's default model"));

			const models: { identifier: string; metadata: ILanguageModelChatMetadata }[] = [];
			const allModelIds = this._languageModelsService.getLanguageModelIds();

			for (const modelId of allModelIds) {
				try {
					const metadata = this._languageModelsService.lookupLanguageModel(modelId);
					if (metadata) {
						models.push({ identifier: modelId, metadata });
					} else {
						this._logService.warn(`${logPrefix} No metadata found for model ID: ${modelId}`);
					}
				} catch (e) {
					this._logService.error(`${logPrefix} Error looking up model ${modelId}:`, e);
				}
			}

			const vendors = this._languageModelsService.getVendors();
			const visibleVendors = new Set(vendors.map(vendor => vendor.vendor));
			const supportedModels = models.filter(model => {
				if (!visibleVendors.has(model.metadata.vendor)) {
					return false;
				}
				if (model.metadata?.isUserSelectable === false) {
					return false;
				}
				if (model.metadata?.targetChatSessionType !== undefined) {
					return false;
				}
				if (filter && !filter(model.metadata)) {
					return false;
				}
				return true;
			});

			supportedModels.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

			const vendorDisplayNames = new Map<string, string>();
			for (const vendor of vendors) {
				vendorDisplayNames.set(vendor.vendor, vendor.displayName);
			}

			const ambiguousVendorIds = new Set<string>();
			if (storageFormat === 'vendorAndId') {
				const counts = new Map<string, number>();
				for (const model of models) {
					const key = `${model.metadata.vendor}/${model.metadata.id}`;
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
				for (const [key, count] of counts) {
					if (count > 1) {
						ambiguousVendorIds.add(key);
					}
				}
			}

			for (const model of supportedModels) {
				try {
					const storedId = storageFormat === 'vendorAndId'
						? `${model.metadata.vendor}/${model.metadata.id}`
						: ILanguageModelChatMetadata.asQualifiedName(model.metadata);
					if (ambiguousVendorIds.has(storedId)) {
						this._logService.trace(`${logPrefix} Skipping model '${model.metadata.name}' (${storedId}): key collides with another registered model.`);
						continue;
					}
					const vendorDisplayName = vendorDisplayNames.get(model.metadata.vendor);
					if (!vendorDisplayName) {
						this._logService.trace(`${logPrefix} No vendor descriptor for '${model.metadata.vendor}' (model '${model.metadata.id}'); falling back to vendor id in label.`);
					}
					modelIds.push(storedId);
					modelLabels.push(localize('modelLabelWithVendor', "{0} ({1})", model.metadata.name, vendorDisplayName ?? model.metadata.vendor));
					modelDescriptions.push(model.metadata.tooltip ?? model.metadata.detail ?? '');
				} catch (e) {
					this._logService.error(`${logPrefix} Error adding model ${model.metadata.name}:`, e);
				}
			}

			if (configSectionId) {
				configurationRegistry.notifyConfigurationSchemaUpdated({
					id: configSectionId,
					properties: {
						[configKey]: {}
					}
				});
			}
		} catch (e) {
			this._logService.error(`${logPrefix} Error updating model values:`, e);
		}
	}
}
