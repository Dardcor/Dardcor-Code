/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ITerminalService } from '../../../platform/terminal/common/terminalService';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../util/dardcor/base/common/uri';

const MAX_BUFFER_CHARS = 2000;

interface LastTerminalActivity {
	readonly terminal: vscode.Terminal;
	readonly terminalName: string;
	readonly commandLine: string | undefined;
	readonly cwd: string | undefined;
	readonly exitCode: number | undefined;
	readonly timestamp: number;
}

export class TerminalMonitor extends Disposable {

	private _lastActivity: LastTerminalActivity | undefined;

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
	) {
		super();

		this._register(this._terminalService.onDidEndTerminalShellExecution(e => {
			this._recordTerminalActivity(e);
		}));

		this._register(this._terminalService.onDidCloseTerminal(terminal => {
			if (this._lastActivity?.terminal === terminal) {
				this._lastActivity = undefined;
			}
		}));
	}

	private _recordTerminalActivity(event: vscode.TerminalShellExecutionEndEvent): void {
		const executedCommand = event.execution;

		this._lastActivity = {
			terminal: event.terminal,
			terminalName: event.terminal.name,
			commandLine: executedCommand.commandLine?.value,
			cwd: formatCwd(executedCommand.cwd),
			exitCode: event.exitCode,
			timestamp: Date.now(),
		};
	}

	public getData(): string {
		const now = Date.now();
		const terminalCount = this._terminalService.terminals.length;

		if (!this._lastActivity) {
			return JSON.stringify({
				terminalCount,
			});
		}

		const buffer = this._terminalService.getBufferForTerminal(this._lastActivity.terminal, MAX_BUFFER_CHARS * 2);
		const msAgo = now - this._lastActivity.timestamp;

		const data = {
			terminalName: this._lastActivity.terminalName,
			commandLine: this._lastActivity.commandLine,
			cwd: this._lastActivity.cwd,
			exitCode: this._lastActivity.exitCode,
			msAgo,
			buffer: buffer.length <= MAX_BUFFER_CHARS ? {
				fits: true,
				content: buffer,
				length: buffer.length,
			} : {
				fits: false,
				contentStart: buffer.slice(0, MAX_BUFFER_CHARS / 2),
				contentEnd: buffer.slice(-MAX_BUFFER_CHARS / 2),
				length: buffer.length,
				truncatedChars: buffer.length - MAX_BUFFER_CHARS,
			},
			terminalCount,
		};

		return JSON.stringify(data);
	}
}

function formatCwd(cwd: URI | string | undefined): string | undefined {
	if (cwd === undefined) {
		return undefined;
	}
	if (typeof cwd === 'string') {
		return cwd;
	}
	return cwd.fsPath;
}
