/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatSessionPickerActionItem.css';
import { IAction } from '../../../../../base/common/actions.js';
import { Event } from '../../../../../base/common/event.js';
import * as dom from '../../../../../base/browser/dom.js';
import { getActiveWindow } from '../../../../../base/browser/dom.js';
import { IActionWidgetService } from '../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownOptions } from '../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ActionWidgetDropdownActionViewItem } from '../../../../../platform/actions/browser/actionWidgetDropdownActionViewItem.js';
import { IChatSessionProviderOptionGroup, IChatSessionProviderOptionItem } from '../../common/chatSessionsService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { IChatInputPickerOptions, withChatInputPickerMotion } from '../widget/input/chatInputPickerActionItem.js';
import { autorun } from '../../../../../base/common/observable.js';
import { IChatEntitlementService } from '../../../../services/chat/common/chatEntitlementService.js';
import { IActionListItemHover } from '../../../../../platform/actionWidget/browser/actionList.js';
import { getModelHoverContent } from '../widget/input/modelPicker/modelPickerHover.js';
import { getCompactCodicon } from '../chatIcons.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';


export interface IChatSessionPickerDelegate {
	readonly onDidChangeOption: Event<IChatSessionProviderOptionItem>;
	getCurrentOption(): IChatSessionProviderOptionItem | undefined;
	setOption(option: IChatSessionProviderOptionItem): void;
	getOptionGroup(): IChatSessionProviderOptionGroup | undefined;
	getSessionResource: () => URI | undefined;
}

export class ChatSessionPickerActionItem extends ActionWidgetDropdownActionViewItem {
	protected currentOption: IChatSessionProviderOptionItem | undefined;
	protected container: HTMLElement | undefined;

	constructor(
		action: IAction,
		initialState: { group: IChatSessionProviderOptionGroup; item: IChatSessionProviderOptionItem | undefined },
		protected readonly delegate: IChatSessionPickerDelegate,
		protected readonly _pickerOptions: IChatInputPickerOptions | undefined,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ICommandService protected readonly commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		const { group, item } = initialState;
		const actionWithLabel: IAction = {
			...action,
			label: item?.name || group.name,
			tooltip: item?.description ?? group.description ?? group.name,
			run: () => { }
		};

		const sessionPickerActionWidgetOptions: Omit<IActionWidgetDropdownOptions, 'label' | 'labelRenderer'> = {
			actionProvider: {
				getActions: () => this.getDropdownActions()
			},
			actionBarActionProvider: undefined,
			reporter: { id: group.id, name: `ChatSession:${group.name}`, includeOptions: false },
			getAnchor: () => this._getAnchorElement(),
			listOptions: withChatInputPickerMotion(undefined),
		};

		super(actionWithLabel, sessionPickerActionWidgetOptions, actionWidgetService, keybindingService, contextKeyService, telemetryService);
		this.currentOption = item;

		this._register(this.delegate.onDidChangeOption(newOption => {
			this.currentOption = newOption;
			if (this.element) {
				this.renderLabel(this.element);
			}
			this.updateEnabled();
		}));

		const pickerOptions = this._pickerOptions;
		if (pickerOptions) {
			this._register(autorun(reader => {
				pickerOptions.compact.read(reader);
				if (this.element) {
					this.renderLabel(this.element);
				}
			}));
		}
	}

	protected getDropdownActions(): IActionWidgetDropdownAction[] {
		const currentOption = this.delegate.getCurrentOption();
		if (currentOption?.locked) {
			return [this.createLockedOptionAction(currentOption)];
		}

		const group = this.delegate.getOptionGroup();
		if (!group) {
			return [];
		}

		const actions: IActionWidgetDropdownAction[] = group.items.map(optionItem => {
			const isCurrent = optionItem.id === currentOption?.id;
			return {
				id: optionItem.id,
				enabled: !optionItem.locked,
				icon: optionItem.icon,
				checked: isCurrent,
				class: undefined,
				description: optionItem.description,
				tooltip: optionItem.description ?? optionItem.name,
				label: optionItem.name,
				hover: this._buildOptionHover(optionItem),
				run: () => {
					this.delegate.setOption(optionItem);
				}
			} satisfies IActionWidgetDropdownAction;
		});

		if (group.commands?.length) {
			const addSeparator = actions.length > 0;
			for (const command of group.commands) {
				const args = command.arguments ? [...command.arguments] : [];
				const sessionResource = this.delegate.getSessionResource();
				if (sessionResource) {
					args.unshift(sessionResource);
				}
				actions.push({
					id: command.command,
					enabled: true,
					checked: false,
					class: undefined,
					description: undefined,
					tooltip: command.tooltip ?? command.title,
					label: command.title,
					category: addSeparator ? { label: '', order: Number.MAX_SAFE_INTEGER } : undefined,
					run: () => {
						this.commandService.executeCommand(command.command, ...args);
					}
				} satisfies IActionWidgetDropdownAction);
			}
		}

		return actions;
	}

	private _buildOptionHover(optionItem: IChatSessionProviderOptionItem): IActionListItemHover | undefined {
		if (optionItem.modelMetadata) {
			const isUBB = !!this.chatEntitlementService.quotas.usageBasedBilling;
			const syntheticModel = {
				identifier: optionItem.id,
				metadata: {
					extension: new ExtensionIdentifier(''),
					name: optionItem.modelMetadata.name,
					id: optionItem.modelMetadata.id,
					vendor: optionItem.modelMetadata.vendor ?? '',
					version: optionItem.modelMetadata.version ?? '',
					family: optionItem.modelMetadata.family ?? '',
					tooltip: optionItem.modelMetadata.tooltip,
					pricing: optionItem.modelMetadata.pricing,
					multiplierNumeric: optionItem.modelMetadata.multiplierNumeric,
					inputCost: optionItem.modelMetadata.inputCost,
					outputCost: optionItem.modelMetadata.outputCost,
					cacheCost: optionItem.modelMetadata.cacheCost,
					cacheWriteCost: optionItem.modelMetadata.cacheWriteCost,
					longContextInputCost: optionItem.modelMetadata.longContextInputCost,
					longContextOutputCost: optionItem.modelMetadata.longContextOutputCost,
					longContextCacheCost: optionItem.modelMetadata.longContextCacheCost,
					longContextCacheWriteCost: optionItem.modelMetadata.longContextCacheWriteCost,
					priceCategory: optionItem.modelMetadata.priceCategory,
					promo: optionItem.modelMetadata.promo,
					maxInputTokens: optionItem.modelMetadata.maxInputTokens ?? 0,
					maxOutputTokens: optionItem.modelMetadata.maxOutputTokens ?? 0,
					capabilities: optionItem.modelMetadata.capabilities ? {
						vision: optionItem.modelMetadata.capabilities.vision,
						toolCalling: optionItem.modelMetadata.capabilities.toolCalling,
					} : undefined,
					isDefaultForLocation: {},
				},
			};
			const hover = getModelHoverContent(syntheticModel, isUBB, undefined, this.openerService);
			if (hover) {
				return { content: hover.element, disposable: hover.disposable };
			}
		}
		if (optionItem.tooltip) {
			return { content: optionItem.tooltip };
		}
		return undefined;
	}

	protected createLockedOptionAction(option: IChatSessionProviderOptionItem): IActionWidgetDropdownAction {
		return {
			id: option.id,
			enabled: false,
			icon: option.icon,
			checked: true,
			class: undefined,
			description: option.description,
			tooltip: option.description ?? option.name,
			label: option.name,
			run: () => { }
		};
	}

	private _getAnchorElement(): HTMLElement {
		if (this.element && getActiveWindow().document.contains(this.element)) {
			return this.element;
		}
		return this._pickerOptions?.getOverflowAnchor?.() ?? this.element!;
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		const domChildren = [];
		element.classList.add('chat-session-option-picker');
		const group = this.delegate.getOptionGroup();
		const compact = this._pickerOptions?.compact.get() ?? false;
		element.classList.toggle('compact', compact);
		const label = this.currentOption?.name ?? group?.description ?? localize('chat.sessionPicker.label', "Pick Option");
		const isDefaultWithIcon = this.currentOption?.default && this.currentOption?.icon;
		element.classList.toggle('icon-only', compact && !!this.currentOption?.icon);

		if (this.currentOption?.icon) {
			domChildren.push(renderIcon(getCompactCodicon(this.currentOption.icon)));
		}

		if (!isDefaultWithIcon && (!compact || !this.currentOption?.icon)) {
			domChildren.push(dom.$('span.chat-session-option-label', undefined, label));
		}

		dom.reset(element, ...domChildren);
		this.setAriaLabelAttributes(element);
		element.ariaLabel = label;
		return null;
	}

	override render(container: HTMLElement): void {
		this.container = container;
		super.render(container);
		container.classList.add(this.getContainerClass());

		if (this.currentOption?.locked) {
			container.classList.add('locked');
		}
	}

	protected getContainerClass(): string {
		return 'chat-sessionPicker-item';
	}

	protected override updateEnabled(): void {
		const originalEnabled = this.action.enabled;
		if (this.currentOption?.locked) {
			this.action.enabled = false;
		}
		super.updateEnabled();
		this.action.enabled = originalEnabled;
		if (this.container) {
			this.container.classList.toggle('locked', !!this.currentOption?.locked);
		}
	}
}
