/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'os';
import { NativeParsedArgs } from '../common/argv.js';
// eslint-disable-next-line local/code-import-patterns
import { resolve, isAbsolute, join } from 'path';

const cwd = process.env['VSCODE_CWD'] || process.cwd();

export function getUserDataPath(cliArgs: NativeParsedArgs, productName: string): string {
	const userDataPath = doGetUserDataPath(cliArgs, productName);
	const pathsToResolve = [userDataPath];

	if (!isAbsolute(userDataPath)) {
		pathsToResolve.unshift(cwd);
	}

	return resolve(...pathsToResolve);
}

function doGetUserDataPath(cliArgs: NativeParsedArgs, productName: string): string {

	const portablePath = process.env['VSCODE_PORTABLE'];
	if (portablePath) {
		return join(portablePath, 'user-data');
	}

	// 2. Support global VSCODE_APPDATA environment variable
	const appDataPath = process.env['VSCODE_APPDATA'];
	if (appDataPath) {
		return join(appDataPath, productName);
	}

	const cliPath = cliArgs['user-data-dir'];
	if (cliPath) {
		return cliPath;
	}

	return getDefaultUserDataPath(productName);
}

export function getDefaultUserDataPath(productName: string): string {
	let appDataPath: string | undefined;

	switch (process.platform) {
		case 'win32':
			appDataPath = process.env['APPDATA'];
			if (!appDataPath) {
				const userProfile = process.env['USERPROFILE'];
				if (typeof userProfile !== 'string') {
					throw new Error('Windows: Unexpected undefined %USERPROFILE% environment variable');
				}

				appDataPath = join(userProfile, 'AppData', 'Roaming');
			}
			break;
		case 'darwin':
			appDataPath = join(homedir(), 'Library', 'Application Support');
			break;
		case 'linux':
			appDataPath = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
			break;
		default:
			throw new Error('Platform not supported');
	}

	return join(appDataPath, productName);
}
