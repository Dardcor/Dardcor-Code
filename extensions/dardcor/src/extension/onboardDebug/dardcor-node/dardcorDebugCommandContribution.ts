/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { connect } from 'net';
import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { ITasksService } from '../../../platform/tasks/common/tasksService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { ITerminalService } from '../../../platform/terminal/common/terminalService';
import { assertNever } from '../../../util/dardcor/base/common/assert';
import { CancellationTokenSource } from '../../../util/dardcor/base/common/cancellation';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import * as path from '../../../util/dardcor/base/common/path';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { EXTENSION_ID } from '../../common/constants';
import { ILaunchConfigService, needsWorkspaceFolderForTaskError } from '../common/launchConfigService';
import { DardcorDebugCommandSessionFactory } from '../node/dardcorDebugCommandSessionFactory';
import { SimpleRPC } from '../node/dardcorDebugWorker/rpc';
import { IStartOptions, StartResultKind } from '../node/dardcorDebugWorker/shared';
import { DardcorDebugCommandHandle } from './dardcorDebugCommandHandle';
import { handleDebugSession } from './dardcorDebugCommandSession';

//@ts-ignore
import powershellScript from '../node/dardcorDebugWorker/dardcorDebugWorker.ps1';


const WAS_REGISTERED_STORAGE_KEY = 'dardcor-chat.terminalToDebugging.registered';


const DARDCOR_DEBUG_NONCE_STORAGE_KEY = 'dardcor-chat.terminalToDebugging.nonce';
export const DARDCOR_DEBUG_NONCE_ENV_VAR = 'DARDCOR_DEBUG_NONCE';
export const DARDCOR_DEBUG_COMMAND = `dardcor-debug`;
const DEBUG_COMMAND_JS = 'dardcorDebugCommand.js';

export class DardcorDebugCommandContribution extends Disposable implements vscode.UriHandler {
	private registerSerializer: Promise<void>;
	private readonly nonce: string;

	constructor(
		@IVSCodeExtensionContext private readonly context: IVSCodeExtensionContext,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILaunchConfigService private readonly launchConfigService: ILaunchConfigService,
		@IAuthenticationService private readonly authService: IAuthenticationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ITasksService private readonly tasksService: ITasksService,
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super();

		this.nonce = this.ensureNonce();
		this._register(vscode.window.registerUriHandler(this));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.TerminalToDebuggerEnabled.fullyQualifiedId)) {
				this.registerSerializer = this.registerSerializer.then(() => this.registerEnvironment());
			}
		}));
		this._register(vscode.commands.registerCommand('github.dardcor.chat.startDardcorDebugCommand', async () => {
			const term = vscode.window.createTerminal();
			term.show(false);
			term.sendText('dardcor-debug <your command here>', false);
		}));

		this.registerSerializer = this.registerEnvironment();
	}

	private async ensureTask(workspaceFolder: URI | undefined, def: vscode.TaskDefinition, handle: DardcorDebugCommandHandle): Promise<boolean> {
		if (!workspaceFolder) {
			handle.printLabel('red', needsWorkspaceFolderForTaskError());
			return false;
		}

		if (this.tasksService.hasTask(workspaceFolder, def)) {
			return true;
		}

		handle.printJson(def);
		const run = await handle.confirm(l10n.t`The model indicates the above task should be run before debugging. Do you want to save+run it?`, true);
		if (!run) {
			return false;
		}



		def.presentation ??= {};
		def.presentation.reveal = 'silent';
		await this.tasksService.ensureTask(workspaceFolder, def);

		return true;
	}

	handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
		const pipePath = process.platform === 'win32' ? '\\\\.\\pipe\\' + uri.path.slice(1) : uri.path;
		const cts = new CancellationTokenSource();

		const queryParams = new URLSearchParams(uri.query);
		const referrer = queryParams.get('referrer');







		this.telemetryService.sendMSFTTelemetryEvent('uriHandler', {
			referrer: referrer || 'unknown',
		});

		const socket = connect(pipePath, () => {
			this.logService.info(`Got a debug connection on ${pipePath}`);

			const rpc = new SimpleRPC(socket);
			const handle = new DardcorDebugCommandHandle(rpc);
			const { launchConfigService, authService, nonce } = this;
			const logService = this.logService;
			const exit = (code: number, error?: string) => handle.exit(code, error);
			const factory = this.instantiationService.createInstance(DardcorDebugCommandSessionFactory, {
				ensureTask: (wf, def) => this.ensureTask(wf || vscode.workspace.workspaceFolders?.[0].uri, def, handle),
				isGenerating: () => handle.printLabel('blue', l10n.t('Generating debug configuration...')),
				prompt: async (text, defaultValue) =>
					handle.question(text, defaultValue).then(r => r || defaultValue),
			});

			rpc.registerMethod('start', async function start(opts: IStartOptions): Promise<void> {
				if (!opts || opts.nonce !== nonce) {

					logService.warn(`Rejected debug connection on ${pipePath}: nonce mismatch`);
					socket.destroy();
					cts.dispose(true);
					return;
				}
				if (!authService.dardcorToken) {
					await authService.getGitHubSession('any', { createIfNone: { detail: l10n.t('Sign in to use Dardcor debug.') } });
				}
				const result = await factory.start(opts, cts.token);

				switch (result.kind) {
					case StartResultKind.NoConfig:
						await handle.printLabel('red', l10n.t`Could not create a launch configuration: ${result.text}`);
						await exit(1);
						break;
					case StartResultKind.Ok:
						if (opts.printOnly) {
							await handle.output('stdout', JSON.stringify(result.config, undefined, 2).replaceAll('\n', '\r\n'));
							await exit(0);
						} else if (opts.save) {
							handle.confirm(l10n.t('Configuration saved, debug now?'), true).then(debug => {
								if (debug) {
									vscode.debug.startDebugging(result.folder && vscode.workspace.getWorkspaceFolder(result.folder), result.config);
								}
								exit(0);
							});
						} else {
							handleDebugSession(
								launchConfigService,
								result.folder && vscode.workspace.getWorkspaceFolder(result.folder),
								{
									...result.config,
									internalConsoleOptions: 'neverOpen',
								},
								handle,
								opts.once,
								newOpts => start({ ...opts, ...newOpts }),
							);
						}
						break;
					case StartResultKind.Cancelled:
						exit(1);
						break;
					case StartResultKind.NeedExtension:
						handle.confirm(l10n.t`We generated a "${result.debugType}" debug configuration, but you don't have an extension installed for that. Do you want to look for one?`, true).then(search => {
							if (search) {
								vscode.commands.executeCommand('workbench.extensions.search', `@category:debuggers ${result.debugType}`);
							}
							exit(0);
						});
						break;
					default:
						assertNever(result);
				}
			});
		});

		socket.on('error', e => {
			this.logService.error(`Error connecting to debug client on ${pipePath}: ${e}`);
			cts.dispose(true);
		});

		socket.on('end', () => {
			cts.dispose(true);
		});
	}

	private getVersionNonce() {
		if (this.context.extensionMode !== vscode.ExtensionMode.Production) {
			return String(Date.now());
		}

		const extensionInfo = vscode.extensions.getExtension(EXTENSION_ID);
		return (extensionInfo?.packageJSON.version ?? String(Date.now())) + '/' + vscode.env.remoteName;
	}

	private ensureNonce(): string {
		let nonce = this.context.workspaceState.get<string>(DARDCOR_DEBUG_NONCE_STORAGE_KEY);
		if (!nonce || typeof nonce !== 'string' || nonce.length < 32) {
			nonce = randomBytes(16).toString('hex');
			this.context.workspaceState.update(DARDCOR_DEBUG_NONCE_STORAGE_KEY, nonce);
		}

		if (this.context.environmentVariableCollection.get(DARDCOR_DEBUG_NONCE_ENV_VAR)?.value !== nonce) {
			this.context.environmentVariableCollection.replace(DARDCOR_DEBUG_NONCE_ENV_VAR, nonce);
		}

		return nonce;
	}

	private async registerEnvironment() {
		const enabled = this.configurationService.getConfig(ConfigKey.TerminalToDebuggerEnabled);
		const globalStorageUri = this.context.globalStorageUri;
		if (!globalStorageUri) {

			return;
		}

		const storageLocation = path.join(this.context.globalStorageUri.fsPath, 'debugCommand');
		const previouslyStoredAt = this.context.globalState.get<{
			location: string;
			version: string;
		}>(WAS_REGISTERED_STORAGE_KEY);

		const versionNonce = this.getVersionNonce();
		if (!enabled) {
			if (previouslyStoredAt) {

				this.terminalService.removePathContribution('dardcor-debug');
				await fs.rm(previouslyStoredAt.location, { recursive: true, force: true });
			}
		} else if (!previouslyStoredAt) {

			this.terminalService.contributePath('dardcor-debug', storageLocation, { command: DARDCOR_DEBUG_COMMAND });
			await this.fillStoragePath(storageLocation);
		} else if (previouslyStoredAt.version !== versionNonce) {

			this.terminalService.contributePath('dardcor-debug', storageLocation, { command: DARDCOR_DEBUG_COMMAND });
			await this.fillStoragePath(storageLocation);
		} else if (enabled) {

			this.terminalService.contributePath('dardcor-debug', storageLocation, { command: DARDCOR_DEBUG_COMMAND });
		}

		this.context.globalState.update(WAS_REGISTERED_STORAGE_KEY, enabled ? {
			location: storageLocation,
			version: versionNonce,
		} : undefined);
	}

	private async fillStoragePath(storagePath: string) {
		const callbackUri = vscode.Uri.from({
			scheme: vscode.env.uriScheme,
			authority: EXTENSION_ID,
		});

		let remoteCommand = '';
		if (vscode.env.remoteName) {
			remoteCommand = (vscode.env.appName.includes('Insider') ? 'code-insiders' : 'code') + ' --openExternal ';
		}

		await fs.mkdir(storagePath, { recursive: true });

		if (process.platform === 'win32') {
			const ps1Path = path.join(storagePath, `${DARDCOR_DEBUG_COMMAND}.ps1`);
			await fs.writeFile(ps1Path, powershellScript
				.replaceAll('__CALLBACK_URL_PLACEHOLDER__', callbackUri)
				.replaceAll('__REMOTE_COMMAND_PLACEHOLDER__', remoteCommand));
			await fs.writeFile(path.join(storagePath, `${DARDCOR_DEBUG_COMMAND}.bat`), makeBatScript(ps1Path));
		} else {
			const shPath = path.join(storagePath, DARDCOR_DEBUG_COMMAND);
			await fs.writeFile(shPath, makeShellScript(remoteCommand, storagePath, callbackUri));
			await fs.chmod(shPath, 0o750);
		}

		await fs.copyFile(path.join(__dirname, DEBUG_COMMAND_JS), path.join(storagePath, DEBUG_COMMAND_JS));
	}
}

const makeShellScript = (remoteCommand: string, dir: string, callbackUri: vscode.Uri) => `#!/bin/sh
unset NODE_OPTIONS
ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${path.join(dir, DEBUG_COMMAND_JS)}" "${callbackUri}" "${remoteCommand}" "$@"`;

const makeBatScript = (ps1Path: string) => `@echo off
powershell -ExecutionPolicy Bypass -File "${ps1Path}" %*
`;
