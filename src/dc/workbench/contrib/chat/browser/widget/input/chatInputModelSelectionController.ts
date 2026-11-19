/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IObservable, observableValue } from '../../../../../../base/common/observable.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../../common/languageModels.js';
import { IIntendedModelHolder } from '../../../common/model/chatModel.js';
import { IIntendedModelSelection, InitialModelSelectionResult, isInConversationModelChoice, isRestoredModelReason, ModelSelectionReason, resolveConfiguredModel, resolveInitialModelSelection, resolveModelIdentifier, RestoredModelReason } from '../../../common/modelSelection.js';
import { findBestMatchingModel, IsModelSupportedHere, resolveModelFromSyncState, shouldResetModelToDefault, shouldResetOnModelListChange } from './chatInputModelUtils.js';
import { isByokModel } from '../../../common/chatSelectedModel.js';
import { IChatModelSelectionDiagnostics, NullChatModelSelectionDiagnostics } from './chatModelSelectionDiagnostics.js';

export interface IChatInputModelSelectionRuntime {
	readonly getCurrentSessionType: () => string | undefined;
	readonly getModels: (sessionType: string | undefined) => ILanguageModelChatMetadataAndIdentifier[];
	readonly getAllModels: () => ILanguageModelChatMetadataAndIdentifier[];
	readonly getConfiguredModelValue: () => string | undefined;
	readonly isEmpty: () => boolean;

	readonly isModelSupportedHere: IsModelSupportedHere;
	readonly getDeclaredDefaultModel: (models: readonly ILanguageModelChatMetadataAndIdentifier[]) => ILanguageModelChatMetadataAndIdentifier | undefined;

	readonly getBoundConversationKey: () => string | undefined;
	readonly getIntentHolder: () => IIntendedModelHolder;
	readonly applyModel: (model: ILanguageModelChatMetadataAndIdentifier) => void;

	readonly isAwaitingSessionModels?: (sessionType: string) => boolean;
	readonly subscribeToModelChanges?: (listener: () => void) => IDisposable;
	readonly restoreModelConfiguration?: (modelId: string, configuration: Record<string, unknown> | undefined) => void;
}

interface IPendingProgrammaticSelection {
	readonly resolveModel: () => ILanguageModelChatMetadataAndIdentifier | undefined;
	readonly conversationKey: string | undefined;
	readonly complete: (applied: boolean) => void;
}

export class ChatInputModelSelectionController extends Disposable {

	private readonly _currentModel = observableValue<ILanguageModelChatMetadataAndIdentifier | undefined>(this, undefined);
	readonly currentModel: IObservable<ILanguageModelChatMetadataAndIdentifier | undefined> = this._currentModel;
	private _selectionReason: ModelSelectionReason | undefined;
	private _pendingProgrammaticSelection: IPendingProgrammaticSelection | undefined;

	constructor(
		private readonly _runtime: IChatInputModelSelectionRuntime,
		private readonly _diagnostics: IChatModelSelectionDiagnostics = NullChatModelSelectionDiagnostics,
	) {
		super();
		const subscribe = this._runtime.subscribeToModelChanges;
		if (subscribe) {
			this._register(subscribe(() => this.reconcileModelListChange(this._pool())));
		}
		this._register(toDisposable(() => this._clearPendingProgrammaticSelection()));
	}

	get selectionReason(): ModelSelectionReason | undefined {
		return this._selectionReason;
	}

	beginConversationSwitch(): void {
		this._selectionReason = undefined;
		this._clearPendingProgrammaticSelection();
	}

	isAwaitingRememberedModel(): boolean {
		const modelId = this._intendedModel?.modelId;
		return !!modelId && !this._pool().some(model => model.identifier === modelId);
	}

	hasPendingProgrammaticSelection(): boolean {
		return !!this._pendingProgrammaticSelection;
	}

	applySelection(
		model: ILanguageModelChatMetadataAndIdentifier,
		apply: () => void,
		isUserAction: boolean,
		rollbackOnError = false,
	): void {
		if (!isUserAction) {
			this._display(model);
			apply();
			return;
		}
		this._clearPendingProgrammaticSelection();
		const previousModel = this._currentModel.get();
		const previousReason = this._selectionReason;
		const previousRememberedSelection = this._intendedModel;
		this._currentModel.set(model, undefined);
		this._selectionReason = ModelSelectionReason.UserSelection;
		this._remember({ modelId: model.identifier, model, reason: ModelSelectionReason.UserSelection });
		this._diagnostics.report('explicit-selection', { model: model.identifier }, 'info');
		try {
			apply();
			this._diagnostics.report('explicit-selection-applied', { model: model.identifier }, 'info');
		} catch (error) {
			if (rollbackOnError) {
				this._currentModel.set(previousModel, undefined);
				this._selectionReason = previousReason;
				this._remember(previousRememberedSelection);
			}
			this._diagnostics.report('explicit-selection-failed', { model: model.identifier, error: String(error) }, 'error');
			throw error;
		}
	}

	applyProgrammaticSelection(model: ILanguageModelChatMetadataAndIdentifier): void {
		this._clearPendingProgrammaticSelection();
		this._remember({ modelId: model.identifier, model, reason: ModelSelectionReason.ProgrammaticSelection });
		this._applyModel(model, ModelSelectionReason.ProgrammaticSelection);
	}

	requestProgrammaticSelection(
		resolveModel: () => ILanguageModelChatMetadataAndIdentifier | undefined,
		conversationKey: string | undefined,
	): Promise<boolean> {
		this._clearPendingProgrammaticSelection();
		this._selectionReason = ModelSelectionReason.ProgrammaticSelection;
		return new Promise<boolean>(resolve => {
			let complete = resolve;
			this._pendingProgrammaticSelection = {
				resolveModel,
				conversationKey,
				complete: applied => {
					complete(applied);
					complete = () => { };
				},
			};
			this._reconcilePendingProgrammaticSelection();
		});
	}

	initialize(rememberedModelId: string | undefined): void {
		this._clearPendingProgrammaticSelection();
		if (!this._intendedModel) {
			this._remember(rememberedModelId ? { modelId: rememberedModelId, reason: ModelSelectionReason.Remembered } : undefined);
		}
		const resolveSelection = (): InitialModelSelectionResult => {
			const configuredModelValue = this._runtime.getConfiguredModelValue();
			const models = this._pool();
			const configuredModel = this._runtime.isEmpty() ? resolveConfiguredModel(configuredModelValue, models) : undefined;
			const resolution = resolveModelIdentifier(models, rememberedModelId, false);
			return resolveInitialModelSelection({
				configuredModel,
				desiredModelResolution: resolution,
				desiredReason: ModelSelectionReason.Remembered,
				fallbackModel: this._defaultModel(models),
				fallbackReason: ModelSelectionReason.FirstAvailable,
			});
		};

		const selection = resolveSelection();
		this._reportInitialization(this._runtime.getConfiguredModelValue(), rememberedModelId, selection);
		if (selection.kind === 'apply') {
			this._applyModel(selection.model, selection.reason);
			this.ensureCurrentModelSupported();
		} else if (selection.kind === 'pending') {
			const fallbackModel = this._defaultModel(this._pool());
			if (fallbackModel) {
				this._applyModel(fallbackModel, ModelSelectionReason.FirstAvailable);
			}
		}
	}

	resetToDefault(sessionType = this._runtime.getCurrentSessionType()): void {
		this._clearPendingProgrammaticSelection();
		this._remember(undefined);
		this.selectDefault(sessionType);
	}

	ensureCurrentModelSupported(): void {
		const currentModel = this._currentModel.get();
		const sessionType = this._runtime.getCurrentSessionType();
		const models = this._pool(sessionType);
		const willReset = shouldResetModelToDefault(currentModel, models, this._runtime.isModelSupportedHere, this._runtime.getAllModels(), sessionType);
		this._diagnostics.report('compatibility-check', {
			currentModel: currentModel?.identifier,
			sessionType,
			willReset,
		}, willReset ? 'info' : 'debug');
		if (willReset) {
			this.selectDefault(sessionType);
		}
	}

	selectDefault(sessionType = this._runtime.getCurrentSessionType()): void {
		if (sessionType && this._runtime.isAwaitingSessionModels?.(sessionType)) {
			return;
		}
		const models = this._pool(sessionType);
		const configuredModel = resolveConfiguredModel(this._runtime.getConfiguredModelValue(), models);
		const defaultModel = configuredModel ?? this._defaultModel(models);
		this._diagnostics.report('select-default', {
			configuredModel: configuredModel?.identifier,
			defaultModel: defaultModel?.identifier,
			currentModel: this._currentModel.get()?.identifier,
		}, defaultModel ? 'info' : 'debug');
		if (!defaultModel) {
			return;
		}
		const reason = this.hasPendingProgrammaticSelection()
			? this._selectionReason
			: (configuredModel ? ModelSelectionReason.ConfiguredDefault : ModelSelectionReason.FirstAvailable);
		this._applyModel(defaultModel, reason);
	}

	configuredDefaultToSeed(conversationModelReason?: RestoredModelReason): ILanguageModelChatMetadataAndIdentifier | undefined {
		const claimedByConversation = conversationModelReason !== undefined
			? isInConversationModelChoice(conversationModelReason)
			: (isInConversationModelChoice(this._selectionReason)
				|| isInConversationModelChoice(this._intendedModel?.reason)
				|| !!this._pendingProgrammaticSelection);
		if (!this._runtime.isEmpty() || claimedByConversation) {
			return undefined;
		}
		return resolveConfiguredModel(this._runtime.getConfiguredModelValue(), this._pool());
	}

	applyConfiguredDefault(): boolean {
		const configuredModel = this.configuredDefaultToSeed();
		if (!configuredModel) {
			return false;
		}
		if (configuredModel.identifier === this._currentModel.get()?.identifier) {
			if (this._selectionReason !== ModelSelectionReason.ConfiguredDefault) {
				this._selectionReason = ModelSelectionReason.ConfiguredDefault;
				return true;
			}
			return false;
		}
		this._applyModel(configuredModel, ModelSelectionReason.ConfiguredDefault);
		this.ensureCurrentModelSupported();
		return true;
	}

	reconcileModelListChange(models: readonly ILanguageModelChatMetadataAndIdentifier[]): void {
		if (this.applyConfiguredDefault() || this._reconcilePendingProgrammaticSelection() || this._restoreRememberedModel()) {
			return;
		}
		const currentModel = this._currentModel.get();
		const declaredDefault = this._runtime.getDeclaredDefaultModel(models);
		if (this._runtime.isEmpty()
			&& this._selectionReason === ModelSelectionReason.FirstAvailable
			&& declaredDefault
			&& currentModel?.identifier !== declaredDefault.identifier) {
			this._applyModel(declaredDefault, ModelSelectionReason.FirstAvailable);
			return;
		}
		if (!shouldResetOnModelListChange(currentModel?.identifier, [...models])) {
			return;
		}
		const match = findBestMatchingModel(currentModel, models);
		if (match) {
			this._applyModel(match, this._selectionReason);
		} else {
			this.selectDefault();
		}
	}

	private _restoreRememberedModel(): boolean {
		const remembered = this._intendedModel;
		if (!remembered || this._currentModel.get()?.identifier === remembered.modelId) {
			return false;
		}
		if (this._selectionReason === ModelSelectionReason.ConfiguredDefault && !isInConversationModelChoice(remembered.reason)) {
			return false;
		}
		const pool = this._pool();
		const exact = pool.find(model => model.identifier === remembered.modelId);
		const model = exact ?? (isRestoredModelReason(remembered.reason) ? findBestMatchingModel(remembered.model, pool) : undefined);
		if (!model || (!exact && this._currentModel.get()?.identifier === model.identifier)) {
			return false;
		}
		this._diagnostics.report('restore-remembered-model', { model: model.identifier, remembered: remembered.modelId, reason: remembered.reason }, 'info');
		if (exact && remembered.configuration) {
			this._runtime.restoreModelConfiguration?.(remembered.modelId, remembered.configuration);
		}
		this._applyModel(model, remembered.reason);
		return true;
	}

	syncFromConversationState(
		desiredModel: ILanguageModelChatMetadataAndIdentifier,
		modelConfiguration: Record<string, unknown> | undefined,
		sessionType: string | undefined,
		conversationKey: string,
		isRemoteEdit = false,
		restoredAs: RestoredModelReason = ModelSelectionReason.SessionRestore,
	): void {
		const boundConversationKey = this._runtime.getBoundConversationKey();
		if (boundConversationKey !== undefined && boundConversationKey !== conversationKey) {
			this._diagnostics.report('conversation-restore-stale-ignored', {
				desiredModel: desiredModel.identifier,
				conversation: conversationKey,
				boundConversation: boundConversationKey,
			}, 'info');
			return;
		}
		const keepsAwaitedModel = this._keepsAwaitedModel(desiredModel, restoredAs, isRemoteEdit);
		if (keepsAwaitedModel) {
			this._diagnostics.report('conversation-restore-keeps-awaited-model', {
				desiredModel: desiredModel.identifier,
				awaitingModel: this._intendedModel?.modelId,
			}, 'info');
		}
		if (keepsAwaitedModel) {
			this._diagnostics.report('conversation-restore-keeps-awaited-model', {
				desiredModel: desiredModel.identifier,
				awaitingModel: this._intendedModel?.modelId,
			}, 'info');
		}
		const allModels = this._runtime.getAllModels();
		const currentModel = this._currentModel.get();
		const syncResult = resolveModelFromSyncState(desiredModel, currentModel, allModels, sessionType, this._runtime.isModelSupportedHere);
		this._diagnostics.report('conversation-restore', {
			desiredModel: desiredModel.identifier,
			currentModel: currentModel?.identifier,
			sessionType,
			action: syncResult.action,
		}, syncResult.action === 'keep' ? 'debug' : 'info');
		if (syncResult.action === 'apply' || syncResult.action === 'keep') {
			this._applySessionRestore(desiredModel, syncResult.action === 'apply', modelConfiguration, restoredAs, keepsAwaitedModel);
			return;
		}

		if (!keepsAwaitedModel) {
			this._rememberOnBoundConversation(desiredModel, modelConfiguration, conversationKey, restoredAs);
		}
		this._clearPendingProgrammaticSelection();
		const pool = this._pool(sessionType);
		const match = findBestMatchingModel(desiredModel, pool) ?? findBestMatchingModel(currentModel, pool);
		if (match) {
			this._applyModel(match, restoredAs);
		} else {
			this.selectDefault(sessionType);
		}
	}

	private _keepsAwaitedModel(
		desiredModel: ILanguageModelChatMetadataAndIdentifier,
		restoredAs: RestoredModelReason,
		isRemoteEdit: boolean,
	): boolean {
		const awaited = this._intendedModel;
		if (isRemoteEdit
			|| restoredAs !== ModelSelectionReason.SessionRestore
			|| !awaited
			|| awaited.modelId === desiredModel.identifier
			|| !this.isAwaitingRememberedModel()) {
			return false;
		}
		return isInConversationModelChoice(awaited.reason)
			|| desiredModel.identifier === this._currentModel.get()?.identifier;
	}

	private _remember(selection: IIntendedModelSelection | undefined): void {
		this._runtime.getIntentHolder().setIntendedModel(selection);
	}

	private get _intendedModel(): IIntendedModelSelection | undefined {
		return this._runtime.getIntentHolder().intendedModel;
	}

	private _defaultModel(models: readonly ILanguageModelChatMetadataAndIdentifier[]): ILanguageModelChatMetadataAndIdentifier | undefined {
		return this._runtime.getDeclaredDefaultModel(models)
			?? models.find(model => !isByokModel(model.metadata))
			?? (this.isAwaitingRememberedModel() ? undefined : models[0]);
	}

	private _pool(sessionType = this._runtime.getCurrentSessionType()): ILanguageModelChatMetadataAndIdentifier[] {
		return this._runtime.getModels(sessionType);
	}

	private _rememberOnBoundConversation(
		model: ILanguageModelChatMetadataAndIdentifier,
		configuration: Record<string, unknown> | undefined,
		conversationKey: string,
		restoredAs: RestoredModelReason,
	): void {
		if (this._runtime.getBoundConversationKey() !== conversationKey) {
			return;
		}
		this._remember({ modelId: model.identifier, model, reason: restoredAs, configuration });
	}

	revalidateForSessionType(initialize: () => void): void {
		const previousModel = this._currentModel.get();
		this._selectionReason = undefined;
		initialize();
		const restoredModel = this._currentModel.get();
		const sessionType = this._runtime.getCurrentSessionType();
		const models = this._pool(sessionType);
		if (restoredModel && models.some(model => model.identifier === restoredModel.identifier)) {
			return;
		}
		const match = findBestMatchingModel(previousModel, models);
		if (match) {
			this._applyModel(match, ModelSelectionReason.SessionRestore);
		} else if (models.length === 0) {
			this._currentModel.set(undefined, undefined);
		} else {
			this.selectDefault(sessionType);
		}
	}

	private _applySessionRestore(
		model: ILanguageModelChatMetadataAndIdentifier,
		applyModel: boolean,
		configuration: Record<string, unknown> | undefined,
		restoredAs: RestoredModelReason,
		keepsAwaitedModel = false,
	): void {
		this._clearPendingProgrammaticSelection();
		this._selectionReason = restoredAs;
		if (!keepsAwaitedModel) {
			this._remember({ modelId: model.identifier, model, reason: restoredAs, configuration });
		}
		if (configuration) {
			this._runtime.restoreModelConfiguration?.(model.identifier, configuration);
		}
		if (applyModel) {
			this._applyModel(model, restoredAs);
		}
	}

	private _reconcilePendingProgrammaticSelection(): boolean {
		const intent = this._pendingProgrammaticSelection;
		if (!intent) {
			return false;
		}
		if (this._runtime.getBoundConversationKey() !== intent.conversationKey) {
			this._clearPendingProgrammaticSelection();
			return true;
		}
		const model = intent.resolveModel();
		if (!model) {
			return false;
		}
		this._pendingProgrammaticSelection = undefined;
		intent.complete(true);
		this.applyProgrammaticSelection(model);
		return true;
	}

	private _clearPendingProgrammaticSelection(): void {
		const intent = this._pendingProgrammaticSelection;
		this._pendingProgrammaticSelection = undefined;
		if (intent) {
			intent.complete(false);
			if (this._selectionReason === ModelSelectionReason.ProgrammaticSelection) {
				this._selectionReason = undefined;
			}
		}
	}

	private _display(model: ILanguageModelChatMetadataAndIdentifier): void {
		this._currentModel.set(model, undefined);
	}

	private _applyModel(model: ILanguageModelChatMetadataAndIdentifier, reason: ModelSelectionReason | undefined): void {
		this._selectionReason = reason;
		this._display(model);
		this._runtime.applyModel(model);
	}

	private _reportInitialization(configuredModel: string | undefined, rememberedModel: string | undefined, selection: InitialModelSelectionResult): void {
		this._diagnostics.report('initialize', {
			configuredModel,
			rememberedModel,
			availableModels: this._pool().map(model => model.identifier).join(','),
			selection: selection.kind,
			resultModel: selection.kind === 'apply' ? selection.model.identifier : undefined,
			resultReason: selection.kind === 'apply' ? selection.reason : undefined,
			pendingReference: selection.kind === 'pending' ? selection.selection.reference : undefined,
		}, selection.kind === 'none' ? 'debug' : 'info');
	}
}
