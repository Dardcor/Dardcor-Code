/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { userInfo } from 'os';
import * as platform from '../common/platform.js';
import { getFirstAvailablePowerShellInstallation } from './powershell.js';
import * as processes from './processes.js';

export async function getSystemShell(os: platform.OperatingSystem, env: platform.IProcessEnvironment): Promise<string> {
	if (os === platform.OperatingSystem.Windows) {
		if (platform.isWindows) {
			return getSystemShellWindows();
		}
		return processes.getWindowsShell(env);
	}

	return getSystemShellUnixLike(os, env);
}

let _TERMINAL_DEFAULT_SHELL_UNIX_LIKE: string | null = null;
function getSystemShellUnixLike(os: platform.OperatingSystem, env: platform.IProcessEnvironment): string {
	if (platform.isLinux && os === platform.OperatingSystem.Macintosh || platform.isMacintosh && os === platform.OperatingSystem.Linux) {
		return '/bin/bash';
	}

	if (!_TERMINAL_DEFAULT_SHELL_UNIX_LIKE) {
		let unixLikeTerminal: string | undefined | null;
		if (platform.isWindows) {
			unixLikeTerminal = '/bin/bash';
		} else {
			unixLikeTerminal = env['SHELL'];

			if (!unixLikeTerminal) {
				try {
					unixLikeTerminal = userInfo().shell;
				} catch (err) { }
			}

			if (!unixLikeTerminal) {
				unixLikeTerminal = 'sh';
			}

			if (unixLikeTerminal === '/bin/false') {
				unixLikeTerminal = '/bin/bash';
			}
		}
		_TERMINAL_DEFAULT_SHELL_UNIX_LIKE = unixLikeTerminal;
	}
	return _TERMINAL_DEFAULT_SHELL_UNIX_LIKE;
}

let _TERMINAL_DEFAULT_SHELL_WINDOWS: string | null = null;
async function getSystemShellWindows(): Promise<string> {
	if (!_TERMINAL_DEFAULT_SHELL_WINDOWS) {
		_TERMINAL_DEFAULT_SHELL_WINDOWS = (await getFirstAvailablePowerShellInstallation())!.exePath;
	}
	return _TERMINAL_DEFAULT_SHELL_WINDOWS;
}
