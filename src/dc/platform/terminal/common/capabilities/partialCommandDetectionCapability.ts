/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IPartialCommandDetectionCapability, TerminalCapability } from './capabilities.js';
import type { IMarker, Terminal } from '@xterm/headless';

const enum Constants {
	MinimumPromptLength = 2
}

export class PartialCommandDetectionCapability extends DisposableStore implements IPartialCommandDetectionCapability {
	readonly type = TerminalCapability.PartialCommandDetection;

	private readonly _commands: IMarker[] = [];

	get commands(): readonly IMarker[] { return this._commands; }

	private readonly _onCommandFinished = this.add(new Emitter<IMarker>());
	readonly onCommandFinished = this._onCommandFinished.event;

	constructor(
		private readonly _terminal: Terminal,
		private _onDidExecuteText: Event<void> | undefined
	) {
		super();
		this.add(this._terminal.onData(e => this._onData(e)));
		this.add(this._terminal.parser.registerCsiHandler({ final: 'J' }, params => {
			if (params.length >= 1 && (params[0] === 2 || params[0] === 3)) {
				this._clearCommandsInViewport();
			}
			return false;
		}));
		if (this._onDidExecuteText) {
			this.add(this._onDidExecuteText(() => this._onEnter()));
		}
	}

	private _onData(data: string): void {
		if (data === '\x0d') {
			this._onEnter();
		}
	}

	private _onEnter(): void {
		if (!this._terminal) {
			return;
		}
		if (this._terminal.buffer.active.cursorX >= Constants.MinimumPromptLength) {
			const marker = this._terminal.registerMarker(0);
			if (marker) {
				this._commands.push(marker);
				this._onCommandFinished.fire(marker);
			}
		}
	}

	private _clearCommandsInViewport(): void {
		let count = 0;
		for (let i = this._commands.length - 1; i >= 0; i--) {
			if (this._commands[i].line < this._terminal.buffer.active.baseY) {
				break;
			}
			count++;
		}
		this._commands.splice(this._commands.length - count, count);
	}
}
