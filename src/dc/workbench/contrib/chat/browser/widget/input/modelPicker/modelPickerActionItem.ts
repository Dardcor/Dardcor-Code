/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow } from '../../../../../../../base/browser/dom.js';
import { IManagedHoverContent } from '../../../../../../../base/browser/ui/hover/hover.js';
import { getBaseLayerHoverDelegate } from '../../../../../../../base/browser/ui/hover/hoverDelegate2.js';
import { getDefaultHoverDelegate } from '../../../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { BaseActionViewItem } from '../../../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../../../../base/common/actions.js';
import { MutableDisposable } from '../../../../../../../base/common/lifecycle.js';
import { autorun, IObservable } from '../../../../../../../base/common/observable.js';
import { localize } from '../../../../../../../nls.js';
import { IContextKeyService } from '../../../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../../platform/keybinding/common/keybinding.js';
import { getLanguageModelDisplayNameWithSubscriptionSource } from '../../../../common/languageModelSourcePresentation.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../../../common/languageModels.js';
import { IChatInputPickerOptions } from '../chatInputPickerActionItem.js';
import { IModelConfigurationAccess } from './modelPickerModelConfig.js';
import { ModelPickerWidget } from './modelPickerWidget.js';

export interface IModelPickerPresentationOptions {
	readonly useGroupedModelPicker: boolean;
	readonly showManageModelsAction: boolean;
	readonly showUnavailableFeatured: boolean;
	readonly showFeatured: boolean;
	readonly showAutoModel: boolean;
	readonly showModelIcon: boolean;
}

export interface IModelPickerDelegate {
	readonly currentModel: IObservable<ILanguageModelChatMetadataAndIdentifier | undefined>;
	setModel(model: ILanguageModelChatMetadataAndIdentifier): void;
	getModels(): ILanguageModelChatMetadataAndIdentifier[];
	getPresentationOptions(): IModelPickerPresentationOptions;
	getChatSessionId?(): string | undefined;
	isCacheWarm?(): boolean;
	readonly modelConfiguration?: IModelConfigurationAccess;
}

export class ModelPickerActionItem extends BaseActionViewItem {
	private readonly _pickerWidget: ModelPickerWidget;
	private readonly _managedHover = this._register(new MutableDisposable());
	private _container: HTMLElement | undefined;
	private _minimumWidth: number | undefined;

	constructor(
		action: IAction,
		delegate: IModelPickerDelegate,
		private readonly pickerOptions: IChatInputPickerOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super(undefined, action);

		this._pickerWidget = this._register(instantiationService.createInstance(ModelPickerWidget, delegate));
		this._pickerWidget.setSelectedModel(delegate.currentModel.get());
		this._pickerWidget.setCompact(pickerOptions.compact);
		if (pickerOptions.minimal) {
			this._pickerWidget.setMinimal(pickerOptions.minimal);
		}

		this._register(autorun(t => {
			const model = delegate.currentModel.read(t);
			this._pickerWidget.setSelectedModel(model);
			this._updateTooltip();
		}));

		this._register(this._pickerWidget.onDidChangeSelection(model => delegate.setModel(model)));
		this._register(this._pickerWidget.onDidChangeMinimumWidth(width => this._updateMinimumWidth(width)));
	}

	override render(container: HTMLElement): void {
		this._container = container;
		this._pickerWidget.render(container);
		this.element = this._pickerWidget.domNode;
		this._updateTooltip();
		container.classList.add('chat-input-picker-item', 'model-picker-item');
		this._updateMinimumWidth(this._pickerWidget.minimumWidth);
	}

	get minimumWidth(): number {
		return this._pickerWidget.minimumWidth;
	}

	private _updateMinimumWidth(width: number): void {
		if (!this._container || this._minimumWidth === width) {
			return;
		}
		this._minimumWidth = width;
		this._container.style.minWidth = `${width}px`;
	}

	private _getAnchorElement(): HTMLElement {
		if (this.element && getActiveWindow().document.contains(this.element)) {
			return this.element;
		}
		return this.pickerOptions.getOverflowAnchor?.() ?? this.element!;
	}

	public openModelPicker(): void {
		this._showPicker();
	}

	public show(anchor?: HTMLElement): void {
		this._pickerWidget.show(anchor ?? this._getAnchorElement());
	}

	public setEnabled(enabled: boolean): void {
		this._pickerWidget.setEnabled(enabled);
	}

	public isRestrictedMode(): boolean {
		return this._pickerWidget.isRestrictedMode();
	}

	public isSetupRequired(): boolean {
		return this._pickerWidget.isSetupRequired();
	}

	public isNoModelConfigured(): boolean {
		return this._pickerWidget.isNoModelConfigured();
	}

	private _showPicker(): void {
		this._pickerWidget.show(this._getAnchorElement());
	}

	private _updateTooltip(): void {
		const target = this._pickerWidget.nameButton;
		if (!target) {
			return;
		}
		this._managedHover.value = getBaseLayerHoverDelegate().setupManagedHover(
			getDefaultHoverDelegate('mouse'),
			target,
			() => this._getHoverContents()
		);
	}

	private _getHoverContents(): IManagedHoverContent {
		const noModel = this._pickerWidget.isNoModelConfigured();
		let label = noModel
			? localize('chat.modelPicker.noModelConfigure', "No Model Configure")
			: localize('chat.modelPicker.modelsLabel', "Models");
		const keybindingLabel = this.keybindingService.lookupKeybinding(this._action.id, this._contextKeyService)?.getLabel();
		if (keybindingLabel) {
			label += ` (${keybindingLabel})`;
		}
		if (this._pickerWidget.isRestrictedMode()) {
			return localize('chat.modelPicker.restrictedHover', "{0} • Unavailable while in Restricted mode. Trust Workspace to enable models.", label);
		}
		if (this._pickerWidget.isSetupRequired()) {
			return localize('chat.modelPicker.setupRequiredHover', "{0} • Configure a model provider to choose a model.", label);
		}
		const selectedModel = this._pickerWidget.selectedModel;
		const { statusIcon, tooltip } = selectedModel?.metadata || {};
		if (selectedModel && !noModel) {
			label = localize('chat.modelPicker.selectedModelHover', "{0} • {1}", label, getLanguageModelDisplayNameWithSubscriptionSource(selectedModel));
		}
		return statusIcon && tooltip
			? localize('chat.modelPicker.selectedModelStatusHover', "{0} • {1}", label, tooltip)
			: label;
	}
}
