/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

(function () {

	const { ipcRenderer, webFrame, contextBridge, webUtils } = require('electron');

	type ISandboxConfiguration = import('../common/sandboxTypes.js').ISandboxConfiguration;


	function validateIPC(channel: string): true | never {
		if (!channel?.startsWith('vscode:')) {
			throw new Error(`Unsupported event IPC channel '${channel}'`);
		}

		return true;
	}

	function parseArgv(key: string): string | undefined {
		for (const arg of process.argv) {
			if (arg.indexOf(`--${key}=`) === 0) {
				return arg.split('=')[1];
			}
		}

		return undefined;
	}



	let configuration: ISandboxConfiguration | undefined = undefined;

	const resolveConfiguration: Promise<ISandboxConfiguration> = (async () => {
		const windowConfigIpcChannel = parseArgv('vscode-window-config');
		if (!windowConfigIpcChannel) {
			throw new Error('Preload: did not find expected vscode-window-config in renderer process arguments list.');
		}

		try {
			validateIPC(windowConfigIpcChannel);

			const resolvedConfiguration: ISandboxConfiguration = configuration = await ipcRenderer.invoke(windowConfigIpcChannel);

			Object.assign(process.env, resolvedConfiguration.userEnv);

			webFrame.setZoomLevel(resolvedConfiguration.zoomLevel ?? 0);

			return resolvedConfiguration;
		} catch (error) {
			throw new Error(`Preload: unable to fetch vscode-window-config: ${error}`);
		}
	})();



	const resolveShellEnv: Promise<typeof process.env> = (async () => {

		const [userEnv, shellEnv] = await Promise.all([
			(async () => (await resolveConfiguration).userEnv)(),
			ipcRenderer.invoke('vscode:fetchShellEnv')
		]);

		return { ...process.env, ...shellEnv, ...userEnv };
	})();




	const globals = {


		ipcRenderer: {

			send(channel: string, ...args: unknown[]): void {
				if (validateIPC(channel)) {
					ipcRenderer.send(channel, ...args);
				}
			},

			invoke(channel: string, ...args: unknown[]): Promise<unknown> {
				validateIPC(channel);

				return ipcRenderer.invoke(channel, ...args);
			},

			on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) {
				validateIPC(channel);

				ipcRenderer.on(channel, listener);

				return this;
			},

			once(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) {
				validateIPC(channel);

				ipcRenderer.once(channel, listener);

				return this;
			},

			removeListener(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) {
				validateIPC(channel);

				ipcRenderer.removeListener(channel, listener);

				return this;
			}
		},

		ipcMessagePort: {

			acquire(responseChannel: string, nonce: string) {
				if (validateIPC(responseChannel)) {
					const responseListener = (e: Electron.IpcRendererEvent, responseNonce: string) => {
						if (nonce === responseNonce) {
							ipcRenderer.off(responseChannel, responseListener);
							window.postMessage(nonce, '*', e.ports);
						}
					};

					ipcRenderer.on(responseChannel, responseListener);
				}
			}
		},

		webFrame: {

			setZoomLevel(level: number): void {
				if (typeof level === 'number') {
					webFrame.setZoomLevel(level);
				}
			}
		},

		webUtils: {

			getPathForFile(file: File): string {
				return webUtils.getPathForFile(file);
			}
		},

		process: {
			get platform() { return process.platform; },
			get arch() { return process.arch; },
			get env() { return { ...process.env }; },
			get versions() { return process.versions; },
			get type() { return 'renderer'; },
			get execPath() { return process.execPath; },

			cwd(): string {
				return process.env['VSCODE_CWD'] || process.execPath.substr(0, process.execPath.lastIndexOf(process.platform === 'win32' ? '\\' : '/'));
			},

			shellEnv(): Promise<typeof process.env> {
				return resolveShellEnv;
			},

			getProcessMemoryInfo(): Promise<Electron.ProcessMemoryInfo> {
				return process.getProcessMemoryInfo();
			},

			on(type: string, callback: (...args: unknown[]) => void): void {
				process.on(type, callback);
			}
		},

		context: {

			configuration(): ISandboxConfiguration | undefined {
				return configuration;
			},

			async resolveConfiguration(): Promise<ISandboxConfiguration> {
				return resolveConfiguration;
			}
		}
	};

	try {

		contextBridge.exposeInMainWorld('vscode', globals);
	} catch (error) {
		console.error(error);
	}
}());
