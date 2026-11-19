/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { TaskQueue } from '../../../util/common/async';
import { ErrorUtils } from '../../../util/common/errors';
import { softAssert } from '../../../util/dardcor/base/common/assert';
import { Emitter, Event } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { derived, IObservable, observableFromEvent } from '../../../util/dardcor/base/common/observable';
import { ConfigKey, ExperimentBasedConfig, IConfigurationService } from '../../configuration/common/configurationService';
import { IEndpointProvider } from '../../endpoint/common/endpointProvider';
import { IVSCodeExtensionContext } from '../../extContext/common/extensionContext';
import { ILogger, ILogService } from '../../log/common/logService';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { MODEL_CONFIGURATION_VALIDATOR, ModelConfiguration, PromptingStrategy } from '../common/dataTypes/xtabPromptOptions';
import { IInlineEditsModelService, IUndesiredModelsManager } from '../common/inlineEditsModelService';

const enum ModelSource {
	LocalConfig = 'localConfig',
	ExpConfig = 'expConfig',
	ExpDefaultConfig = 'expDefaultConfig',
	RouterCatalog = 'routerCatalog',
	HardCodedDefault = 'hardCodedDefault',
}

interface ModelConfigurationWithSource extends ModelConfiguration {
	source: ModelSource;
}

type ModelInfo = {
	models: ModelConfigurationWithSource[];
	currentModelId: string;
};

export class InlineEditsModelService extends Disposable implements IInlineEditsModelService {

	_serviceBrand: undefined;

	private static readonly DARDCOR_ROUTER_INLINE_MODEL: ModelConfigurationWithSource = {
		modelName: 'dardcor-utility-small',
		promptingStrategy: PromptingStrategy.Xtab275,
		includeTagsInCurrentFile: false,
		source: ModelSource.HardCodedDefault,
		lintOptions: undefined,
	};

	private _preferredModelNameObs = this._configService.getExperimentBasedConfigObservable(ConfigKey.Advanced.InlineEditsPreferredModel, this._expService);
	private _localModelConfigObs = this._configService.getConfigObservable(ConfigKey.Advanced.InlineEditsXtabProviderModelConfiguration);
	private _expBasedModelConfigObs = this._configService.getExperimentBasedConfigObservable(ConfigKey.TeamInternal.InlineEditsXtabProviderModelConfigurationString, this._expService);
	private _defaultModelConfigObs = this._configService.getExperimentBasedConfigObservable(ConfigKey.TeamInternal.InlineEditsXtabProviderDefaultModelConfigurationString, this._expService);
	private readonly _onRouterModelsChanged = this._register(new Emitter<void>());
	private _routerModels: ModelConfigurationWithSource[] = [];
	private _routerCatalogGeneration = 0;
	private _routerModelsObs = observableFromEvent(this, this._onRouterModelsChanged.event, () => this._routerModels);
	private _undesiredModelsObs = observableFromEvent(this, this._undesiredModelsManager.onDidChange, () => this._undesiredModelsManager);

	private _modelsObs: IObservable<ModelConfigurationWithSource[]>;
	private _currentModelObs: IObservable<ModelConfigurationWithSource>;
	private _modelInfoObs: IObservable<ModelInfo>;

	public readonly onModelListUpdated: Event<void>;

	private readonly _setModelQueue = new TaskQueue();
	private _logger: ILogger;

	constructor(
		@IUndesiredModelsManager private readonly _undesiredModelsManager: IUndesiredModelsManager,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IExperimentationService private readonly _expService: IExperimentationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
	) {
		super();

		this._logger = _logService.createSubLogger(['NES', 'ModelsService']);

		const logger = this._logger.createSubLogger('constructor');
		this._register(this._endpointProvider.onDidModelsRefresh(() => this.refreshRouterModels()));
		this.refreshRouterModels();

		this._modelsObs = derived((reader) => {
			logger.trace('computing models');
			return this.aggregateModels({
				localModelConfig: this._localModelConfigObs.read(reader),
				modelConfigString: this._expBasedModelConfigObs.read(reader),
				defaultModelConfigString: this._defaultModelConfigObs.read(reader),
				routerModels: this._routerModelsObs.read(reader),
			});
		}).recomputeInitiallyAndOnChange(this._store);

		this._currentModelObs = derived<ModelConfigurationWithSource, void>((reader) => {
			logger.trace('computing current model');
			const undesiredModelsManager = this._undesiredModelsObs.read(reader);
			return this._pickModel({
				preferredModelName: this._preferredModelNameObs.read(reader),
				models: this._modelsObs.read(reader),
				undesiredModelsManager,
			});
		}).recomputeInitiallyAndOnChange(this._store);

		this._modelInfoObs = derived((reader) => {
			logger.trace('computing model info');
			return {
				models: this._modelsObs.read(reader),
				currentModelId: this._currentModelObs.read(reader).modelName,
			};
		}).recomputeInitiallyAndOnChange(this._store);

		this.onModelListUpdated = Event.fromObservableLight(this._modelInfoObs);
	}

	get modelInfo(): vscode.InlineCompletionModelInfo | undefined {
		const models: vscode.InlineCompletionModel[] = this._modelsObs.get().map(m => ({
			id: m.modelName,
			name: m.modelName,
		}));

		const currentModel = this._currentModelObs.get();

		return {
			models,
			currentModelId: currentModel.modelName,
		};
	}


	setCurrentModelId(newPreferredModelId: string): Promise<void> {
		return this._setModelQueue.schedule(() => this._setCurrentModelIdCore(newPreferredModelId));
	}

	private async _setCurrentModelIdCore(newPreferredModelId: string): Promise<void> {
		const currentPreferredModelId = this._configService.getExperimentBasedConfig(ConfigKey.Advanced.InlineEditsPreferredModel, this._expService);

		const isSameModel = currentPreferredModelId === newPreferredModelId;
		if (isSameModel) {
			return;
		}

		const currentPreferredModel = this._currentModelObs.get();

		const models = this._modelsObs.get();
		const newPreferredModel = models.find(m => m.modelName === newPreferredModelId);

		if (newPreferredModel === undefined) {
			this._logService.error(`New preferred model id ${newPreferredModelId} not found in model list.`);
			return;
		}

		if (currentPreferredModel.source === ModelSource.ExpConfig) {
			await this._undesiredModelsManager.addUndesiredModelId(currentPreferredModel.modelName);
		}

		if (this._undesiredModelsManager.isUndesiredModelId(newPreferredModelId)) {
			await this._undesiredModelsManager.removeUndesiredModelId(newPreferredModelId);
		}

		const expectedDefaultModel = this._pickModel({ preferredModelName: 'none', models, undesiredModelsManager: this._undesiredModelsManager });
		if (newPreferredModel.source === ModelSource.ExpConfig ||
			(newPreferredModelId === expectedDefaultModel.modelName && !models.some(m => m.source === ModelSource.ExpConfig))
		) {
			this._logger.trace(`New preferred model id ${newPreferredModelId} is the same as the default model, resetting user setting.`);
			await this._configService.setConfig(ConfigKey.Advanced.InlineEditsPreferredModel, 'none');
		} else {
			this._logger.trace(`New preferred model id ${newPreferredModelId} is different from the default model, updating user setting to ${newPreferredModelId}.`);
			await this._configService.setConfig(ConfigKey.Advanced.InlineEditsPreferredModel, newPreferredModelId);
		}
	}

	private aggregateModels(
		{
			localModelConfig,
			modelConfigString,
			defaultModelConfigString,
			routerModels,
		}: {
			localModelConfig: ModelConfiguration | null;
			modelConfigString: string | undefined;
			defaultModelConfigString: string | undefined;
			routerModels: ModelConfigurationWithSource[];
		},
	): ModelConfigurationWithSource[] {
		const logger = this._logger.createSubLogger('aggregateModels');

		const models: ModelConfigurationWithSource[] = [];


		if (localModelConfig) {
			if (models.some(m => m.modelName === localModelConfig.modelName)) {
				logger.trace('Local model configuration already exists in the model list, skipping.');
			} else {
				logger.trace(`Adding local model configuration: ${localModelConfig.modelName}`);
				models.push({ ...localModelConfig, source: ModelSource.LocalConfig });
			}
		}

		if (modelConfigString) {
			logger.trace('Parsing modelConfigurationString...');
			const parsedConfig = this.parseModelConfigString(modelConfigString, ConfigKey.TeamInternal.InlineEditsXtabProviderModelConfigurationString);
			if (parsedConfig && !models.some(m => m.modelName === parsedConfig.modelName)) {
				logger.trace(`Adding model from modelConfigurationString: ${parsedConfig.modelName}`);
				models.push({ ...parsedConfig, source: ModelSource.ExpConfig });
			} else {
				logger.trace('No valid model found in modelConfigurationString.');
			}
		}

		const defaultModel = this.determineDefaultModel(defaultModelConfigString);
		if (models.some(m => m.modelName === defaultModel.modelName)) {
			logger.trace('Default model configuration already exists in the model list, skipping.');
		} else {
			logger.trace(`Adding default Dardcor Router model: ${defaultModel.modelName}`);
			models.push(defaultModel);
		}

		for (const routerModel of routerModels) {
			if (!models.some(model => model.modelName === routerModel.modelName)) {
				models.push(routerModel);
			}
		}

		return models;
	}

	private refreshRouterModels(): void {
		const generation = ++this._routerCatalogGeneration;
		void this._endpointProvider.getAllChatEndpoints().then(endpoints => {
			if (generation !== this._routerCatalogGeneration) {
				return;
			}

			const seenModels = new Set<string>();
			this._routerModels = endpoints.flatMap(endpoint => {
				const modelName = endpoint.family || endpoint.model;
				if (!modelName || seenModels.has(modelName)) {
					return [];
				}
				seenModels.add(modelName);
				return [{
					modelName,
					promptingStrategy: PromptingStrategy.Xtab275,
					includeTagsInCurrentFile: false,
					source: ModelSource.RouterCatalog,
					lintOptions: undefined,
				}];
			});
			this._onRouterModelsChanged.fire();
		}).catch(error => {
			if (generation === this._routerCatalogGeneration) {
				this._logger.warn(`Unable to refresh inline edit models from Dardcor Router: ${ErrorUtils.toString(ErrorUtils.fromUnknown(error))}`);
			}
		});
	}

	public selectedModelConfiguration(): ModelConfiguration {
		return toModelConfiguration(this._currentModelObs.get());
	}

	public defaultModelConfiguration(): ModelConfiguration {
		return toModelConfiguration(this.determineDefaultModel(this._defaultModelConfigObs.get()));
	}

	private determineDefaultModel(defaultModelConfigString: string | undefined): ModelConfigurationWithSource {
		if (defaultModelConfigString) {
			const parsedConfig = this.parseModelConfigString(defaultModelConfigString, ConfigKey.TeamInternal.InlineEditsXtabProviderDefaultModelConfigurationString);
			if (parsedConfig) {
				return { ...parsedConfig, source: ModelSource.ExpDefaultConfig };
			}
		}

		return InlineEditsModelService.DARDCOR_ROUTER_INLINE_MODEL;
	}

	private _pickModel({
		preferredModelName,
		models,
		undesiredModelsManager,
	}: {
		preferredModelName: string;
		models: ModelConfigurationWithSource[];
		undesiredModelsManager: IUndesiredModelsManager;
	}): ModelConfigurationWithSource {

		const expConfiguredModel = models.find(m => m.source === ModelSource.ExpConfig);
		if (expConfiguredModel) {
			const isUndesiredModelId = undesiredModelsManager.isUndesiredModelId(expConfiguredModel.modelName);
			if (isUndesiredModelId) {
				this._logger.trace(`Exp-configured model ${expConfiguredModel.modelName} is marked as undesired by the user. Skipping.`);
			} else {
				return expConfiguredModel;
			}
		}

		const userHasPreferredModel = preferredModelName !== 'none';

		if (userHasPreferredModel) {
			const preferredModel = models.find(m => m.modelName === preferredModelName);
			if (preferredModel) {
				return preferredModel;
			}
		}

		softAssert(models.length > 0, 'InlineEdits model list should have at least one model');

		const model = models.at(0);
		if (model) {
			return model;
		}

		return this.determineDefaultModel(this._defaultModelConfigObs.get());
	}

	private parseModelConfigString(configString: string, configKey: ExperimentBasedConfig<string | undefined>): ModelConfiguration | undefined {
		let errorMessage: string;
		try {
			const parsed: unknown = JSON.parse(configString);
			const result = MODEL_CONFIGURATION_VALIDATOR.validate(parsed);
			if (!result.error) {
				return result.content;
			}
			errorMessage = result.error.message;
		} catch (e: unknown) {
			errorMessage = ErrorUtils.toString(ErrorUtils.fromUnknown(e));
		}

		this._telemetryService.sendMSFTTelemetryEvent('incorrectNesModelConfig', { configName: configKey.id, errorMessage, configValue: configString });
		return undefined;
	}
}

function toModelConfiguration(model: ModelConfigurationWithSource): ModelConfiguration {
	const { source: _, ...config } = model;
	return config;
}

export namespace UndesiredModels {

	const UNDESIRED_MODELS_KEY = 'dardcor.chat.nextEdits.undesiredModelIds';
	type UndesiredModelsValue = string[];

	export class Manager extends Disposable implements IUndesiredModelsManager {
		declare _serviceBrand: undefined;

		private readonly _onDidChange = this._register(new Emitter<void>());
		readonly onDidChange = this._onDidChange.event;

		private readonly _queue = new TaskQueue();

		constructor(
			@IVSCodeExtensionContext private readonly _vscodeExtensionContext: IVSCodeExtensionContext,
		) {
			super();
		}

		isUndesiredModelId(modelId: string) {
			const models = this._getModels();
			return models.includes(modelId);
		}

		addUndesiredModelId(modelId: string): Promise<void> {
			return this._queue.schedule(async () => {
				const models = this._getModels();
				if (!models.includes(modelId)) {
					models.push(modelId);
					await this._setModels(models);
					this._onDidChange.fire();
				}
			});
		}

		removeUndesiredModelId(modelId: string): Promise<void> {
			return this._queue.schedule(async () => {
				const models = this._getModels();
				const index = models.indexOf(modelId);
				if (index !== -1) {
					models.splice(index, 1);
					await this._setModels(models);
					this._onDidChange.fire();
				}
			});
		}

		private _getModels(): string[] {
			return this._vscodeExtensionContext.globalState.get<UndesiredModelsValue>(UNDESIRED_MODELS_KEY) ?? [];
		}

		private _setModels(models: string[]): Promise<void> {
			return new Promise((resolve, reject) => {
				this._vscodeExtensionContext.globalState.update(UNDESIRED_MODELS_KEY, models).then(resolve, reject);
			});
		}
	}
}

