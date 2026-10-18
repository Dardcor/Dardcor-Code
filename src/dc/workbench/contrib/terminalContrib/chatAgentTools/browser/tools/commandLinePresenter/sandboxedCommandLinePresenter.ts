/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalSandboxService } from '../../../common/terminalSandboxService.js';
import type { ICommandLinePresenter, ICommandLinePresenterOptions, ICommandLinePresenterResult } from './commandLinePresenter.js';

export class SandboxedCommandLinePresenter implements ICommandLinePresenter {
	constructor(
		@ITerminalSandboxService private readonly _sandboxService: ITerminalSandboxService,
	) {
	}

	async present(options: ICommandLinePresenterOptions): Promise<ICommandLinePresenterResult | undefined> {
		if (!(await this._sandboxService.isEnabled())) {
			return undefined;
		}
		return {
			commandLine: options.commandLine.forDisplay,
			processOtherPresenters: true
		};
	}
}
