/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem, OS } from '../../../base/common/platform.js';
import { IShellLaunchConfig, TerminalShellType, PosixShellType, WindowsShellType, GeneralShellType } from './terminal.js';

export function escapeNonWindowsPath(path: string, shellType?: TerminalShellType): string {
	let newPath = path;
	if (newPath.includes('\\')) {
		newPath = newPath.replace(/\\/g, '\\\\');
	}

	interface ShellEscapeConfig {
		bothQuotes: (path: string) => string;
		singleQuotes: (path: string) => string;
		noSingleQuotes: (path: string) => string;
	}

	let escapeConfig: ShellEscapeConfig;
	switch (shellType) {
		case PosixShellType.Bash:
		case PosixShellType.Sh:
		case PosixShellType.Zsh:
		case WindowsShellType.GitBash:
			escapeConfig = {
				bothQuotes: (path) => `$'${path.replace(/'/g, '\\\'')}'`,
				singleQuotes: (path) => `'${path.replace(/'/g, '\\\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
		case PosixShellType.Fish:
			escapeConfig = {
				bothQuotes: (path) => `"${path.replace(/"/g, '\\"')}"`,
				singleQuotes: (path) => `'${path.replace(/'/g, '\\\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
		case GeneralShellType.PowerShell:
			escapeConfig = {
				bothQuotes: (path) => `"${path.replace(/"/g, '`"')}"`,
				singleQuotes: (path) => `'${path.replace(/'/g, '\'\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
		default:
			escapeConfig = {
				bothQuotes: (path) => `$'${path.replace(/'/g, '\\\'')}'`,
				singleQuotes: (path) => `'${path.replace(/'/g, '\\\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
	}

	const bannedChars = /[\`\$\|\&\>\~\#\!\^\*\;\<]/g;
	newPath = newPath.replace(bannedChars, '');

	if (newPath.includes('\'') && newPath.includes('"')) {
		return escapeConfig.bothQuotes(newPath);
	} else if (newPath.includes('\'')) {
		return escapeConfig.singleQuotes(newPath);
	} else {
		return escapeConfig.noSingleQuotes(newPath);
	}
}

export function collapseTildePath(path: string | undefined, userHome: string | undefined, separator: string): string {
	if (!path) {
		return '';
	}
	if (!userHome) {
		return path;
	}
	if (userHome.match(/[\/\\]$/)) {
		userHome = userHome.slice(0, userHome.length - 1);
	}
	const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
	const normalizedUserHome = userHome.replace(/\\/g, '/').toLowerCase();
	if (!normalizedPath.includes(normalizedUserHome)) {
		return path;
	}
	return `~${separator}${path.slice(userHome.length + 1)}`;
}

export function sanitizeCwd(cwd: string): string {
	if (cwd.match(/^['"].*['"]$/)) {
		cwd = cwd.substring(1, cwd.length - 1);
	}
	if (OS === OperatingSystem.Windows && cwd && cwd[1] === ':') {
		return cwd[0].toUpperCase() + cwd.substring(1);
	}
	return cwd;
}

export function shouldUseEnvironmentVariableCollection(slc: IShellLaunchConfig): boolean {
	return !slc.strictEnv;
}
