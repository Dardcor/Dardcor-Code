/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../../base/common/async.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isString } from '../../../../../base/common/types.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { ILogService } from '../../../../log/common/log.js';
import { ITerminalChildProcess } from '../../../common/terminal.js';

export class TerminalAutoResponder extends Disposable {
	private _pointer = 0;
	private _paused = false;

	private _throttled = false;

	constructor(
		proc: ITerminalChildProcess,
		matchWord: string,
		response: string,
		logService: ILogService
	) {
		super();

		this._register(proc.onProcessData(e => {
			if (this._paused || this._throttled) {
				return;
			}
			const data = isString(e) ? e : e.data;
			for (let i = 0; i < data.length; i++) {
				if (data[i] === matchWord[this._pointer]) {
					this._pointer++;
				} else {
					this._reset();
				}
				if (this._pointer === matchWord.length) {
					logService.debug(`Auto reply match: "${matchWord}", response: "${response}"`);
					proc.input(response);
					this._throttled = true;
					timeout(1000).then(() => this._throttled = false);
					this._reset();
				}
			}
		}));
	}

	private _reset() {
		this._pointer = 0;
	}

	handleResize() {
		if (isWindows) {
			this._paused = true;
		}
	}

	handleInput() {
		this._paused = false;
	}
}
