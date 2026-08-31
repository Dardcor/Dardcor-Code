/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWebviewWorkbenchService } from '../../../webviewPanel/browser/webviewWorkbenchService.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { ACTIVE_GROUP } from '../../../../services/editor/common/editorService.js';

let drouterWebview: WebviewInput | undefined;
let drouterDisposeListener: IDisposable | undefined;

function drouterHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:25128; style-src 'unsafe-inline';">
	<style>
		html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; overflow: hidden; background: #09090b; }
	</style>
</head>
<body><iframe title="Model" src="http://127.0.0.1:25128/dashboard/providers"></iframe></body>
</html>`;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dardcor.model.open',
			title: { value: localize('openDardcorModel', "Open Model"), original: 'Open Model' }
		});
	}
	async run(accessor: ServicesAccessor) {
		const webviewWorkbenchService = accessor.get(IWebviewWorkbenchService);
		if (drouterWebview) {
			webviewWorkbenchService.revealWebview(drouterWebview, ACTIVE_GROUP, false);
			return;
		}

		drouterWebview = webviewWorkbenchService.openWebview({
			title: 'Model',
			options: { enableFindWidget: true, disableServiceWorker: true },
			contentOptions: { allowScripts: true },
			extension: undefined
		}, 'dardcor.model', 'Model', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		drouterWebview.webview.setHtml(drouterHtml());
		drouterDisposeListener?.dispose();
		drouterDisposeListener = drouterWebview.webview.onDidDispose(() => {
		drouterWebview = undefined;
		drouterDisposeListener?.dispose();
		drouterDisposeListener = undefined;
	});
	}
});

export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();
		this.update();
	}

	private update(): void {
		const props = this.getEntryProps();
		if (this.entry) {
			this.entry.update(props);
		} else {
			this.entry = this.statusbarService.addEntry(props, 'chat.statusBarEntry', StatusbarAlignment.RIGHT, { location: { id: 'status.editor.mode', priority: 100.1 }, alignment: StatusbarAlignment.RIGHT });
		}
	}

	private getEntryProps(): IStatusbarEntry {
		return {
			name: localize('modelStatus', "Model"),
			text: '$(hubot) Model',
			ariaLabel: localize('modelStatusAria', "Model - Models and Providers"),
			tooltip: localize('modelStatusTooltip', "Open Model Management"),
			command: 'dardcor.model.open',
			showInAllWindows: true
		} satisfies IStatusbarEntry;
	}

	override dispose(): void {
		super.dispose();
		this.entry?.dispose();
		this.entry = undefined;
	}
}
