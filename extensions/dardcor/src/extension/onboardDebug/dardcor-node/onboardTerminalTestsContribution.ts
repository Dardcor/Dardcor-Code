/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { IDebuggableCommandIdentifier } from '../node/debuggableCommandIdentifier';
import { DARDCOR_DEBUG_COMMAND } from './dardcorDebugCommandContribution';

const PROVIDER_ID = 'dardcor-chat.terminalToDebugging';
const PROVIDER_ID2 = 'dardcor-chat.terminalToDebuggingSuccess';

export class OnboardTerminalTestsContribution extends Disposable implements vscode.TerminalQuickFixProvider {
	private lastExecutionFor = new Map<vscode.Terminal, vscode.TerminalShellExecutionStartEvent>();

	constructor(
		@IDebuggableCommandIdentifier private readonly debuggableCommandIdentifier: IDebuggableCommandIdentifier,
	) {
		super();
		this._register(vscode.window.registerTerminalQuickFixProvider(PROVIDER_ID, this));
		this._register(vscode.window.registerTerminalQuickFixProvider(PROVIDER_ID2, this));
		this._register(vscode.window.onDidCloseTerminal(e => {
			this.lastExecutionFor.delete(e);
		}));
		this._register(vscode.window.onDidStartTerminalShellExecution(e => {
			this.lastExecutionFor.set(e.terminal, e);
		}));
		this._register(vscode.commands.registerCommand('github.dardcor.chat.rerunWithDardcorDebug', () => {
			const terminal = vscode.window.activeTerminal;
			const execution = terminal && this.lastExecutionFor.get(terminal);
			if (!execution) {
				return;
			}

			terminal.sendText(`${DARDCOR_DEBUG_COMMAND} ${execution.execution.commandLine.value}`, true);
		}));
	}

	async provideTerminalQuickFixes(
		commandMatchResult: vscode.TerminalCommandMatchResult,
		token: vscode.CancellationToken
	): Promise<undefined | vscode.TerminalQuickFixTerminalCommand> {
		const activeTerminal = vscode.window.activeTerminal?.shellIntegration;
		const cwd = activeTerminal?.cwd;
		if (!await this.debuggableCommandIdentifier.isDebuggable(cwd, commandMatchResult.commandLine, token)) {
			return undefined;
		}

		return {
			terminalCommand: `${DARDCOR_DEBUG_COMMAND} ${commandMatchResult.commandLine}`,
			shouldExecute: false,
		};
	}
}
