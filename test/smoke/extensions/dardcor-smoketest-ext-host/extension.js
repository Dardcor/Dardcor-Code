/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');


let deactivateMarkerFile;





async function waitForCommand(command, timeoutMs) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const commands = await vscode.commands.getCommands(true);
		if (commands.includes(command)) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}

	throw new Error(`Timed out waiting for command '${command}'`);
}




function activate(context) {
	try {
		const pid = String(process.pid);
		const activationPidFile = path.join(os.tmpdir(), 'vscode-ext-host-pid-on-activate.txt');
		fs.writeFileSync(activationPidFile, pid, 'utf-8');
	} catch {
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('smoketest.getExtensionHostPidAndBlock', (delayMs = 100, durationMs = 60000) => {
			const pid = process.pid;

			const pidFile = path.join(os.tmpdir(), 'vscode-ext-host-pid.txt');
			setTimeout(() => {
				fs.writeFileSync(pidFile, String(pid), 'utf-8');

				if (typeof SharedArrayBuffer === 'function' && typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function') {
					const sab = new SharedArrayBuffer(4);
					const blocker = new Int32Array(sab);
					Atomics.wait(blocker, 0, 0, durationMs);
				} else {
					const start = Date.now();
					while (Date.now() - start < durationMs) {
					}
				}
			}, delayMs);

			return pid;
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('smoketest.setupGracefulDeactivation', () => {
			const pid = process.pid;
			const pidFile = path.join(os.tmpdir(), 'vscode-ext-host-pid-graceful.txt');
			deactivateMarkerFile = path.join(os.tmpdir(), 'vscode-ext-host-deactivated.txt');

			fs.writeFileSync(pidFile, String(pid), 'utf-8');

			return { pid, markerFile: deactivateMarkerFile };
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('smoketest.openCopilotCliChat', async () => {
			const command = 'workbench.action.chat.openNewSessionEditor.copilotcli';
			await waitForCommand('github.copilot.debug.extensionState', 60_000);
			await vscode.commands.executeCommand('github.copilot.debug.extensionState');
			await waitForCommand(command, 60_000);
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.commands.executeCommand(command);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('smoketest.openClaudeChat', async () => {
			const command = 'workbench.action.chat.openNewSessionEditor.claude-code';
			await waitForCommand('github.copilot.debug.extensionState', 60_000);
			await vscode.commands.executeCommand('github.copilot.debug.extensionState');
			await waitForCommand(command, 60_000);
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.commands.executeCommand(command);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('smoketest.openLocalChat', async () => {
			const command = 'workbench.action.chat.newLocalChat';
			await waitForCommand(command, 60_000);
			await vscode.commands.executeCommand(command);
		})
	);
}

function deactivate() {
	if (deactivateMarkerFile) {
		try {
			fs.writeFileSync(deactivateMarkerFile, `deactivated at ${Date.now()}`, 'utf-8');
		} catch {
		}
	}
}

module.exports = {
	activate,
	deactivate
};
