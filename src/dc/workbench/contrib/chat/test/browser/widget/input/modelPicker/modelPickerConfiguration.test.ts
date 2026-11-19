/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../../../../../platform/extensions/common/extensions.js';
import { ActionListItemKind, IActionListItem, IActionListOptions } from '../../../../../../../../platform/actionWidget/browser/actionList.js';
import { IActionWidgetService } from '../../../../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction } from '../../../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { ITelemetryService } from '../../../../../../../../platform/telemetry/common/telemetry.js';
import { ModelPickerConfiguration } from '../../../../../browser/widget/input/modelPicker/modelPickerConfiguration.js';
import { IModelConfigurationAccess } from '../../../../../browser/widget/input/modelPicker/modelPickerModelConfig.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier } from '../../../../../common/languageModels.js';

function createModel(options?: { readonly omitEffortDefault?: boolean; readonly omitContextDefault?: boolean }): ILanguageModelChatMetadataAndIdentifier {
	return {
		identifier: 'copilot/test-model',
		metadata: {
			extension: new ExtensionIdentifier('test.extension'),
			id: 'test-model',
			name: 'Test Model',
			vendor: 'dardcor',
			version: '1.0',
			family: 'test',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			configurationSchema: {
				properties: {
					effort: {
						type: 'string',
						group: 'navigation',
						enum: ['low', 'medium'],
						enumItemLabels: ['Low', 'Medium'],
						enumDescriptions: ['Faster', 'Balanced'],
						default: options?.omitEffortDefault ? undefined : 'low',
					},
					context: {
						type: 'number',
						group: 'tokens',
						enum: [32768, 65536],
						enumItemLabels: ['32K', '64K'],
						default: options?.omitContextDefault ? undefined : 32768,
					},
				},
			},
		} as ILanguageModelChatMetadata,
	};
}

function createTierModel(): ILanguageModelChatMetadataAndIdentifier {
	return {
		identifier: 'copilot/auto',
		metadata: {
			extension: new ExtensionIdentifier('test.extension'),
			id: 'auto',
			name: 'Auto',
			vendor: 'dardcor',
			version: '1.0',
			family: 'auto',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			configurationSchema: {
				properties: {
					tier: {
						type: 'string',
						title: 'Optimize for',
						group: 'navigation',
						enum: ['eco', 'balanced', 'max'],
						enumItemLabels: ['Efficiency', 'Balance', 'Intelligence'],
						enumDescriptions: ['Cheaper models', 'Balances capability and cost', 'Most capable models'],
						default: 'balanced',
					},
				},
			},
		} as ILanguageModelChatMetadata,
	};
}

function render(model: ILanguageModelChatMetadataAndIdentifier, configuration: Record<string, unknown> = {}) {
	const access: IModelConfigurationAccess = {
		getModelConfiguration: () => configuration,
		setModelConfiguration: async (_modelId, values) => { Object.assign(configuration, values); },
		getModelConfigurationActions: () => [],
	};
	let shownItems: IActionListItem<IActionWidgetDropdownAction>[] = [];
	let shownOptions: IActionListOptions | undefined;
	const actionWidgetService = {
		show: (
			_id: string,
			_supportsPreview: boolean,
			items: IActionListItem<IActionWidgetDropdownAction>[],
			_delegate: unknown,
			_anchor: unknown,
			_container: unknown,
			_actions: unknown,
			_accessibilityProvider: unknown,
			options: IActionListOptions,
		) => {
			shownItems = items;
			shownOptions = options;
		},
		focusItemById: () => { },
		updateItems: () => { },
	} as unknown as IActionWidgetService;
	const controller = new ModelPickerConfiguration({
		getSelectedModel: () => model,
		getConfigurationAccess: () => access,
		isDisabled: () => false,
		shouldShowCacheBreakHint: () => false,
		getCacheBreakLearnMoreLink: () => undefined,
		dismissCacheBreakHint: () => { },
	}, actionWidgetService, { publicLog2: () => { } } as unknown as ITelemetryService);
	const button = document.createElement('a');

	controller.renderButton(button, false, false);
	controller.show(button);

	return {
		label: button.textContent,
		ariaLabel: button.ariaLabel,
		listOptions: {
			reserveSubmenuSpace: shownOptions?.reserveSubmenuSpace,
		},
		sections: shownItems.map(item => item.kind === ActionListItemKind.Action ? {
			className: item.className,
			label: item.label,
			checked: item.item!.checked,
			ariaDescription: item.ariaDescription,
		} : { kind: item.kind, label: item.label }),
	};
}

suite('ModelPickerConfiguration', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('renders the combined label and builds accessible option sections', () => {
		assert.deepStrictEqual(render(createModel(), { effort: 'medium', context: 65536 }), {
			label: 'Medium 64K',
			ariaLabel: 'Thinking Effort: Medium, Context Size: 64K',
			listOptions: {
				reserveSubmenuSpace: false,
			},
			sections: [
				{ kind: ActionListItemKind.Header, label: 'Thinking Effort' },
				{ className: 'chat-model-picker-config-option', label: 'Low', checked: false, ariaDescription: 'Default, Faster' },
				{ className: 'chat-model-picker-config-option', label: 'Medium', checked: true, ariaDescription: 'Balanced' },
				{ kind: ActionListItemKind.Separator, label: undefined },
				{ kind: ActionListItemKind.Header, label: 'Context Size' },
				{ className: 'chat-model-picker-config-option', label: '32K', checked: false, ariaDescription: 'Default' },
				{ className: 'chat-model-picker-config-option', label: '64K', checked: true, ariaDescription: undefined },
			],
		});
	});

	test('omits an unresolved group from the label rather than rendering "undefined"', () => {
		assert.deepStrictEqual(render(createModel({ omitEffortDefault: true })), {
			label: '32K',
			ariaLabel: 'Context Size: 32K',
			listOptions: {
				reserveSubmenuSpace: false,
			},
			sections: [
				{ kind: ActionListItemKind.Header, label: 'Thinking Effort' },
				{ className: 'chat-model-picker-config-option', label: 'Low', checked: false, ariaDescription: 'Faster' },
				{ className: 'chat-model-picker-config-option', label: 'Medium', checked: false, ariaDescription: 'Balanced' },
				{ kind: ActionListItemKind.Separator, label: undefined },
				{ kind: ActionListItemKind.Header, label: 'Context Size' },
				{ className: 'chat-model-picker-config-option', label: '32K', checked: true, ariaDescription: 'Default' },
				{ className: 'chat-model-picker-config-option', label: '64K', checked: false, ariaDescription: undefined },
			],
		});
	});

	test('falls back to a generic label when no group resolves a value', () => {
		const rendered = render(createModel({ omitEffortDefault: true, omitContextDefault: true }));
		assert.deepStrictEqual({ label: rendered.label, ariaLabel: rendered.ariaLabel }, {
			label: 'Configure',
			ariaLabel: 'Configure',
		});
	});

	test('names the navigation group after the schema title when one is given', () => {
		assert.deepStrictEqual(render(createTierModel(), { tier: 'max' }), {
			label: 'Intelligence',
			ariaLabel: 'Optimize for: Intelligence',
			listOptions: {
				reserveSubmenuSpace: false,
			},
			sections: [
				{ kind: ActionListItemKind.Header, label: 'Optimize for' },
				{ className: 'chat-model-picker-config-option', label: 'Efficiency', checked: false, ariaDescription: 'Cheaper models' },
				{ className: 'chat-model-picker-config-option', label: 'Balance', checked: false, ariaDescription: 'Default, Balances capability and cost' },
				{ className: 'chat-model-picker-config-option', label: 'Intelligence', checked: true, ariaDescription: 'Most capable models' },
			],
		});
	});
});
