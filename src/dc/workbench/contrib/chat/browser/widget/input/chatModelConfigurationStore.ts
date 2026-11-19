/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../../../../../base/common/actions.js';
import { IStringDictionary } from '../../../../../../base/common/collections.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { equals } from '../../../../../../base/common/objects.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { createModelConfigurationActions, ILanguageModelsService } from '../../../common/languageModels.js';
import { computeStoredConfiguration, extractSchemaDefaults, filterConfigurationToSchema, resolveModelConfiguration } from './chatModelConfigurationLogic.js';
import { IModelConfigurationAccess } from './modelPicker/modelPickerModelConfig.js';

export class ChatModelConfigurationStore extends Disposable implements IModelConfigurationAccess {

	private readonly _overrides = new Map<string, IStringDictionary<unknown>>();

	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor(
		private readonly getStorageKey: () => string,
		private readonly languageModelsService: ILanguageModelsService,
		private readonly storageService: IStorageService,
	) {
		super();



		this._register(this.languageModelsService.onDidChangeLanguageModels(() => {
			if (this._overrides.size === 0) {
				return;
			}
			const bucket = this._readBucket();
			for (const [modelId, override] of [...this._overrides]) {
				const schemaDefaults = this._schemaDefaults(modelId);
				const nextOverride = Object.keys(override).length === 0
					? resolveModelConfiguration(bucket[modelId], schemaDefaults, this.languageModelsService.getModelConfiguration(modelId))
					: { ...schemaDefaults, ...override };
				if (!equals(override, nextOverride)) {
					this._overrides.set(modelId, nextOverride);
					this._onDidChange.fire(modelId);
				}
			}
		}));
	}











	getModelConfiguration(modelId: string): IStringDictionary<unknown> | undefined {
		let override = this._overrides.get(modelId);
		if (!override) {
			const bucketEntry = this._readBucket()[modelId];
			const schemaDefaults = this._schemaDefaults(modelId);
			const globalConfig = this.languageModelsService.getModelConfiguration(modelId);
			override = resolveModelConfiguration(bucketEntry, schemaDefaults, globalConfig);
			this._overrides.set(modelId, override);
		}
		return Object.keys(override).length > 0 ? override : undefined;
	}

	async setModelConfiguration(modelId: string, values: IStringDictionary<unknown>): Promise<void> {
		const changed = this._applyLocalModelConfiguration(modelId, values);
		if (!changed) {

			return;
		}




		await this.languageModelsService.setModelConfiguration(modelId, values);
	}






	private _applyLocalModelConfiguration(modelId: string, values: IStringDictionary<unknown>): boolean {
		const schemaDefaults = this._schemaDefaults(modelId);
		const stored = computeStoredConfiguration(this.getModelConfiguration(modelId) ?? {}, values, schemaDefaults);
		const nextOverride = { ...schemaDefaults, ...stored };

		const bucket = this._readBucket();
		if (equals(this._overrides.get(modelId), nextOverride) && equals(bucket[modelId], stored)) {
			return false;
		}

		this._overrides.set(modelId, nextOverride);


		bucket[modelId] = stored;
		this._writeBucket(bucket);

		this._onDidChange.fire(modelId);
		return true;
	}

	getModelConfigurationActions(modelId: string): IAction[] {
		return createModelConfigurationActions(
			this.languageModelsService.lookupLanguageModel(modelId)?.configurationSchema,
			this.getModelConfiguration(modelId) ?? {},
			(key, value) => this.setModelConfiguration(modelId, { [key]: value }),
		);
	}

	restoreModelConfiguration(modelId: string, values: IStringDictionary<unknown>): void {
		const metadata = this.languageModelsService.lookupLanguageModel(modelId);
		const filtered = metadata
			? filterConfigurationToSchema(values, metadata.configurationSchema)
			: { ...values };

		this._applyLocalModelConfiguration(modelId, filtered);
	}

	clear(): void {
		this._overrides.clear();
	}

	private _schemaDefaults(modelId: string): IStringDictionary<unknown> {
		return extractSchemaDefaults(this.languageModelsService.lookupLanguageModel(modelId)?.configurationSchema);
	}

	private _readBucket(): { [modelId: string]: IStringDictionary<unknown> } {
		const result: { [modelId: string]: IStringDictionary<unknown> } = Object.create(null);
		const raw = this.storageService.get(this.getStorageKey(), StorageScope.APPLICATION);
		if (!raw) {
			return result;
		}
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				for (const [modelId, entry] of Object.entries(parsed)) {
					if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
						result[modelId] = entry as IStringDictionary<unknown>;
					}
				}
			}
		} catch {
		}
		return result;
	}

	private _writeBucket(bucket: { [modelId: string]: IStringDictionary<unknown> }): void {
		const key = this.getStorageKey();
		if (Object.keys(bucket).length === 0) {
			this.storageService.remove(key, StorageScope.APPLICATION);
		} else {
			this.storageService.store(key, JSON.stringify(bucket), StorageScope.APPLICATION, StorageTarget.USER);
		}
	}
}
