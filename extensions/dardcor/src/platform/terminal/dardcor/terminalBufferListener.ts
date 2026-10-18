/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, Terminal, TerminalExecutedCommand, window } from 'vscode';
import { basename } from '../../../util/dardcor/base/common/path';
import { platform } from '../../../util/dardcor/base/common/process';
import { removeAnsiEscapeCodes } from '../../../util/dardcor/base/common/strings';

const terminalBuffers: Map<Terminal, string[]> = new Map();
const terminalCommands: Map<Terminal, TerminalExecutedCommand[]> = new Map();

export function getActiveTerminalBuffer(): string {
	const activeTerminal = window.activeTerminal;
	if (activeTerminal === undefined) {
		return '';
	}
	return terminalBuffers.get(activeTerminal)?.join('') || '';
}

export function getBufferForTerminal(terminal?: Terminal, maxChars: number = 16000): string {
	if (!terminal) {
		return '';
	}

	const buffer = terminalBuffers.get(terminal);
	if (!buffer) {
		return '';
	}
	const joined = buffer.join('');
	const start = Math.max(0, joined.length - maxChars);
	return joined.slice(start);
}

export function getLastCommandForTerminal(terminal: Terminal): TerminalExecutedCommand | undefined {
	return terminalCommands.get(terminal)?.at(-1);
}

export function getActiveTerminalLastCommand(): TerminalExecutedCommand | undefined {
	const activeTerminal = window.activeTerminal;
	if (activeTerminal === undefined) {
		return undefined;
	}
	return terminalCommands.get(activeTerminal)?.at(-1);
}

export function getActiveTerminalSelection(): string {
	try {
		return window.activeTerminal?.selection ?? '';
	} catch {
		return '';
	}
}

let lastDetectedShellType: string | undefined;
export function getActiveTerminalShellType(): string {
	const activeTerminal = window.activeTerminal;

	if (activeTerminal?.state.shell) {
		return activeTerminal.state.shell;
	}

	if (activeTerminal && 'shellPath' in activeTerminal.creationOptions) {
		const shellPath = activeTerminal.creationOptions.shellPath;
		if (shellPath) {
			let candidateShellType: string | undefined;
			const shellFile = basename(shellPath);

			if (shellFile === 'bash.exe') {
				candidateShellType = 'Git Bash';
			} else {
				const shellFileWithoutExtension = shellFile.replace(/\..+/, '');
				switch (shellFileWithoutExtension) {
					case 'pwsh':
					case 'powershell':
						candidateShellType = 'powershell';
						break;
					case '':
						break;
					default:
						candidateShellType = shellFileWithoutExtension;
				}
			}
			if (candidateShellType) {
				lastDetectedShellType = candidateShellType;
				return candidateShellType;
			}
		}
	}

	if (lastDetectedShellType) {
		return lastDetectedShellType;
	}

	return platform === 'win32' ? 'powershell' : 'bash';
}

function appendLimitedWindow<T>(target: T[], data: T) {
	target.push(data);
	if (target.length > 40) {
		target.shift();
	}
}

export function installTerminalBufferListeners(): Disposable[] {
	return [
		window.onDidChangeTerminalState(t => {
			if (window.activeTerminal && t.processId === window.activeTerminal.processId) {
				const newShellType = t.state.shell;
				if (newShellType && newShellType !== lastDetectedShellType) {
					lastDetectedShellType = newShellType;
				}
			}
		}),
		window.onDidWriteTerminalData(e => {
			let dataBuffer = terminalBuffers.get(e.terminal);
			if (!dataBuffer) {
				dataBuffer = [];
				terminalBuffers.set(e.terminal, dataBuffer);
			}
			appendLimitedWindow(dataBuffer, removeAnsiEscapeCodes(e.data));
		}),
		window.onDidExecuteTerminalCommand(e => {
			let commands = terminalCommands.get(e.terminal);
			if (!commands) {
				commands = [];
				terminalCommands.set(e.terminal, commands);
			}
			appendLimitedWindow(commands, e);
		}),
		window.onDidCloseTerminal(e => {
			terminalBuffers.delete(e);
		})
	];
}
