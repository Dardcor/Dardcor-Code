/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import mermaid, { MermaidConfig } from 'mermaid';
import { buildMermaidConfig, loadExtensionConfig, registerMermaidAddons, renderMermaidBlocksInElement } from '../shared';
import { DiagramManager } from '../shared/diagramManager';
import { IDisposable } from '../shared/disposable';
import { VsCodeMermaidThemeTracker } from '../shared/dardcorTheme';

export { activate } from '../notebook/index';

function initMarkdownPreview() {
	let currentAbortController: AbortController | undefined;
	let currentDisposables: IDisposable[] = [];
	const diagramManager = new DiagramManager(loadExtensionConfig());
	const themeTracker = new VsCodeMermaidThemeTracker();

	async function init() {
		for (const disposable of currentDisposables) {
			disposable.dispose();
		}
		currentDisposables = [];

		currentAbortController?.abort();
		currentAbortController = new AbortController();
		const signal = currentAbortController.signal;

		themeTracker.refresh();

		const extConfig = loadExtensionConfig();
		diagramManager.updateConfig(extConfig);

		const config: MermaidConfig = {
			...buildMermaidConfig(extConfig, themeTracker),
			maxTextSize: extConfig.maxTextSize,
		};

		mermaid.initialize(config);
		await registerMermaidAddons();

		const activeIds = new Set<string>();
		await renderMermaidBlocksInElement(document.body, (mermaidContainer, content, _contentHash, isError) => {
			mermaidContainer.innerHTML = content;
			if (isError) {
				return;
			}
			activeIds.add(mermaidContainer.id);
			currentDisposables.push(diagramManager.setup(mermaidContainer.id, mermaidContainer));
		}, signal);

		diagramManager.retainStates(activeIds);
	}

	window.addEventListener('vscode.markdown.updateContent', init);
	init();
}

const isNotebook = typeof document !== 'undefined' && Boolean(document.getElementById('container'));
if (!isNotebook) {
	initMarkdownPreview();
}
