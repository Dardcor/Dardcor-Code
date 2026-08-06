/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/style.css';
import { registerThemingParticipant } from '../../platform/theme/common/themeService.js';
import { WORKBENCH_BACKGROUND, TITLE_BAR_ACTIVE_BACKGROUND } from '../common/theme.js';
import { isWeb, isIOS } from '../../base/common/platform.js';
import { createMetaElement } from '../../base/browser/dom.js';
import { isSafari, isStandalone } from '../../base/browser/browser.js';
import { mainWindow } from '../../base/browser/window.js';

registerThemingParticipant((theme, collector) => {

	// Background (helps for subpixel-antialiasing on Windows)
	const workbenchBackground = WORKBENCH_BACKGROUND(theme);
	collector.addRule(`.monaco-workbench { background-color: ${workbenchBackground}; }`);

	// Selection (do NOT remove - https://github.com/microsoft/vscode/issues/169662)
	collector.addRule(`.monaco-workbench ::selection { background-color: rgba(92, 45, 145, 0.6) !important; }`);

	// Force scrollbar and minimap sliders to be visible (Grey)
	collector.addRule(`
		.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider { background: rgba(59, 10, 94, 0.5) !important; }
		.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider:hover { background: rgba(74, 20, 140, 0.8) !important; }
		.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider.active { background: rgba(106, 27, 154, 0.8) !important; }
		.monaco-workbench .monaco-editor .minimap-slider .minimap-slider-horizontal { background: rgba(59, 10, 94, 0.3) !important; }
		.monaco-workbench .monaco-editor .minimap-slider:hover .minimap-slider-horizontal { background: rgba(74, 20, 140, 0.6) !important; }
		.monaco-workbench .monaco-editor .minimap-slider.active .minimap-slider-horizontal { background: rgba(106, 27, 154, 0.6) !important; }
	`);

	// Update <meta name="theme-color" content=""> based on selected theme
	if (isWeb) {
		const titleBackground = theme.getColor(TITLE_BAR_ACTIVE_BACKGROUND);
		if (titleBackground) {
			const metaElementId = 'monaco-workbench-meta-theme-color';
			// eslint-disable-next-line no-restricted-syntax
			let metaElement = mainWindow.document.getElementById(metaElementId) as HTMLMetaElement | null;
			if (!metaElement) {
				metaElement = createMetaElement();
				metaElement.name = 'theme-color';
				metaElement.id = metaElementId;
			}

			metaElement.content = titleBackground.toString();
		}
	}

	// We disable user select on the root element, however on Safari this seems
	// to prevent any text selection in the monaco editor. As a workaround we
	// allow to select text in monaco editor instances.
	if (isSafari) {
		collector.addRule(`
			body.web {
				touch-action: none;
			}
			.monaco-workbench .monaco-editor .view-lines {
				user-select: text;
				-webkit-user-select: text;
			}
		`);
	}

	// Update body background color to ensure the home indicator area looks similar to the workbench
	if (isIOS && isStandalone()) {
		collector.addRule(`body { background-color: ${workbenchBackground}; }`);
	}
});
