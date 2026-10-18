/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import type { Terminal as XTermTerminal, IBuffer, ITerminalAddon } from '@xterm/xterm';

export class LineDataEventAddon extends Disposable implements ITerminalAddon {

	private _xterm?: XTermTerminal;
	private _isOsSet = false;

	private readonly _onLineData = this._register(new Emitter<string>());
	readonly onLineData = this._onLineData.event;

	constructor(private readonly _initializationPromise?: Promise<void>) {
		super();
	}

	async activate(xterm: XTermTerminal) {
		this._xterm = xterm;

		const buffer = xterm.buffer;

		await this._initializationPromise;

		this._register(xterm.onLineFeed(() => {
			const newLine = buffer.active.getLine(buffer.active.baseY + buffer.active.cursorY);
			if (newLine && !newLine.isWrapped) {
				this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY - 1);
			}
		}));

		this._register(toDisposable(() => {
			this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY);
		}));
	}

	setOperatingSystem(os: OperatingSystem) {
		if (this._isOsSet || !this._xterm) {
			return;
		}
		this._isOsSet = true;

		if (os === OperatingSystem.Windows) {
			const xterm = this._xterm;
			this._register(xterm.parser.registerCsiHandler({ final: 'H' }, () => {
				const buffer = xterm.buffer;
				this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY);
				return false;
			}));
		}
	}

	private _sendLineData(buffer: IBuffer, lineIndex: number): void {
		let line = buffer.getLine(lineIndex);
		if (!line) {
			return;
		}
		let lineData = line.translateToString(true);
		while (lineIndex > 0 && line.isWrapped) {
			line = buffer.getLine(--lineIndex);
			if (!line) {
				break;
			}
			lineData = line.translateToString(false) + lineData;
		}
		this._onLineData.fire(lineData);
	}
}
