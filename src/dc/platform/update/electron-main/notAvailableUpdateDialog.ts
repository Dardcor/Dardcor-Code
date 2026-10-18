/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { IDialogMainService } from '../../dialogs/electron-main/dialogMainService.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import { IUpdateService, StateType } from '../common/update.js';

export class NotAvailableUpdateDialog extends Disposable {

	constructor(
		updateService: IUpdateService,
		dialogMainService: IDialogMainService,
		windowsMainService: IWindowsMainService,
	) {
		super();

		this._register(updateService.onStateChange(state => {
			if (state.type !== StateType.Idle || !state.notAvailable || state.error) {
				return;
			}

			if (!isMacintosh || windowsMainService.getWindowCount() > 0) {
				return;
			}

			dialogMainService.showMessageBox({
				type: 'info',
				message: localize('noUpdatesAvailable', "There are currently no updates available."),
			});
		}));
	}
}
