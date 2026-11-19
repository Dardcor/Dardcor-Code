/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveElement, isHTMLElement } from '../../../base/browser/dom.js';
import { CONTEXT_VIEW_MENU_MOTION_ANCESTOR_CLASSES, CONTEXT_VIEW_MENU_MOTION_CLOSE_ANIMATION_DURATION } from '../../../base/browser/ui/contextview/contextview.js';
import { BaseDropdown, IActionProvider, IBaseDropdownOptions } from '../../../base/browser/ui/dropdown/dropdown.js';
import { IListAccessibilityProvider } from '../../../base/browser/ui/list/listWidget.js';
import { IAction } from '../../../base/common/actions.js';
import { Codicon } from '../../../base/common/codicons.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { ResolvedKeybinding } from '../../../base/common/keybindings.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { ActionListItemKind, IActionListCloseAnimation, IActionListDelegate, IActionListItem, IActionListItemHover, IActionListItemInlineToggle, IActionListOptions } from './actionList.js';
import { IActionWidgetService } from './actionWidget.js';

export const ACTION_WIDGET_DROPDOWN_MOTION_CLASS = 'action-widget-dropdown';
export const ACTION_WIDGET_DROPDOWN_MOTION_CLOSING_CLASS = 'action-widget-dropdown-closing';

export const actionWidgetDropdownCloseAnimation: IActionListCloseAnimation = {
	className: ACTION_WIDGET_DROPDOWN_MOTION_CLOSING_CLASS,
	duration: CONTEXT_VIEW_MENU_MOTION_CLOSE_ANIMATION_DURATION,
	requiredAncestorClasses: CONTEXT_VIEW_MENU_MOTION_ANCESTOR_CLASSES,
};

export function withActionWidgetDropdownMotion(listOptions: IActionListOptions | undefined): IActionListOptions {
	const classNames = listOptions?.className?.split(/\s+/).filter(Boolean) ?? [];
	if (!classNames.includes(ACTION_WIDGET_DROPDOWN_MOTION_CLASS)) {
		classNames.push(ACTION_WIDGET_DROPDOWN_MOTION_CLASS);
	}
	const widgetClassNames = listOptions?.widgetClassName?.split(/\s+/).filter(Boolean) ?? [];
	if (!widgetClassNames.includes(ACTION_WIDGET_DROPDOWN_MOTION_CLASS)) {
		widgetClassNames.push(ACTION_WIDGET_DROPDOWN_MOTION_CLASS);
	}

	return {
		...listOptions,
		className: classNames.join(' '),
		widgetClassName: widgetClassNames.join(' '),
		closeAnimation: listOptions?.closeAnimation ?? actionWidgetDropdownCloseAnimation,
	};
}

export interface IActionWidgetDropdownAction extends IAction {
	category?: { label: string; order: number; showHeader?: boolean };
	icon?: ThemeIcon;
	description?: string | IMarkdownString;
	detail?: string;
	ariaDescription?: string;
	hover?: IActionListItemHover;
	toolbarActions?: IAction[];
	className?: string;
	inlineToggle?: IActionListItemInlineToggle;
	keybinding?: ResolvedKeybinding;
}

export interface IActionWidgetDropdownActionProvider {
	getActions(): IActionWidgetDropdownAction[];
}

export interface IActionWidgetDropdownListOptionsProvider {
	getListOptions(): IActionListOptions;
}

export interface IActionWidgetDropdownOptions extends IBaseDropdownOptions {
	readonly actions?: IActionWidgetDropdownAction[];
	readonly actionProvider?: IActionWidgetDropdownActionProvider;

	readonly actionBarActions?: IAction[];
	readonly actionBarActionProvider?: IActionProvider;
	readonly showItemKeybindings?: boolean;

	getAnchor?: () => HTMLElement;

	readonly reporter?: { id: string; name?: string; includeOptions?: boolean };

	readonly listOptions?: IActionListOptions;
	readonly listOptionsProvider?: IActionWidgetDropdownListOptionsProvider;
}

export class ActionWidgetDropdown extends BaseDropdown {

	private _enabled: boolean = true;

	constructor(
		container: HTMLElement,
		private readonly _options: IActionWidgetDropdownOptions,
		@IActionWidgetService private readonly actionWidgetService: IActionWidgetService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super(container, _options);
	}

	override show(): void {
		if (!this._enabled) {
			return;
		}

		const actionBarActions = this._options.actionBarActions ?? this._options.actionBarActionProvider?.getActions() ?? [];
		const actions = this._options.actions ?? this._options.actionProvider?.getActions() ?? [];

		const optionBeforeOpen: IActionWidgetDropdownAction | undefined = actions.find(a => a.checked);
		let selectedOption: IActionWidgetDropdownAction | undefined = optionBeforeOpen;

		const actionWidgetItems: IActionListItem<IActionWidgetDropdownAction>[] = [];

		const actionsByCategory = new Map<string, IActionWidgetDropdownAction[]>();
		for (const action of actions) {
			let category = action.category;
			if (!category) {
				category = { label: '', order: Number.MIN_SAFE_INTEGER };
			}
			if (!actionsByCategory.has(category.label)) {
				actionsByCategory.set(category.label, []);
			}
			actionsByCategory.get(category.label)!.push(action);
		}

		const sortedCategories = Array.from(actionsByCategory.entries())
			.sort((a, b) => {
				const aOrder = a[1][0]?.category?.order ?? Number.MAX_SAFE_INTEGER;
				const bOrder = b[1][0]?.category?.order ?? Number.MAX_SAFE_INTEGER;
				return aOrder - bOrder;
			});

		for (let i = 0; i < sortedCategories.length; i++) {
			const [categoryLabel, categoryActions] = sortedCategories[i];
			const showHeader = categoryActions[0]?.category?.showHeader ?? false;
			if (showHeader && categoryLabel) {
				actionWidgetItems.push({
					kind: ActionListItemKind.Header,
					label: categoryLabel,
					canPreview: false,
					disabled: false,
					hideIcon: false,
				});
			}

			for (const action of categoryActions) {
				actionWidgetItems.push({
					item: action,
					tooltip: action.tooltip,
					description: action.description,
					ariaDescription: action.ariaDescription,
					detail: action.detail,
					hover: action.hover,
					toolbarActions: action.toolbarActions,
					className: action.className,
					inlineToggle: action.inlineToggle,
					kind: ActionListItemKind.Action,
					canPreview: false,
					group: { title: '', icon: action.icon ?? ThemeIcon.fromId(action.checked ? Codicon.check.id : Codicon.blank.id) },
					disabled: !action.enabled,
					hideIcon: false,
					label: action.label,
					keybinding: this._options.showItemKeybindings ?
						(action.keybinding ?? this.keybindingService.lookupKeybinding(action.id)) :
						undefined,
				});
			}

			if (i < sortedCategories.length - 1) {
				actionWidgetItems.push({
					label: '',
					kind: ActionListItemKind.Separator,
					canPreview: false,
					disabled: false,
					hideIcon: false,
				});
			}
		}

		const previouslyFocusedElement = getActiveElement();


		const auxiliaryActionIds = new Set(actionBarActions.map(action => action.id));

		const actionWidgetDelegate: IActionListDelegate<IActionWidgetDropdownAction> = {
			onSelect: (action, preview) => {
				if (!auxiliaryActionIds.has(action.id)) {
					selectedOption = action;
				}
				this.actionWidgetService.hide();
				action.run();
			},
			onHide: () => {
				this.hide();
				if (isHTMLElement(previouslyFocusedElement)) {
					previouslyFocusedElement.focus();
				}
				this._emitCloseEvent(optionBeforeOpen, selectedOption);
			}
		};

		if (actionBarActions.length) {
			if (actionWidgetItems.length) {
				actionWidgetItems.push({
					label: '',
					kind: ActionListItemKind.Separator,
					canPreview: false,
					disabled: false,
					hideIcon: false,
				});
			}

			for (const action of actionBarActions) {
				actionWidgetItems.push({
					item: action,
					tooltip: action.tooltip,
					kind: ActionListItemKind.Action,
					canPreview: false,
					group: { title: '', icon: ThemeIcon.fromId(Codicon.blank.id) },
					disabled: !action.enabled,
					hideIcon: false,
					label: action.label,
				});
			}
		}

		const nonSeparatorItems = actionWidgetItems.filter(i => i.kind === ActionListItemKind.Action);

		const accessibilityProvider: Partial<IListAccessibilityProvider<IActionListItem<IActionWidgetDropdownAction>>> = {
			isChecked(element) {
				return element.kind === ActionListItemKind.Action && !!element?.item?.checked;
			},
			getSetSize: () => nonSeparatorItems.length,
			getPosInSet: (_element, index) => {
				let pos = 0;
				for (let i = 0; i <= index && i < actionWidgetItems.length; i++) {
					if (actionWidgetItems[i].kind === ActionListItemKind.Action) {
						pos++;
					}
				}
				return Math.max(pos, 1);
			},
			getRole: (e) => {
				switch (e.kind) {
					case ActionListItemKind.Action:
						return e.item && auxiliaryActionIds.has(e.item.id) ? 'menuitem' : 'menuitemcheckbox';
					case ActionListItemKind.Separator:
						return 'separator';
					default:
						return 'separator';
				}
			},
			getWidgetRole: () => 'menu',
		};

		super.show();

		this.actionWidgetService.show<IActionWidgetDropdownAction>(
			this._options.label ?? '',
			false,
			actionWidgetItems,
			actionWidgetDelegate,
			this._options.getAnchor?.() ?? this.element,
			undefined,
			[],
			accessibilityProvider,
			withActionWidgetDropdownMotion(this._options.listOptions ?? this._options.listOptionsProvider?.getListOptions())
		);
	}

	override hide(): void {
		const wasVisible = this.isVisible();
		super.hide();
		if (wasVisible) {
			this.actionWidgetService.hide(true);
		}
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	private _emitCloseEvent(optionBeforeOpen: IActionWidgetDropdownAction | undefined, selectedOption: IActionWidgetDropdownAction | undefined): void {
		const optionBefore = optionBeforeOpen;
		const optionAfter = selectedOption;

		if (this._options.reporter) {
			this.telemetryService.publicLog2<ActionWidgetDropdownClosedEvent, ActionWidgetDropdownClosedClassification>(
				'actionWidgetDropdownClosed',
				{
					id: this._options.reporter.id,
					name: this._options.reporter.name,
					selectionChanged: optionBefore?.id !== optionAfter?.id,
					optionIdBefore: this._options.reporter.includeOptions ? optionBefore?.id : undefined,
					optionIdAfter: this._options.reporter.includeOptions ? optionAfter?.id : undefined,
					optionLabelBefore: this._options.reporter.includeOptions ? optionBefore?.label : undefined,
					optionLabelAfter: this._options.reporter.includeOptions ? optionAfter?.label : undefined,
				}
			);
		}
	}
}

type ActionWidgetDropdownClosedEvent = {
	id: string;
	name: string | undefined;
	selectionChanged: boolean;
	optionIdBefore: string | undefined;
	optionIdAfter: string | undefined;
	optionLabelBefore: string | undefined;
	optionLabelAfter: string | undefined;
};

type ActionWidgetDropdownClosedClassification = {
	id: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The telemetry id of the dropdown picker.' };
	name: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The telemetry name of the dropdown picker.' };
	selectionChanged: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the user changed the selected option.' };
	optionIdBefore: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The option configured before opening the dropdown.' };
	optionIdAfter: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The option configured after closing the dropdown.' };
	optionLabelBefore: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The label of the option configured before opening the dropdown.' };
	optionLabelAfter: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The label of the option configured after closing the dropdown.' };
	owner: 'benibenj';
	comment: 'Tracks action widget dropdown usage and selection changes.';
};
