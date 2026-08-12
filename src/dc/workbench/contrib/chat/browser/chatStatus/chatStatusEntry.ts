/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWebviewWorkbenchService } from '../../../webviewPanel/browser/webviewWorkbenchService.js';
import { ACTIVE_GROUP } from '../../../../services/editor/common/editorService.js';
import { Codicon } from '../../../../../base/common/codicons.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dardcor.model.open',
			title: { value: localize('openDardcorModel', "Open Dardcor Model"), original: 'Open Dardcor Model' }
		});
	}
	async run(accessor: ServicesAccessor) {
		const webviewWorkbenchService = accessor.get(IWebviewWorkbenchService);
		
		const title = 'Dardcor Provider';
		const webview = webviewWorkbenchService.openWebview(
			{
				title,
				options: {
					enableFindWidget: true,
					disableServiceWorker: true
				},
				contentOptions: {
					allowScripts: true,
					localResourceRoots: []
				},
				extension: undefined
			},
			'dardcorProvider',
			title,
			Codicon.hubot,
			{ group: ACTIVE_GROUP, preserveFocus: false }
		);

		const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dardcor Provider</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background-color: #000000; }
        iframe { width: 100%; height: 100%; border: none; }
    </style>
</head>
<body>
    <iframe src="http://localhost:25000" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
		webview.webview.setHtml(html);
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
			name: localize('modelStatus', "Model Status"),
			text: '$(hubot) Model',
			ariaLabel: localize('modelStatusAria', "Model status"),
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
