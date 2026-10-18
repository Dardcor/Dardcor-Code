/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatContextUsageWidget.css';
import * as dom from '../../../../../../base/browser/dom.js';
import { EventType, addDisposableListener } from '../../../../../../base/browser/dom.js';
import { IDelayedHoverOptions } from '../../../../../../base/browser/ui/hover/hover.js';
import { IStringDictionary } from '../../../../../../base/common/collections.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { IObservable, observableValue, observableValueOpts } from '../../../../../../base/common/observable.js';
import { equals } from '../../../../../../base/common/arrays.js';
import { localize } from '../../../../../../nls.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IContextKey, IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ChatContextKeys } from '../../../common/actions/chatContextKeys.js';
import { ChatConfiguration } from '../../../common/constants.js';
import { IChatRequestModel, IChatResponseModel } from '../../../common/model/chatModel.js';
import { ILanguageModelConfigurationSchema, ILanguageModelsService } from '../../../common/languageModels.js';
import { ChatContextUsageDetails, IChatContextUsageData } from './chatContextUsageDetails.js';
import type { IChatWidget } from '../../chat.js';
import { StandardKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../../../base/common/keyCodes.js';

const $ = dom.$;

/**
 * Resolves the input-token denominator used by the context-usage gauge.
 *
 * Resolution order, mirroring the request path's `applyContextSizeOverride`:
 *   1. An explicit `contextSize` in the resolved model configuration.
 *   2. The schema's default `contextSize` tier (e.g. 200K). Used when the
 *      resolved configuration is missing `contextSize` (e.g. the schema default
 *      has not loaded yet) so the gauge denominator agrees with the size the
 *      request actually uses instead of jumping to the model's full native
 *      window. See issue #320393.
 *   3. The model's full native window (`maxInputTokens`). Models without a
 *      context-size picker have no such schema property and land here, where
 *      default and max are the same value.
 *
 * @internal - exported for testing
 */
export function resolveContextWindowInputTokens(
	modelConfiguration: IStringDictionary<unknown> | undefined,
	configurationSchema: ILanguageModelConfigurationSchema | undefined,
	maxInputTokens: number | undefined,
): number | undefined {
	const configuredContextSize = typeof modelConfiguration?.contextSize === 'number' ? modelConfiguration.contextSize : undefined;
	const schemaDefaultContextSize = configurationSchema?.properties?.contextSize?.default;
	return configuredContextSize
		?? (typeof schemaDefaultContextSize === 'number' ? schemaDefaultContextSize : undefined)
		?? maxInputTokens;
}

/**
 * Equality comparer for {@link IChatContextUsageData} used to suppress redundant updates.
 *
 * @internal - exported for testing
 */
export function isSameContextUsageData(a: IChatContextUsageData | undefined, b: IChatContextUsageData | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return a.usedTokens === b.usedTokens
		&& a.completionTokens === b.completionTokens
		&& a.totalContextWindow === b.totalContextWindow
		&& a.percentage === b.percentage
		&& a.outputBufferPercentage === b.outputBufferPercentage
		&& a.sessionCost === b.sessionCost
		&& equals(a.promptTokenDetails, b.promptTokenDetails, (x, y) =>
			x.category === y.category && x.label === y.label && x.percentageOfPrompt === y.percentageOfPrompt);
}

export class CircularProgressIndicator {

	readonly domNode: SVGSVGElement;

	private readonly progressCircle: SVGCircleElement;
	private readonly circumference: number;

	private static readonly CENTER_X = 18;
	private static readonly CENTER_Y = 18;
	private static readonly RADIUS = 14;

	constructor() {
		const r = CircularProgressIndicator.RADIUS;
		this.circumference = 2 * Math.PI * r;

		this.domNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		this.domNode.setAttribute('viewBox', '0 0 36 36');
		this.domNode.classList.add('circular-progress');

		const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		bgCircle.setAttribute('cx', String(CircularProgressIndicator.CENTER_X));
		bgCircle.setAttribute('cy', String(CircularProgressIndicator.CENTER_Y));
		bgCircle.setAttribute('r', String(r));
		bgCircle.classList.add('progress-bg');
		this.domNode.appendChild(bgCircle);

		this.progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		this.progressCircle.setAttribute('cx', String(CircularProgressIndicator.CENTER_X));
		this.progressCircle.setAttribute('cy', String(CircularProgressIndicator.CENTER_Y));
		this.progressCircle.setAttribute('r', String(r));
		this.progressCircle.classList.add('progress-arc');
		this.progressCircle.setAttribute('stroke-dasharray', String(this.circumference));
		this.progressCircle.setAttribute('stroke-dashoffset', String(this.circumference));
		this.domNode.appendChild(this.progressCircle);
	}

	setProgress(percentage: number): void {
		const clamped = Math.max(0, Math.min(100, percentage));
		const offset = this.circumference - (clamped / 100) * this.circumference;
		this.progressCircle.setAttribute('stroke-dashoffset', String(offset));
	}
}

export class ChatContextUsageWidget extends Disposable {

	private readonly _onDidChangeVisibility = this._register(new Emitter<void>());
	readonly onDidChangeVisibility: Event<void> = this._onDidChangeVisibility.event;

	readonly domNode: HTMLElement;

	private readonly progressIndicator: CircularProgressIndicator;
	private readonly percentageLabel: HTMLElement;

	private readonly _isVisible = observableValue<boolean>(this, false);
	get isVisible(): IObservable<boolean> { return this._isVisible; }

	private readonly _lastRequestDisposable = this._register(new MutableDisposable());
	private readonly _modelConfigurationListener = this._register(new MutableDisposable());
	private _currentResponse: IChatResponseModel | undefined;
	private _currentModelId: string | undefined;
	private _selectedModelId: string | undefined;
	private readonly _hoverDisposable = this._register(new MutableDisposable<DisposableStore>());
	private readonly _contextUsageDetails = this._register(new MutableDisposable<ChatContextUsageDetails>());
	private _chatWidget: IChatWidget | undefined;

	private readonly _currentData = observableValueOpts<IChatContextUsageData | undefined>({ owner: this, equalsFn: isSameContextUsageData }, undefined);

	private static readonly _OPENED_STORAGE_KEY = 'chat.contextUsage.hasBeenOpened';
	private static readonly _HOVER_ID = 'chat.contextUsage';

	private readonly _contextUsageOpenedKey: IContextKey<boolean>;

	private _enabled: boolean;

	private _modelConfigurationResolver: ((modelId: string) => IStringDictionary<unknown> | undefined) | undefined;

	constructor(
		@IHoverService private readonly hoverService: IHoverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this.domNode = $('.chat-context-usage-widget');
		this.domNode.style.display = 'none';
		this.domNode.setAttribute('tabindex', '0');
		this.domNode.setAttribute('role', 'button');
		this.domNode.setAttribute('aria-label', localize('contextUsageLabel', "Context window usage"));

		const iconContainer = this.domNode.appendChild($('.icon-container'));
		this.progressIndicator = new CircularProgressIndicator();
		iconContainer.appendChild(this.progressIndicator.domNode);

		this.percentageLabel = this.domNode.appendChild($('.percentage-label'));

		this._contextUsageOpenedKey = ChatContextKeys.contextUsageHasBeenOpened.bindTo(this.contextKeyService);

		if (this.storageService.getBoolean(ChatContextUsageWidget._OPENED_STORAGE_KEY, StorageScope.WORKSPACE, false)) {
			this._contextUsageOpenedKey.set(true);
		}

		this._enabled = this.configurationService.getValue<boolean>(ChatConfiguration.ChatContextUsageEnabled) !== false;
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.ChatContextUsageEnabled)) {
				this._enabled = this.configurationService.getValue<boolean>(ChatConfiguration.ChatContextUsageEnabled) !== false;
				if (!this._enabled) {
					this.hide();
				} else if (this._currentData.get()) {
					this.show();
				}
			}
		}));

		this.setupHover();
	}

	setChatWidget(widget: IChatWidget): void {
		this._chatWidget = widget;
		this._contextUsageDetails.value?.setChatWidget(widget);
	}

	showDetails(): boolean {
		const details = this._createDetails();
		if (!details) {
			return false;
		}
		this.hoverService.showInstantHover(
			{ ...this._hoverOptions, content: details.domNode, target: this.domNode, persistence: { hideOnHover: false, sticky: true } },
			true
		);
		this._markOpened();
		return true;
	}

	private readonly _hoverOptions: Omit<IDelayedHoverOptions, 'content'> = {
		id: ChatContextUsageWidget._HOVER_ID,
		appearance: { showPointer: true, compact: true },
		persistence: { hideOnHover: false },
		trapFocus: true
	};

	private _createDetails(): ChatContextUsageDetails | undefined {
		if (!this._isVisible.get() || !this._currentData.get()) {
			return undefined;
		}
		if (!this._contextUsageDetails.value) {
			this._contextUsageDetails.value = this.instantiationService.createInstance(ChatContextUsageDetails, this._chatWidget, this._currentData);
		}
		return this._contextUsageDetails.value;
	}

	private _markOpened(): void {
		this._contextUsageOpenedKey.set(true);
		this.storageService.store(ChatContextUsageWidget._OPENED_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private setupHover(): void {
		this._hoverDisposable.clear();
		const store = new DisposableStore();
		this._hoverDisposable.value = store;

		store.add(this.hoverService.setupDelayedHover(this.domNode, () => ({
			...this._hoverOptions,
			content: this._createDetails()?.domNode ?? ''
		})));

		store.add(addDisposableListener(this.domNode, EventType.CLICK, e => {
			e.stopPropagation();
			this.showDetails();
		}));

		store.add(addDisposableListener(this.domNode, EventType.KEY_DOWN, e => {
			const evt = new StandardKeyboardEvent(e);
			if (evt.equals(KeyCode.Space) || evt.equals(KeyCode.Enter)) {
				e.preventDefault();
				this.showDetails();
			}
		}));
	}

	update(lastRequest: IChatRequestModel | undefined): void {
		this._lastRequestDisposable.clear();
		this._currentResponse = undefined;
		this._currentModelId = undefined;

		if (!lastRequest) {
			this._currentData.set(undefined, undefined);
			this.hide();
			return;
		}

		if (!lastRequest.response || !lastRequest.modelId) {
			if (!this._currentData.get()) {
				this.hide();
			}
			return;
		}

		const response = lastRequest.response;
		const modelId = lastRequest.modelId;
		this._currentResponse = response;
		this._currentModelId = modelId;

		this.updateFromResponse(response, modelId);

		this._lastRequestDisposable.value = response.onDidChange(() => {
			this.updateFromResponse(response, modelId);
		});
	}

	updateSessionCost(sessionCost: number): void {
		const data = this._currentData.get();
		if (data && data.sessionCost !== sessionCost) {
			this.render({ ...data, sessionCost });
		}
	}








	setModelConfigurationResolver(
		resolver: (modelId: string) => IStringDictionary<unknown> | undefined,
		onDidChange: Event<string>,
	): void {
		this._modelConfigurationResolver = resolver;
		this._modelConfigurationListener.value = onDidChange(modelId => {
			const affectsDisplayedModel = this._currentModelId === modelId || this._selectedModelId === modelId;
			if (this._currentResponse && this._currentModelId && affectsDisplayedModel) {
				this.updateFromResponse(this._currentResponse, this._currentModelId);
			}
		});
	}

	setSelectedModel(modelId: string | undefined): void {
		if (this._selectedModelId === modelId) {
			return;
		}
		this._selectedModelId = modelId;
		if (this._currentResponse && this._currentModelId) {
			this.updateFromResponse(this._currentResponse, this._currentModelId);
		}
	}

	private resolveContextWindow(modelId: string | undefined): { maxOutputTokens: number | undefined; totalContextWindow: number } | undefined {
		if (!modelId) {
			return undefined;
		}
		const modelMetadata = this.languageModelsService.lookupLanguageModel(modelId);
		if (!modelMetadata) {
			return undefined;
		}
		const modelConfiguration = this._modelConfigurationResolver?.(modelId) ?? this.languageModelsService.getModelConfiguration(modelId);
		const maxInputTokens = resolveContextWindowInputTokens(modelConfiguration, modelMetadata.configurationSchema, modelMetadata.maxInputTokens);
		const maxOutputTokens = modelMetadata.maxOutputTokens;
		const totalContextWindow = (maxInputTokens ?? 0) + (maxOutputTokens ?? 0);
		if (totalContextWindow <= 0) {
			return undefined;
		}
		return { maxOutputTokens, totalContextWindow };
	}

	private updateFromResponse(response: IChatResponseModel, modelId: string): void {
		const usage = response.usage;

		const effectiveModelId = usage?.actualModelId ?? modelId;

		const contextWindow = this.resolveContextWindow(this._selectedModelId) ?? this.resolveContextWindow(effectiveModelId);
		if (!usage || !contextWindow) {
			if (!this._currentData.get()) {
				this.hide();
			}
			return;
		}

		const { maxOutputTokens, totalContextWindow } = contextWindow;

		const promptTokens = usage.promptTokens;
		const completionTokens = usage.completionTokens;
		const promptTokenDetails = usage.promptTokenDetails;
		const usedTokens = promptTokens + completionTokens;
		const percentage = (usedTokens / totalContextWindow) * 100;

		const outputBufferPercentage = maxOutputTokens !== undefined
			? (Math.max(0, maxOutputTokens - completionTokens) / totalContextWindow) * 100
			: undefined;

		this.render({
			usedTokens, completionTokens, totalContextWindow,
			percentage, outputBufferPercentage,
			promptTokenDetails, sessionCost: response.session.sessionCost,
		});
		this.show();
	}

	private render(data: IChatContextUsageData): void {
		this._currentData.set(data, undefined);

		this.progressIndicator.setProgress(data.percentage);

		const roundedPercentage = Math.min(100, Math.round(data.percentage));
		this.percentageLabel.textContent = `${roundedPercentage}%`;
		this.domNode.setAttribute('aria-label', localize('contextUsagePercentageLabel', "Context window usage: {0}%", roundedPercentage));

		this.domNode.classList.remove('warning', 'error');
		if (data.percentage >= 90) {
			this.domNode.classList.add('error');
		} else if (data.percentage >= 75) {
			this.domNode.classList.add('warning');
		}
	}

	private show(): void {
		if (!this._enabled) {
			return;
		}
		if (this.domNode.style.display === 'none') {
			this.domNode.style.display = '';
			this._isVisible.set(true, undefined);
			this._onDidChangeVisibility.fire();
		}
	}

	private hide(): void {
		if (this.domNode.style.display !== 'none') {
			this.domNode.style.display = 'none';
			this._isVisible.set(false, undefined);
			this._onDidChangeVisibility.fire();
		}
	}
}
