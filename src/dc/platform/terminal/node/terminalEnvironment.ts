/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { FileAccess } from '../../../base/common/network.js';
import * as path from '../../../base/common/path.js';
import { IProcessEnvironment, isMacintosh, isWindows } from '../../../base/common/platform.js';
import * as process from '../../../base/common/process.js';
import { format } from '../../../base/common/strings.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IShellLaunchConfig, ITerminalEnvironment, ITerminalProcessOptions, ShellIntegrationInjectionFailureReason } from '../common/terminal.js';
import { EnvironmentVariableMutatorType } from '../common/environmentVariable.js';
import { deserializeEnvironmentVariableCollections } from '../common/environmentVariableShared.js';
import { MergedEnvironmentVariableCollection } from '../common/environmentVariableCollection.js';
import { chmod, realpathSync, mkdirSync } from 'fs';
import { promisify } from 'util';
import { isString, SingleOrMany } from '../../../base/common/types.js';
import { getWindowsBuildNumberAsync } from '../../../base/node/windowsVersion.js';

export interface IShellIntegrationConfigInjection {
	readonly type: 'injection';
	readonly newArgs: string[] | undefined;
	readonly envMixin?: IProcessEnvironment;
	readonly filesToCopy?: {
		source: string;
		dest: string;
	}[];
}

export interface IShellIntegrationInjectionFailure {
	readonly type: 'failure';
	readonly reason: ShellIntegrationInjectionFailureReason;
}

export async function getShellIntegrationInjection(
	shellLaunchConfig: IShellLaunchConfig,
	options: ITerminalProcessOptions,
	env: ITerminalEnvironment | undefined,
	logService: ILogService,
	productService: IProductService,
	skipStickyBit: boolean = false
): Promise<IShellIntegrationConfigInjection | IShellIntegrationInjectionFailure> {
	// The global setting is disabled
	if (!options.shellIntegration.enabled) {
		return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.InjectionSettingDisabled };
	}
	if (!shellLaunchConfig.executable) {
		return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.NoExecutable };
	}
	if (shellLaunchConfig.isFeatureTerminal && !shellLaunchConfig.forceShellIntegration) {
		return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.FeatureTerminal };
	}
	if (shellLaunchConfig.ignoreShellIntegration) {
		return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.IgnoreShellIntegrationFlag };
	}
	const windowsBuildNumber = isWindows ? await getWindowsBuildNumberAsync() : 0;
	if (isWindows && windowsBuildNumber < 18309) {
		return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedWindowsBuild };
	}

	const originalArgs = shellLaunchConfig.args;
	const shell = process.platform === 'win32' ? path.basename(shellLaunchConfig.executable).toLowerCase() : path.basename(shellLaunchConfig.executable);
	const shellIntegrationScriptRoot = FileAccess.asFileUri('vs/workbench/contrib/terminal/common/scripts').fsPath;
	const type = 'injection';
	let newArgs: string[] | undefined;
	const envMixin: IProcessEnvironment = {
		'VSCODE_INJECTION': '1'
	};

	if (options.shellIntegration.nonce) {
		envMixin['VSCODE_NONCE'] = options.shellIntegration.nonce;
	}
	const scopedDownShellEnvs = ['PATH', 'VIRTUAL_ENV', 'HOME', 'SHELL', 'PWD'];
	if (shellLaunchConfig.shellIntegrationEnvironmentReporting) {
		if (isWindows) {
			const enableWindowsEnvReporting = options.windowsUseConptyDll || windowsBuildNumber >= 22631 && shell !== 'bash.exe';
			if (enableWindowsEnvReporting) {
				envMixin['VSCODE_SHELL_ENV_REPORTING'] = scopedDownShellEnvs.join(',');
			}
		} else {
			envMixin['VSCODE_SHELL_ENV_REPORTING'] = scopedDownShellEnvs.join(',');
		}
	}

	if (isWindows) {
		if (shell === 'pwsh.exe' || shell === 'powershell.exe') {
			envMixin['VSCODE_A11Y_MODE'] = options.isScreenReaderOptimized ? '1' : '0';

			if (!originalArgs || arePwshImpliedArgs(originalArgs)) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.WindowsPwsh);
			} else if (arePwshLoginArgs(originalArgs)) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.WindowsPwshLogin);
			}
			if (!newArgs) {
				return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedArgs };
			}
			newArgs = [...newArgs];
			newArgs[newArgs.length - 1] = format(newArgs[newArgs.length - 1], shellIntegrationScriptRoot, '');
			envMixin['VSCODE_STABLE'] = productService.quality === 'stable' ? '1' : '0';
			return { type, newArgs, envMixin };
		} else if (shell === 'bash.exe') {
			if (!originalArgs || originalArgs.length === 0) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.Bash);
			} else if (areZshBashFishLoginArgs(originalArgs)) {
				envMixin['VSCODE_SHELL_LOGIN'] = '1';
				addEnvMixinPathPrefix(options, envMixin, shell);
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.Bash);
			}
			if (!newArgs) {
				return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedArgs };
			}
			newArgs = [...newArgs];
			newArgs[newArgs.length - 1] = format(newArgs[newArgs.length - 1], shellIntegrationScriptRoot);
			envMixin['VSCODE_STABLE'] = productService.quality === 'stable' ? '1' : '0';
			return { type, newArgs, envMixin };
		}
		logService.warn(`Shell integration cannot be enabled for executable "${shellLaunchConfig.executable}" and args`, shellLaunchConfig.args);
		return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedShell };
	}

	switch (shell) {
		case 'bash': {
			if (!originalArgs || originalArgs.length === 0) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.Bash);
			} else if (areZshBashFishLoginArgs(originalArgs)) {
				envMixin['VSCODE_SHELL_LOGIN'] = '1';
				addEnvMixinPathPrefix(options, envMixin, shell);
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.Bash);
			}
			if (!newArgs) {
				return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedArgs };
			}
			newArgs = [...newArgs];
			newArgs[newArgs.length - 1] = format(newArgs[newArgs.length - 1], shellIntegrationScriptRoot);
			envMixin['VSCODE_STABLE'] = productService.quality === 'stable' ? '1' : '0';
			return { type, newArgs, envMixin };
		}
		case 'fish': {
			if (!originalArgs || originalArgs.length === 0) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.Fish);
			} else if (areZshBashFishLoginArgs(originalArgs)) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.FishLogin);
			} else if (originalArgs === shellIntegrationArgs.get(ShellIntegrationExecutable.Fish) || originalArgs === shellIntegrationArgs.get(ShellIntegrationExecutable.FishLogin)) {
				newArgs = originalArgs;
			}
			if (!newArgs) {
				return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedArgs };
			}

			addEnvMixinPathPrefix(options, envMixin, shell);

			newArgs = [...newArgs];
			newArgs[newArgs.length - 1] = format(newArgs[newArgs.length - 1], shellIntegrationScriptRoot);
			return { type, newArgs, envMixin };
		}
		case 'pwsh': {
			if (!originalArgs || arePwshImpliedArgs(originalArgs)) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.Pwsh);
			} else if (arePwshLoginArgs(originalArgs)) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.PwshLogin);
			}
			if (!newArgs) {
				return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedArgs };
			}
			newArgs = [...newArgs];
			newArgs[newArgs.length - 1] = format(newArgs[newArgs.length - 1], shellIntegrationScriptRoot, '');
			envMixin['VSCODE_STABLE'] = productService.quality === 'stable' ? '1' : '0';
			return { type, newArgs, envMixin };
		}
		case 'zsh': {
			if (!originalArgs || originalArgs.length === 0) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.Zsh);
			} else if (areZshBashFishLoginArgs(originalArgs)) {
				newArgs = shellIntegrationArgs.get(ShellIntegrationExecutable.ZshLogin);
				addEnvMixinPathPrefix(options, envMixin, shell);
			} else if (originalArgs === shellIntegrationArgs.get(ShellIntegrationExecutable.Zsh) || originalArgs === shellIntegrationArgs.get(ShellIntegrationExecutable.ZshLogin)) {
				newArgs = originalArgs;
			}
			if (!newArgs) {
				return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedArgs };
			}
			newArgs = [...newArgs];
			newArgs[newArgs.length - 1] = format(newArgs[newArgs.length - 1], shellIntegrationScriptRoot);

			let username: string;
			try {
				username = os.userInfo().username;
			} catch {
				username = 'unknown';
			}

			const realTmpDir = realpathSync(os.tmpdir());
			const zdotdir = path.join(realTmpDir, `${username}-${productService.applicationName}-zsh`);

			if (!skipStickyBit) {
				try {
					const chmodAsync = promisify(chmod);
					await chmodAsync(zdotdir, 0o1700);
				} catch (err) {
					if (!err.message.includes('ENOENT')) {
						logService.error(`Failed to set sticky bit on ${zdotdir}: ${err}`);
						return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.FailedToSetStickyBit };
					}
					try {
						mkdirSync(zdotdir, { recursive: true });
					} catch (err) {
						logService.error(`Failed to create zdotdir at ${zdotdir}: ${err}`);
						return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.FailedToCreateTmpDir };
					}
					try {
						const chmodAsync = promisify(chmod);
						await chmodAsync(zdotdir, 0o1700);
					} catch (err) {
						logService.error(`Failed to set sticky bit on ${zdotdir}: ${err}`);
						return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.FailedToSetStickyBit };
					}
				}
			}
			envMixin['ZDOTDIR'] = zdotdir;
			const userZdotdir = env?.ZDOTDIR ?? os.homedir() ?? `~`;
			envMixin['USER_ZDOTDIR'] = userZdotdir;
			const filesToCopy: IShellIntegrationConfigInjection['filesToCopy'] = [];
			filesToCopy.push({
				source: path.join(shellIntegrationScriptRoot, 'shellIntegration-rc.zsh'),
				dest: path.join(zdotdir, '.zshrc')
			});
			filesToCopy.push({
				source: path.join(shellIntegrationScriptRoot, 'shellIntegration-profile.zsh'),
				dest: path.join(zdotdir, '.zprofile')
			});
			filesToCopy.push({
				source: path.join(shellIntegrationScriptRoot, 'shellIntegration-env.zsh'),
				dest: path.join(zdotdir, '.zshenv')
			});
			filesToCopy.push({
				source: path.join(shellIntegrationScriptRoot, 'shellIntegration-login.zsh'),
				dest: path.join(zdotdir, '.zlogin')
			});
			return { type, newArgs, envMixin, filesToCopy };
		}
	}
	logService.warn(`Shell integration cannot be enabled for executable "${shellLaunchConfig.executable}" and args`, shellLaunchConfig.args);
	return { type: 'failure', reason: ShellIntegrationInjectionFailureReason.UnsupportedShell };
}

function addEnvMixinPathPrefix(options: ITerminalProcessOptions, envMixin: IProcessEnvironment, shell: string): void {
	if ((isMacintosh || shell === 'fish') && options.environmentVariableCollections) {
		const deserialized = deserializeEnvironmentVariableCollections(options.environmentVariableCollections);
		const merged = new MergedEnvironmentVariableCollection(deserialized);

		const pathEntry = merged.getVariableMap({ workspaceFolder: options.workspaceFolder }).get('PATH');
		const prependToPath: string[] = [];
		if (pathEntry) {
			for (const mutator of pathEntry) {
				if (mutator.type === EnvironmentVariableMutatorType.Prepend) {
					prependToPath.push(mutator.value);
				}
			}
		}

		if (prependToPath.length > 0) {
			envMixin['VSCODE_PATH_PREFIX'] = prependToPath.join('');
		}
	}
}

enum ShellIntegrationExecutable {
	WindowsPwsh = 'windows-pwsh',
	WindowsPwshLogin = 'windows-pwsh-login',
	Pwsh = 'pwsh',
	PwshLogin = 'pwsh-login',
	Zsh = 'zsh',
	ZshLogin = 'zsh-login',
	Bash = 'bash',
	Fish = 'fish',
	FishLogin = 'fish-login',
}

const shellIntegrationArgs: Map<ShellIntegrationExecutable, string[]> = new Map();
shellIntegrationArgs.set(ShellIntegrationExecutable.WindowsPwsh, ['-noexit', '-command', 'try { . \"{0}\\shellIntegration.ps1\" } catch {}{1}']);
shellIntegrationArgs.set(ShellIntegrationExecutable.WindowsPwshLogin, ['-l', '-noexit', '-command', 'try { . \"{0}\\shellIntegration.ps1\" } catch {}{1}']);
shellIntegrationArgs.set(ShellIntegrationExecutable.Pwsh, ['-noexit', '-command', '. "{0}/shellIntegration.ps1"{1}']);
shellIntegrationArgs.set(ShellIntegrationExecutable.PwshLogin, ['-l', '-noexit', '-command', '. "{0}/shellIntegration.ps1"']);
shellIntegrationArgs.set(ShellIntegrationExecutable.Zsh, ['-i']);
shellIntegrationArgs.set(ShellIntegrationExecutable.ZshLogin, ['-il']);
shellIntegrationArgs.set(ShellIntegrationExecutable.Bash, ['--init-file', '{0}/shellIntegration-bash.sh']);
shellIntegrationArgs.set(ShellIntegrationExecutable.Fish, ['--init-command', 'source "{0}/shellIntegration.fish"']);
shellIntegrationArgs.set(ShellIntegrationExecutable.FishLogin, ['-l', '--init-command', 'source "{0}/shellIntegration.fish"']);
const pwshLoginArgs = ['-login', '-l'];
const shLoginArgs = ['--login', '-l'];
const shInteractiveArgs = ['-i', '--interactive'];
const pwshImpliedArgs = ['-nol', '-nologo'];

function arePwshLoginArgs(originalArgs: SingleOrMany<string>): boolean {
	if (isString(originalArgs)) {
		return pwshLoginArgs.includes(originalArgs.toLowerCase());
	} else {
		return originalArgs.length === 1 && pwshLoginArgs.includes(originalArgs[0].toLowerCase()) ||
			(originalArgs.length === 2 &&
				(((pwshLoginArgs.includes(originalArgs[0].toLowerCase())) || pwshLoginArgs.includes(originalArgs[1].toLowerCase())))
				&& ((pwshImpliedArgs.includes(originalArgs[0].toLowerCase())) || pwshImpliedArgs.includes(originalArgs[1].toLowerCase())));
	}
}

function arePwshImpliedArgs(originalArgs: SingleOrMany<string>): boolean {
	if (isString(originalArgs)) {
		return pwshImpliedArgs.includes(originalArgs.toLowerCase());
	} else {
		return originalArgs.length === 0 || originalArgs?.length === 1 && pwshImpliedArgs.includes(originalArgs[0].toLowerCase());
	}
}

function areZshBashFishLoginArgs(originalArgs: SingleOrMany<string>): boolean {
	if (!isString(originalArgs)) {
		originalArgs = originalArgs.filter(arg => !shInteractiveArgs.includes(arg.toLowerCase()));
	}
	return isString(originalArgs) && shLoginArgs.includes(originalArgs.toLowerCase())
		|| !isString(originalArgs) && originalArgs.length === 1 && shLoginArgs.includes(originalArgs[0].toLowerCase());
}

const sensitiveEnvVarNames = /^(?:.*_)?(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|PRIVATE_?KEY|ACCESS_?KEY|CLIENT_?SECRET|APIKEY)(?:_.*)?$/i;

const secretValuePatterns = [
	/^eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+$/,
	/^gh[psuro]_[a-zA-Z0-9]{36}$/,
	/^github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}$/,
	/^AIza[A-Za-z0-9_\-]{35}$/,
	/^xox[pbar]\-[A-Za-z0-9\-]+$/,
	/^[a-zA-Z0-9]{32,}$/,
];

export function sanitizeEnvForLogging(env: IProcessEnvironment | undefined): IProcessEnvironment | undefined {
	if (!env) {
		return env;
	}
	const sanitized: IProcessEnvironment = {};
	for (const key of Object.keys(env)) {
		const value = env[key];
		if (value === undefined) {
			continue;
		}
		if (sensitiveEnvVarNames.test(key)) {
			sanitized[key] = '<REDACTED>';
			continue;
		}
		let isSecret = false;
		for (const pattern of secretValuePatterns) {
			if (pattern.test(value)) {
				isSecret = true;
				break;
			}
		}
		sanitized[key] = isSecret ? '<REDACTED>' : value;
	}
	return sanitized;
}
