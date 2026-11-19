/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { commands, QuickPick, QuickPickItem, QuickPickItemKind, window, workspace } from 'vscode';
import { IInstantiationService } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ConfigKey } from '../../lib/src/config';
import { DardcorConfigPrefix } from '../../lib/src/constants';
import { AsyncCompletionManager, ICompletionsAsyncManagerService } from '../../lib/src/ghostText/asyncCompletions';
import { CompletionsCache, ICompletionsCacheService } from '../../lib/src/ghostText/completionsCache';
import { ICompletionsLogTargetService, Logger } from '../../lib/src/logger';
import { AvailableModelsManager, ICompletionsModelManagerService, ModelItem } from '../../lib/src/openai/model';
import { telemetry, TelemetryData } from '../../lib/src/telemetry';
import { HasMultipleCompletionModels } from './constants';
import { getUserSelectedModelConfiguration } from './modelPickerUserSelection';
const logger = new Logger('modelPicker');

interface ModelPickerItem extends Omit<ModelItem, 'preview' | 'tokenizer'>, QuickPickItem {
	type: 'model' | 'separator';
}

const defaultModelPickerItems: ModelPickerItem[] = [
	{
		label: '',
		kind: QuickPickItemKind.Separator,
		modelId: 'separator',
		type: 'separator' as const,
		alwaysShow: true,
	},
];

export class ModelPickerManager {
	get models(): ModelItem[] {
		return this._modelManager.getGenericCompletionModels();
	}

	hasMultipleModels(): boolean {
		return this.models.length > 1;
	}

	private getDefaultModelId(): string {
		return this._modelManager.getDefaultModelId();
	}

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICompletionsAsyncManagerService private readonly _asyncCompletionManager: AsyncCompletionManager,
		@ICompletionsModelManagerService private readonly _modelManager: AvailableModelsManager,
		@ICompletionsLogTargetService private readonly _logTarget: ICompletionsLogTargetService,
		@ICompletionsCacheService private readonly _completionsCache: CompletionsCache
	) {
		this._updateModelPickerContext();
		this._modelManager.onDidChangeModels(() => this._updateModelPickerContext());
	}

	private _updateModelPickerContext(): void {
		void commands.executeCommand('setContext', HasMultipleCompletionModels, this.hasMultipleModels());
	}

	async setUserSelectedCompletionModel(modelId: string | null) {
		return workspace
			.getConfiguration(DardcorConfigPrefix)
			.update(ConfigKey.UserSelectedCompletionModel, modelId ?? '', true);
	}

	async handleModelSelection(quickpickList: QuickPick<ModelPickerItem>) {
		const model = quickpickList.activeItems[0];
		if (model === undefined) {
			return;
		}
		quickpickList.hide();

		await this.selectModel(model);
	}

	async selectModel(model: ModelPickerItem) {
		const currentModel = this._instantiationService.invokeFunction(getUserSelectedModelConfiguration);

		if (currentModel !== model.modelId) {
			this._completionsCache.clear();
			this._asyncCompletionManager.clear();
		}

		const modelSelection = model.modelId === this.getDefaultModelId() ? null : model.modelId;
		await this.setUserSelectedCompletionModel(modelSelection);
		if (modelSelection === null) {
			logger.info(this._logTarget, `User selected default model; setting null`);
		} else {
			logger.info(this._logTarget, `Selected model: ${model.modelId}`);
		}

		this._instantiationService.invokeFunction(
			telemetry,
			'modelPicker.modelSelected',
			TelemetryData.createAndMarkAsIssued({
				engineName: modelSelection ?? 'default',
			})
		);
	}

	private modelsForModelPicker(): [string | null, ModelPickerItem[]] {
		const currentModelSelection = this._instantiationService.invokeFunction(getUserSelectedModelConfiguration);
		const items: ModelPickerItem[] = this.models.map(model => {
			return {
				modelId: model.modelId,
				label: `${model.label}${model.preview ? ' (Preview)' : ''}`,
				description: `(${model.modelId})`,
				alwaysShow: model.modelId === this.getDefaultModelId(),
				type: 'model' as const,
			};
		});

		return [currentModelSelection, items];
	}

	showModelPicker(): QuickPick<ModelPickerItem> {
		const [currentModelSelection, items] = this.modelsForModelPicker();

		const quickPick = window.createQuickPick<ModelPickerItem>();
		quickPick.title = 'Change Dardcor Router Completion Model';
		quickPick.items = [...items, ...defaultModelPickerItems];
		quickPick.onDidAccept(() => this.handleModelSelection(quickPick));

		const currentModelOrDefault = currentModelSelection ?? this.getDefaultModelId();

		const selectedItem = quickPick.items.find(item => item.modelId === currentModelOrDefault);
		if (selectedItem) {
			quickPick.activeItems = [selectedItem];
		}

		quickPick.show();
		return quickPick;
	}
}


