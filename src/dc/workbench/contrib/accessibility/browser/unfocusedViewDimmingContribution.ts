/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { clamp } from '../../../../base/common/numbers.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { AccessibilityWorkbenchSettingId, ViewDimUnfocusedOpacityProperties } from './accessibilityConfiguration.js';

export class UnfocusedViewDimmingContribution extends Disposable implements IWorkbenchContribution {
	private _styleElement?: HTMLStyleElement;
	private _styleElementDisposables: DisposableStore | undefined = undefined;

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();

		this._register(toDisposable(() => this._removeStyleElement()));

		this._register(Event.runAndSubscribe(configurationService.onDidChangeConfiguration, e => {
			if (e && !e.affectsConfiguration(AccessibilityWorkbenchSettingId.DimUnfocusedEnabled) && !e.affectsConfiguration(AccessibilityWorkbenchSettingId.DimUnfocusedOpacity)) {
				return;
			}

			let cssTextContent = '';

			const enabled = ensureBoolean(configurationService.getValue(AccessibilityWorkbenchSettingId.DimUnfocusedEnabled), false);
			if (enabled) {
				const opacity = clamp(
					ensureNumber(configurationService.getValue(AccessibilityWorkbenchSettingId.DimUnfocusedOpacity), ViewDimUnfocusedOpacityProperties.Default),
					ViewDimUnfocusedOpacityProperties.Minimum,
					ViewDimUnfocusedOpacityProperties.Maximum
				);

				if (opacity !== 1) {
					const rules = new Set<string>();
					const filterRule = `filter: opacity(${opacity});`;
					rules.add(`.monaco-workbench .pane-body.integrated-terminal:not(:focus-within) .tabs-container { ${filterRule} }`);
					rules.add(`.monaco-workbench .pane-body.integrated-terminal .terminal-wrapper:not(:focus-within) { ${filterRule} }`);
					rules.add(`.monaco-workbench .editor-instance:not(:focus-within) .monaco-editor { ${filterRule} }`);
					rules.add(`.monaco-workbench .editor-instance:not(:focus-within) .breadcrumbs-below-tabs { ${filterRule} }`);
					rules.add(`.monaco-workbench .editor-instance:not(:focus-within) .terminal-wrapper { ${filterRule} }`);
					rules.add(`.monaco-workbench .editor-instance:not(:focus-within) .settings-editor { ${filterRule} }`);
					rules.add(`.monaco-workbench .editor-instance:not(:focus-within) .keybindings-editor { ${filterRule} }`);
					rules.add(`.monaco-workbench .editor-instance:not(:focus-within) .monaco-editor-pane-placeholder { ${filterRule} }`);
					rules.add(`.monaco-workbench .editor-instance:not(:focus-within) .gettingStartedContainer { ${filterRule} }`);
					cssTextContent = [...rules].join('\n');
				}

			}

			if (cssTextContent.length === 0) {
				this._removeStyleElement();
			} else {
				this._getStyleElement().textContent = cssTextContent;
			}
		}));
	}

	private _getStyleElement(): HTMLStyleElement {
		if (!this._styleElement) {
			this._styleElementDisposables = new DisposableStore();
			this._styleElement = createStyleSheet(undefined, undefined, this._styleElementDisposables);
			this._styleElement.className = 'accessibilityUnfocusedViewOpacity';
		}
		return this._styleElement;
	}

	private _removeStyleElement(): void {
		this._styleElementDisposables?.dispose();
		this._styleElementDisposables = undefined;
		this._styleElement = undefined;
	}
}


function ensureBoolean(value: unknown, defaultValue: boolean): boolean {
	return typeof value === 'boolean' ? value : defaultValue;
}

function ensureNumber(value: unknown, defaultValue: number): number {
	return typeof value === 'number' ? value : defaultValue;
}
