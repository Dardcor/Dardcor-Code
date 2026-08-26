/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ipcRenderer } from '../../../../../base/parts/sandbox/electron-browser/globals.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dardcor.model.open',
			title: { value: localize('openDardcorModel', "Open Models and Providers"), original: 'Open Models and Providers' }
		});
	}
	async run(accessor: ServicesAccessor) {
		if (typeof ipcRenderer !== 'undefined' && ipcRenderer?.send) {
			ipcRenderer.send('vscode:openProviderWindow');
			return;
		}
		const openerService = accessor.get(IOpenerService);
		const targetUrl = 'http://127.0.0.1:25000/dashboard/providers';
		await openerService.open(URI.parse(targetUrl), { openExternal: true, allowTunneling: false });
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
			ariaLabel: localize('modelStatusAria', "Dardcor Code model and providers"),
			tooltip: localize('modelStatusTooltip', "Open Dardcor Code Providers"),
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
