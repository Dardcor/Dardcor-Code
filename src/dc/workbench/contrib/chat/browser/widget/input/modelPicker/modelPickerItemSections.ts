/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toAction } from '../../../../../../../base/common/actions.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { localize } from '../../../../../../../nls.js';
import { ActionListItemKind, IActionListItem } from '../../../../../../../platform/actionWidget/browser/actionList.js';
import { IActionWidgetDropdownAction } from '../../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IOpenerService } from '../../../../../../../platform/opener/common/opener.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../../../common/languageModels.js';
import { buildModelToProviderGroupMap, createModelAction, createModelItem, createPinAction, createUnavailableModelItem, getProviderGroupForModel, getProviderGroupKey, isVersionAtLeast, ProviderGroupKey } from './modelPickerItemPrimitives.js';
import type { IBuildModelPickerItemsOptions } from './modelPickerItemTypes.js';
import { isAutoModel } from './modelPickerPresentation.js';

export const ModelPickerSection = {
	Other: 'other',
} as const;

export const RESTRICTED_MODE_TRUST_ACTION_ID = 'restrictedModeTrust';
export const SETUP_REQUIRED_SIGN_IN_ACTION_ID = 'setupRequiredSignIn';

function createConfigureRouterItem(openerService: IOpenerService): IActionListItem<IActionWidgetDropdownAction> {
	const hover = new MarkdownString(localize('chat.modelPicker.configureRouterHover', "Configure providers and models in Dardcor Router (http://localhost:25128/)"), { isTrusted: true });
	return {
		item: {
			id: 'configureRouter',
			enabled: true,
			checked: false,
			class: undefined,
			tooltip: localize('chat.modelPicker.configureRouter', "Open Dardcor Router settings"),
			label: localize('chat.modelPicker.configureRouterLabel', "Configure in Dardcor Router..."),
			run: () => {
				openerService.open(URI.parse('http://localhost:25128/'));
			},
		},
		kind: ActionListItemKind.Action,
		label: localize('chat.modelPicker.configureRouterLabel', "Configure in Dardcor Router..."),
		group: { title: '', icon: ThemeIcon.fromId(Codicon.settingsGear.id) },
		disabled: false,
		hideIcon: false,
		hover: { content: hover },
	};
}

export function buildUnavailableStateItems(options: IBuildModelPickerItemsOptions): IActionListItem<IActionWidgetDropdownAction>[] | undefined {
	const { restrictedMode, setupRequired } = options.presentation;
	if (restrictedMode) {
		const enabled = !!options.actions.onRequestTrust;
		return [
			{ kind: ActionListItemKind.Header, label: localize('chat.modelPicker.restrictedMode', "Models unavailable while in Restricted mode") },
			{
				item: {
					id: RESTRICTED_MODE_TRUST_ACTION_ID,
					enabled,
					checked: false,
					class: undefined,
					tooltip: localize('chat.modelPicker.restrictedMode.trustTooltip', "Trust the workspace to enable models."),
					label: localize('chat.modelPicker.restrictedMode.trust', "Trust Workspace to enable models..."),
					run: () => options.actions.onRequestTrust?.(),
				},
				kind: ActionListItemKind.Action,
				label: localize('chat.modelPicker.restrictedMode.trust', "Trust Workspace to enable models..."),
				group: { title: '', icon: ThemeIcon.fromId(Codicon.workspaceTrusted.id) },
				disabled: !enabled,
				hideIcon: false,
			},
		];
	}
	if (setupRequired) {
		const enabled = !!options.actions.onRequestSetup;
		const items: IActionListItem<IActionWidgetDropdownAction>[] = [
			{ kind: ActionListItemKind.Header, label: localize('chat.modelPicker.setupRequired', "Sign in to use Copilot") },
			{
				item: {
					id: SETUP_REQUIRED_SIGN_IN_ACTION_ID,
					enabled,
					checked: false,
					class: undefined,
					tooltip: localize('chat.modelPicker.setupRequired.signInTooltip', "Sign in to GitHub Copilot to choose a model."),
					label: localize('chat.modelPicker.setupRequired.signIn', "Sign in to use Copilot..."),
					run: () => options.actions.onRequestSetup?.(),
				},
				kind: ActionListItemKind.Action,
				label: localize('chat.modelPicker.setupRequired.signIn', "Sign in to use Copilot..."),
				group: { title: '', icon: ThemeIcon.fromId(Codicon.signIn.id) },
				disabled: !enabled,
				hideIcon: false,
			},
		];
		if (options.presentation.showManageModelsInSetupRequired && options.manageModelsAction) {
			items.push(
				{ kind: ActionListItemKind.Separator },
				{
					item: options.manageModelsAction,
					kind: ActionListItemKind.Action,
					label: options.manageModelsAction.label,
					group: { title: '', icon: Codicon.blank },
					hideIcon: false,
					showAlways: true,
				}
			);
		}
		return items;
	}
	if (options.models.length > 0) {
		return undefined;
	}
	const result: IActionListItem<IActionWidgetDropdownAction>[] = [{
		item: {
			id: 'noModels',
			enabled: false,
			checked: false,
			class: undefined,
			tooltip: localize('chat.modelPicker.noModels', "No models available"),
			label: localize('chat.modelPicker.noModels', "No models available"),
			run: () => { },
		},
		kind: ActionListItemKind.Action,
		label: localize('chat.modelPicker.noModels', "No models available"),
		group: { title: '', icon: ThemeIcon.fromId(Codicon.blank.id) },
		disabled: true,
		hideIcon: false,
	}];
	if (options.openerService) {
		result.push(createConfigureRouterItem(options.openerService));
	}
	return result;
}

export function buildFlatModelItems(options: IBuildModelPickerItemsOptions): IActionListItem<IActionWidgetDropdownAction>[] {
	const items: IActionListItem<IActionWidgetDropdownAction>[] = [];
	if (options.openerService && options.models.length === 0) {
		items.push(createConfigureRouterItem(options.openerService));
	}
	const autoModel = options.models.find(isAutoModel);
	if (autoModel) {
		const { action, ariaDescription } = createModelAction(autoModel, options.selectedModelId, options.actions.onSelect);
		items.push(createModelItem(action, autoModel, options.openerService, undefined, options.presentation.isUBB, ariaDescription));
	}
	const sortedModels = options.models
		.filter(model => model !== autoModel)
		.sort((left, right) => left.metadata.vendor.localeCompare(right.metadata.vendor) || left.metadata.name.localeCompare(right.metadata.name));
	for (const model of sortedModels) {
		const { action, ariaDescription } = createModelAction(model, options.selectedModelId, options.actions.onSelect);
		items.push(createModelItem(action, model, options.openerService, undefined, options.presentation.isUBB, ariaDescription, undefined, options.actions.onConfigure));
	}
	return items;
}

interface IGroupedContext {
	readonly options: IBuildModelPickerItemsOptions;
	readonly items: IActionListItem<IActionWidgetDropdownAction>[];
	readonly modelToGroup: ReturnType<typeof buildModelToProviderGroupMap>;
	readonly resolveModel: (id: string) => ILanguageModelChatMetadataAndIdentifier | undefined;
	readonly placed: Set<string>;
	readonly showGroupLabel: boolean;
	readonly makePinAction: (model: ILanguageModelChatMetadataAndIdentifier) => ReturnType<typeof createPinAction> | undefined;
	markPlaced(identifierOrId: string): void;
}

function createGroupedContext(options: IBuildModelPickerItemsOptions): IGroupedContext {
	const modelToGroup = buildModelToProviderGroupMap(options.languageModelsService);
	const allModels = new Map(options.models.map(model => [model.identifier, model]));
	const modelsByMetadataId = new Map(options.models.map(model => [model.metadata.id, model]));
	const placed = new Set<string>();
	return {
		options,
		items: [],
		modelToGroup,
		resolveModel: id => allModels.get(id) ?? modelsByMetadataId.get(id),
		placed,
		showGroupLabel: new Set(options.models.map(model => {
			const group = getProviderGroupForModel(model, modelToGroup, options.languageModelsService);
			return getProviderGroupKey(group.vendor, group.groupName);
		})).size > 1,
		makePinAction: model => options.actions.onTogglePin
			? createPinAction(model.identifier, options.pinnedModelIds.includes(model.identifier), options.actions.onTogglePin)
			: undefined,
		markPlaced: identifierOrId => placed.add(identifierOrId),
	};
}

function appendLeadingModels(context: IGroupedContext): ILanguageModelChatMetadataAndIdentifier | undefined {
	const { options, items } = context;
	const autoModel = options.models.find(isAutoModel);
	if (autoModel) {
		context.markPlaced(autoModel.identifier);
		const { action, ariaDescription } = createModelAction(autoModel, options.selectedModelId, options.actions.onSelect);
		items.push(createModelItem(action, autoModel, options.openerService, undefined, options.presentation.isUBB, ariaDescription));
	}
	return autoModel;
}

function appendPinnedModels(context: IGroupedContext): Set<string> {
	const { options, items } = context;
	const pinnedSet = new Set(options.pinnedModelIds);
	const pinnedModels: ILanguageModelChatMetadataAndIdentifier[] = [];
	for (const id of options.pinnedModelIds) {
		const model = context.resolveModel(id);
		if (!context.placed.has(id) && model && !context.placed.has(model.identifier)) {
			context.markPlaced(model.identifier);
			pinnedModels.push(model);
		}
	}
	pinnedModels.sort((left, right) => {
		const leftGroup = getProviderGroupForModel(left, context.modelToGroup, options.languageModelsService);
		const rightGroup = getProviderGroupForModel(right, context.modelToGroup, options.languageModelsService);
		return leftGroup.groupName.localeCompare(rightGroup.groupName) || left.metadata.name.localeCompare(right.metadata.name);
	});
	if (pinnedModels.length > 0) {
		items.push({ kind: ActionListItemKind.Separator, label: localize('chat.modelPicker.pinned', "Pinned") });
		for (const model of pinnedModels) {
			const groupLabel = context.showGroupLabel ? getProviderGroupForModel(model, context.modelToGroup, options.languageModelsService).groupName : undefined;
			const { action, ariaDescription } = createModelAction(model, options.selectedModelId, options.actions.onSelect, undefined, context.showGroupLabel);
			items.push(createModelItem(action, model, options.openerService, groupLabel, options.presentation.isUBB, ariaDescription, context.makePinAction(model), options.actions.onConfigure));
		}
	}
	return pinnedSet;
}

function appendPromotedModels(_context: IGroupedContext, _autoModel: ILanguageModelChatMetadataAndIdentifier | undefined, _pinnedSet: Set<string>): void {
	// Top section strictly displays pinned models only.
	return;
}

function appendOtherModels(context: IGroupedContext): boolean {
	const { options, items } = context;
	const otherModels = options.models.filter(model => !context.placed.has(model.identifier));
	if (otherModels.length === 0) {
		return false;
	}
	if (items.length > 0) {
		items.push({ kind: ActionListItemKind.Separator });
	}
	const toolbarActions = options.manageModelsAction
		? [toAction({ id: options.manageModelsAction.id, label: options.manageModelsAction.tooltip ?? options.manageModelsAction.label, class: ThemeIcon.asClassName(Codicon.gear), run: () => options.manageModelsAction!.run() })]
		: undefined;
	items.push({
		item: { id: 'otherModels', enabled: true, checked: false, class: undefined, tooltip: localize('chat.modelPicker.otherModels', "Other Models"), label: localize('chat.modelPicker.otherModels', "Other Models"), run: () => { } },
		kind: ActionListItemKind.Action,
		label: localize('chat.modelPicker.otherModels', "Other Models"),
		group: { title: '', icon: Codicon.chevronDown },
		hideIcon: false,
		section: ModelPickerSection.Other,
		isSectionToggle: true,
		toolbarActions,
		className: 'chat-model-picker-section-toggle',
	});
	interface IProviderGroupBucket { vendor: string; groupName: string; models: ILanguageModelChatMetadataAndIdentifier[] }
	const groups = new Map<ProviderGroupKey, IProviderGroupBucket>();
	for (const model of otherModels) {
		const info = getProviderGroupForModel(model, context.modelToGroup, options.languageModelsService);
		const key = getProviderGroupKey(info.vendor, info.groupName);
		const bucket = groups.get(key) ?? { vendor: info.vendor, groupName: info.groupName, models: [] };
		bucket.models.push(model);
		groups.set(key, bucket);
	}
	const sortedGroups = [...groups.values()].sort((left, right) => {
		if (left.vendor === 'copilot' && right.vendor !== 'copilot') { return -1; }
		if (right.vendor === 'copilot' && left.vendor !== 'copilot') { return 1; }
		return left.groupName.localeCompare(right.groupName);
	});
	const showHeaders = sortedGroups.length > 1;
	for (const group of sortedGroups) {
		if (showHeaders) {
			items.push({ kind: ActionListItemKind.Separator, label: group.groupName, section: ModelPickerSection.Other });
		}
		group.models.sort((left, right) => {
			const leftEntry = options.controlModels[left.metadata.id] ?? options.controlModels[left.identifier];
			const rightEntry = options.controlModels[right.metadata.id] ?? options.controlModels[right.identifier];
			const leftUnavailable = leftEntry?.minVSCodeVersion && !isVersionAtLeast(options.currentVSCodeVersion, leftEntry.minVSCodeVersion) ? 1 : 0;
			const rightUnavailable = rightEntry?.minVSCodeVersion && !isVersionAtLeast(options.currentVSCodeVersion, rightEntry.minVSCodeVersion) ? 1 : 0;
			return leftUnavailable - rightUnavailable || left.metadata.name.localeCompare(right.metadata.name);
		});
		for (const model of group.models) {
			const entry = options.controlModels[model.metadata.id] ?? options.controlModels[model.identifier];
			if (entry?.minVSCodeVersion && !isVersionAtLeast(options.currentVSCodeVersion, entry.minVSCodeVersion)) {
				items.push(createUnavailableModelItem(model.metadata.id, entry, 'update', options.manageSettingsUrl, options.updateStateType, options.chatEntitlementService, ModelPickerSection.Other));
			} else {
				const { action, ariaDescription } = createModelAction(model, options.selectedModelId, options.actions.onSelect, ModelPickerSection.Other, showHeaders);
				items.push(createModelItem(action, model, options.openerService, undefined, options.presentation.isUBB, ariaDescription, context.makePinAction(model), options.actions.onConfigure));
			}
		}
	}
	return true;
}

export function buildGroupedModelItems(options: IBuildModelPickerItemsOptions): IActionListItem<IActionWidgetDropdownAction>[] {
	const context = createGroupedContext(options);
	const autoModel = appendLeadingModels(context);
	const pinnedSet = appendPinnedModels(context);
	appendPromotedModels(context, autoModel, pinnedSet);
	const hasOtherModels = appendOtherModels(context);
	if (options.openerService && options.models.length === 0) {
		context.items.push(createConfigureRouterItem(options.openerService));
	}
	if (options.manageModelsAction && !hasOtherModels) {
		context.items.push({ kind: ActionListItemKind.Separator });
		context.items.push({
			item: options.manageModelsAction,
			kind: ActionListItemKind.Action,
			label: options.manageModelsAction.label,
			group: { title: '', icon: Codicon.blank },
			hideIcon: false,
			showAlways: true,
		});
	}
	return context.items;
}
