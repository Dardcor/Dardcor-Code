/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as path from '../../../../base/common/path.js';
import { URI, uriToFsPath } from '../../../../base/common/uri.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationResolverService } from '../../../services/configurationResolver/common/configurationResolver.js';
import { sanitizeProcessEnvironment } from '../../../../base/common/processes.js';
import { IShellLaunchConfig, ITerminalBackend, ITerminalEnvironment, ShellIntegrationTimeoutOverride, TerminalSettingId, TerminalShellType, WindowsShellType } from '../../../../platform/terminal/common/terminal.js';
import { IProcessEnvironment, isWindows, isMacintosh, language, OperatingSystem } from '../../../../base/common/platform.js';
import { escapeNonWindowsPath, sanitizeCwd } from '../../../../platform/terminal/common/terminalEnvironment.js';
import { isNumber, isString } from '../../../../base/common/types.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export function mergeEnvironments(parent: IProcessEnvironment, other: ITerminalEnvironment | undefined): void {
	if (!other) {
		return;
	}

	if (isWindows) {
		for (const configKey in other) {
			let actualKey = configKey;
			for (const envKey in parent) {
				if (configKey.toLowerCase() === envKey.toLowerCase()) {
					actualKey = envKey;
					break;
				}
			}
			const value = other[configKey];
			if (value !== undefined) {
				_mergeEnvironmentValue(parent, actualKey, value);
			}
		}
	} else {
		Object.keys(other).forEach((key) => {
			const value = other[key];
			if (value !== undefined) {
				_mergeEnvironmentValue(parent, key, value);
			}
		});
	}
}

function _mergeEnvironmentValue(env: ITerminalEnvironment, key: string, value: string | null): void {
	if (isString(value)) {
		env[key] = value;
	} else {
		delete env[key];
	}
}

export function addTerminalEnvironmentKeys(env: IProcessEnvironment, version: string | undefined, locale: string | undefined, detectLocale: 'auto' | 'off' | 'on'): void {
	env['TERM_PROGRAM'] = 'vscode';
	if (version) {
		env['TERM_PROGRAM_VERSION'] = version;
	}
	if (shouldSetLangEnvVariable(env, detectLocale)) {
		env['LANG'] = getLangEnvVariable(locale);
	}
	env['COLORTERM'] = 'truecolor';
}

function mergeNonNullKeys(env: IProcessEnvironment, other: ITerminalEnvironment | undefined) {
	if (!other) {
		return;
	}
	for (const key of Object.keys(other)) {
		const value = other[key];
		if (value !== undefined && value !== null) {
			env[key] = value;
		}
	}
}

async function resolveConfigurationVariables(variableResolver: VariableResolver, env: ITerminalEnvironment): Promise<ITerminalEnvironment> {
	await Promise.all(Object.entries(env).map(async ([key, value]) => {
		if (isString(value)) {
			try {
				env[key] = await variableResolver(value);
			} catch (e) {
				env[key] = value;
			}
		}
	}));

	return env;
}

export function shouldSetLangEnvVariable(env: IProcessEnvironment, detectLocale: 'auto' | 'off' | 'on'): boolean {
	if (detectLocale === 'on') {
		return true;
	}
	if (detectLocale === 'auto') {
		const lang = env['LANG'];
		return !lang || (lang.search(/\.UTF\-8$/) === -1 && lang.search(/\.utf8$/) === -1 && lang.search(/\.euc.+/) === -1);
	}
	return false;
}

export function getLangEnvVariable(locale?: string): string {
	const parts = locale ? locale.split('-') : [];
	const n = parts.length;
	if (n === 0) {
		return 'en_US.UTF-8';
	}
	if (n === 1) {
		const languageVariants: { [key: string]: string } = {
			af: 'ZA',
			am: 'ET',
			be: 'BY',
			bg: 'BG',
			ca: 'ES',
			cs: 'CZ',
			da: 'DK',
			de: 'DE',
			el: 'GR',
			en: 'US',
			es: 'ES',
			et: 'EE',
			eu: 'ES',
			fi: 'FI',
			fr: 'FR',
			he: 'IL',
			hr: 'HR',
			hu: 'HU',
			hy: 'AM',
			is: 'IS',
			it: 'IT',
			ja: 'JP',
			kk: 'KZ',
			ko: 'KR',
			lt: 'LT',
			nl: 'NL',
			no: 'NO',
			pl: 'PL',
			pt: 'BR',
			ro: 'RO',
			ru: 'RU',
			sk: 'SK',
			sl: 'SI',
			sr: 'YU',
			sv: 'SE',
			tr: 'TR',
			uk: 'UA',
			zh: 'CN',
		};
		if (Object.prototype.hasOwnProperty.call(languageVariants, parts[0])) {
			parts.push(languageVariants[parts[0]]);
		}
	} else {
		parts[1] = parts[1].toUpperCase();
	}
	return parts.join('_') + '.UTF-8';
}

export async function getCwd(
	shell: IShellLaunchConfig,
	userHome: string | undefined,
	variableResolver: VariableResolver | undefined,
	root: URI | undefined,
	customCwd: string | undefined,
	logService?: ILogService
): Promise<string> {
	if (shell.cwd) {
		const unresolved = (typeof shell.cwd === 'object') ? shell.cwd.fsPath : shell.cwd;
		const resolved = await _resolveCwd(unresolved, variableResolver);
		return sanitizeCwd(resolved || unresolved);
	}

	let cwd: string | undefined;

	if (!shell.ignoreConfigurationCwd && customCwd) {
		if (variableResolver) {
			customCwd = await _resolveCwd(customCwd, variableResolver, logService);
		}
		if (customCwd) {
			if (path.isAbsolute(customCwd)) {
				cwd = customCwd;
			} else if (root) {
				cwd = path.join(root.fsPath, customCwd);
			}
		}
	}

	if (!cwd) {
		cwd = root ? root.fsPath : userHome || '';
	}

	return sanitizeCwd(cwd);
}

async function _resolveCwd(cwd: string, variableResolver: VariableResolver | undefined, logService?: ILogService): Promise<string | undefined> {
	if (variableResolver) {
		try {
			return await variableResolver(cwd);
		} catch (e) {
			logService?.error('Could not resolve terminal cwd', e);
			return undefined;
		}
	}
	return cwd;
}

export type VariableResolver = (str: string) => Promise<string>;

export function createVariableResolver(lastActiveWorkspace: IWorkspaceFolder | undefined, env: IProcessEnvironment, configurationResolverService: IConfigurationResolverService | undefined): VariableResolver | undefined {
	if (!configurationResolverService) {
		return undefined;
	}
	return (str) => configurationResolverService.resolveWithEnvironment(env, lastActiveWorkspace, str);
}

export async function createTerminalEnvironment(
	shellLaunchConfig: IShellLaunchConfig,
	envFromConfig: ITerminalEnvironment | undefined,
	variableResolver: VariableResolver | undefined,
	version: string | undefined,
	detectLocale: 'auto' | 'off' | 'on',
	baseEnv: IProcessEnvironment
): Promise<IProcessEnvironment> {
	const env: IProcessEnvironment = {};
	if (shellLaunchConfig.strictEnv) {
		mergeNonNullKeys(env, shellLaunchConfig.env);
	} else {
		mergeNonNullKeys(env, baseEnv);

		const allowedEnvFromConfig = { ...envFromConfig };

		if (variableResolver) {
			if (allowedEnvFromConfig) {
				await resolveConfigurationVariables(variableResolver, allowedEnvFromConfig);
			}
			if (shellLaunchConfig.env) {
				await resolveConfigurationVariables(variableResolver, shellLaunchConfig.env);
			}
		}

		if (isMacintosh) {
			if (env['VSCODE_NODE_OPTIONS']) {
				env['NODE_OPTIONS'] = env['VSCODE_NODE_OPTIONS'];
				delete env['VSCODE_NODE_OPTIONS'];
			}

			if (env['VSCODE_NODE_REPL_EXTERNAL_MODULE']) {
				env['NODE_REPL_EXTERNAL_MODULE'] = env['VSCODE_NODE_REPL_EXTERNAL_MODULE'];
				delete env['VSCODE_NODE_REPL_EXTERNAL_MODULE'];
			}
		}

		sanitizeProcessEnvironment(env, 'VSCODE_IPC_HOOK_CLI');

		mergeEnvironments(env, allowedEnvFromConfig);
		mergeEnvironments(env, shellLaunchConfig.env);

		addTerminalEnvironmentKeys(env, version, language, detectLocale);
	}
	return env;
}

export async function preparePathForShell(resource: string | URI, executable: string | undefined, title: string, shellType: TerminalShellType | undefined, backend: Pick<ITerminalBackend, 'getWslPath'> | undefined, os: OperatingSystem | undefined, isWindowsFrontend: boolean = isWindows): Promise<string> {
	let originalPath: string;
	if (isString(resource)) {
		originalPath = resource;
	} else {
		originalPath = resource.fsPath;
		if (isWindowsFrontend && os !== OperatingSystem.Windows) {
			originalPath = originalPath.replace(/\\/g, '\/');
		} else if (!isWindowsFrontend && os === OperatingSystem.Windows) {
			originalPath = originalPath.replace(/\//g, '\\');
		}
	}

	if (!executable) {
		return originalPath;
	}

	const hasSpace = originalPath.includes(' ');
	const hasParens = originalPath.includes('(') || originalPath.includes(')');

	const pathBasename = path.basename(executable, '.exe');
	const isPowerShell = pathBasename === 'pwsh' ||
		title === 'pwsh' ||
		pathBasename === 'powershell' ||
		title === 'powershell';

	if (isPowerShell && (hasSpace || originalPath.includes('\''))) {
		return `& '${originalPath.replace(/'/g, '\'\'')}'`;
	}

	if (hasParens && isPowerShell) {
		return `& '${originalPath}'`;
	}

	if (os === OperatingSystem.Windows) {
		if (shellType !== undefined) {
			if (shellType === WindowsShellType.GitBash) {
				return escapeNonWindowsPath(originalPath.replace(/\\/g, '/'), shellType);
			}
			else if (shellType === WindowsShellType.Wsl) {
				return backend?.getWslPath(originalPath, 'win-to-unix') || originalPath;
			}
			else if (hasSpace) {
				return `"${originalPath}"`;
			}
			return originalPath;
		}
		const lowerExecutable = executable.toLowerCase();
		if (lowerExecutable.includes('wsl') || (lowerExecutable.includes('bash.exe') && !lowerExecutable.toLowerCase().includes('git'))) {
			return backend?.getWslPath(originalPath, 'win-to-unix') || originalPath;
		} else if (hasSpace) {
			return `"${originalPath}"`;
		}
		return originalPath;
	}

	return escapeNonWindowsPath(originalPath, shellType);
}

export function getWorkspaceForTerminal(cwd: URI | string | undefined, workspaceContextService: IWorkspaceContextService, historyService: IHistoryService): IWorkspaceFolder | undefined {
	const cwdUri = isString(cwd) ? URI.parse(cwd) : cwd;
	let workspaceFolder = cwdUri ? workspaceContextService.getWorkspaceFolder(cwdUri) ?? undefined : undefined;
	if (!workspaceFolder) {
		const activeWorkspaceRootUri = historyService.getLastActiveWorkspaceRoot();
		workspaceFolder = activeWorkspaceRootUri ? workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri) ?? undefined : undefined;
	}
	return workspaceFolder;
}

export async function getUriLabelForShell(uri: URI | string, backend: Pick<ITerminalBackend, 'getWslPath'>, shellType?: TerminalShellType, os?: OperatingSystem, isWindowsFrontend: boolean = isWindows): Promise<string> {
	let path = isString(uri) ? uri : uri.fsPath;
	if (os === OperatingSystem.Windows) {
		if (shellType === WindowsShellType.Wsl) {
			return backend.getWslPath(path.replaceAll('/', '\\'), 'win-to-unix');
		} else if (shellType === WindowsShellType.GitBash) {
			return path.replaceAll('\\', '/').replace(/^([a-zA-Z]):\//, '/$1/');
		} else {
			path = isString(uri) ? path : uriToFsPath(uri, true);
			return !isWindowsFrontend ? path.replaceAll('/', '\\') : path;
		}
	} else {
		return isWindowsFrontend ? path.replaceAll('\\', '/') : path;
	}
}

export function getShellIntegrationTimeout(
	configurationService: IConfigurationService,
	siInjectionEnabled: boolean,
	isRemote: boolean,
	processReadyTimestamp?: number
): number {
	const timeoutValue = configurationService.getValue<unknown>(TerminalSettingId.ShellIntegrationTimeout);
	let timeoutMs: number;
	if (isNumber(timeoutValue) && timeoutValue === ShellIntegrationTimeoutOverride.DisableForTests) {
		timeoutMs = 0;
	} else if (!isNumber(timeoutValue) || timeoutValue < 0) {
		timeoutMs = siInjectionEnabled ? 5000 : (isRemote ? 3000 : 2000);
	} else if (timeoutValue === 0) {
		timeoutMs = 0;
	} else {
		timeoutMs = Math.max(timeoutValue, 500);
	}

	if (processReadyTimestamp !== undefined) {
		const elapsed = Date.now() - processReadyTimestamp;
		timeoutMs = Math.max(0, timeoutMs - elapsed);
	}

	return timeoutMs;
}
