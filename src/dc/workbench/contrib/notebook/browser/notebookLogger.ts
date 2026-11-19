/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


class NotebookLogger {
	constructor() {
		this._domFrameLog();
	}
	private _frameId = 0;
	private _domFrameLog() {

	}

	debug(...args: unknown[]) {
		const date = new Date();
		console.log(`${date.getSeconds()}:${date.getMilliseconds().toString().padStart(3, '0')}`, `frame #${this._frameId}: `, ...args);
	}
}

const instance = new NotebookLogger();
export function notebookDebug(...args: unknown[]) {
	instance.debug(...args);
}

