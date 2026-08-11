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
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { URI } from '../../../../../base/common/uri.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dardcor.model.open',
			title: { value: localize('openDardcorModel', "Open Dardcor Model"), original: 'Open Dardcor Model' }
		});
	}
	async run(accessor: ServicesAccessor) {
		const quickInputService = accessor.get(IQuickInputService);
		const openerService = accessor.get(IOpenerService);

		const pick = await quickInputService.pick([
			{ label: 'App Mode', description: 'Launch Model in a standalone application window' },
			{ label: 'Web Mode', description: 'Launch Model in an external web browser' }
		], { placeHolder: 'Select Model display mode' });

		if (pick) {
			if (pick.label === 'App Mode') {
				window.open('http://localhost:25000', 'DardcorModel', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
			} else {
				openerService.open(URI.parse('http://localhost:25000'));
			}
		}
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
