/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import type { IProductConfiguration } from './dc/base/common/product.js';

const require = createRequire(import.meta.url);
const isWindows = process.platform === 'win32';

if (process.platform === 'linux') {
	Buffer.poolSize = 8 * 1024;
}

Error.stackTraceLimit = 100;

if (!process.env['DCCODE_HANDLES_SIGPIPE'] && !process.env['VSCODE_HANDLES_SIGPIPE']) {
	let didLogAboutSIGPIPE = false;
	process.on('SIGPIPE', () => {
		if (!didLogAboutSIGPIPE) {
			didLogAboutSIGPIPE = true;
			console.error(new Error(`Unexpected SIGPIPE`));
		}
	});
}

function setupCurrentWorkingDirectory(): void {
	try {

		if (typeof process.env['DCCODE_CWD'] !== 'string') {
			process.env['DCCODE_CWD'] = process.cwd();
		}
		if (typeof process.env['VSCODE_CWD'] !== 'string') {
			process.env['VSCODE_CWD'] = process.env['DCCODE_CWD'];
		}

		if (process.platform === 'win32') {
			process.chdir(path.dirname(process.execPath));
		}
	} catch (err) {
		console.error(err);
	}
}

setupCurrentWorkingDirectory();

function enableASARSupport(): void {
	if (!process.env['ELECTRON_RUN_AS_NODE'] && !process.versions['electron']) {
		return;
	}

	if (process.env['DCCODE_DEV'] || process.env['VSCODE_DEV']) {
		return;
	}

	const normalizeDriveLetter = (p: string): string => {
		if (isWindows && p.length >= 2 && p.charCodeAt(1) === 58 ) {
			const code = p.charCodeAt(0);
			if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
				return p[0].toLowerCase() + p.slice(1);
			}
		}
		return p;
	};

	const NODE_MODULES_PATH = normalizeDriveLetter(path.join(import.meta.dirname, '../node_modules'));

	const Module = require('node:module') as typeof import('node:module') & {
		_resolveLookupPaths: (request: string, parent: unknown) => string[] | null;
	};

	const originalResolveLookupPaths = Module._resolveLookupPaths;
	Module._resolveLookupPaths = function (request: string, parent: unknown): string[] | null {
		const paths = originalResolveLookupPaths(request, parent);
		if (Array.isArray(paths)) {
			for (let i = 0, len = paths.length; i < len; i++) {
				if (normalizeDriveLetter(paths[i]) === NODE_MODULES_PATH) {
					paths.splice(i, 0, `${paths[i]}.asar`);
					break;
				}
			}
		}

		return paths;
	};
}

enableASARSupport();

export function devInjectNodeModuleLookupPath(injectPath: string): void {
	if (!process.env['DCCODE_DEV'] && !process.env['VSCODE_DEV']) {
		return;
	}

	if (!injectPath) {
		throw new Error('Missing injectPath');
	}

	const Module = require('node:module');
	Module.register('./bootstrap-import.js', { parentURL: import.meta.url, data: injectPath });
}

export function removeGlobalNodeJsModuleLookupPaths(): void {
	if (typeof process?.versions?.electron === 'string') {
		return; // Electron disables global search paths in https://github.com/electron/electron/blob/3186c2f0efa92d275dc3d57b5a14a60ed3846b0e/shell/common/node_bindings.cc#L653
	}

	const Module = require('module');
	const globalPaths = Module.globalPaths;

	const originalResolveLookupPaths = Module._resolveLookupPaths;

	Module._resolveLookupPaths = function (moduleName: string, parent: unknown): string[] {
		const paths = originalResolveLookupPaths(moduleName, parent);
		if (Array.isArray(paths)) {
			let commonSuffixLength = 0;
			while (commonSuffixLength < paths.length && paths[paths.length - 1 - commonSuffixLength] === globalPaths[globalPaths.length - 1 - commonSuffixLength]) {
				commonSuffixLength++;
			}

			return paths.slice(0, paths.length - commonSuffixLength);
		}

		return paths;
	};

	const originalNodeModulePaths = Module._nodeModulePaths;
	Module._nodeModulePaths = function (from: string): string[] {
		let paths: string[] = originalNodeModulePaths(from);
		if (!isWindows) {
			return paths;
		}

		const isDrive = (p: string) => p.length >= 3 && p.endsWith(':\\');

		if (!isDrive(from)) {
			paths = paths.filter(p => !isDrive(path.dirname(p)));
		}

		if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
			const userDir = path.dirname(path.join(process.env.HOMEDRIVE, process.env.HOMEPATH));

			const isUsersDir = (p: string) => path.relative(p, userDir).length === 0;

			if (!isUsersDir(from)) {
				paths = paths.filter(p => !isUsersDir(path.dirname(p)));
			}
		}

		return paths;
	};
}

export function configurePortable(product: Partial<IProductConfiguration>): { portableDataPath: string; isPortable: boolean } {
	const appRoot = path.dirname(import.meta.dirname);

	function getApplicationPath(): string {
		if (process.env['DCCODE_DEV'] || process.env['VSCODE_DEV']) {
			return appRoot;
		}

		if (process.platform === 'darwin') {
			return path.dirname(path.dirname(path.dirname(appRoot)));
		}

		if (process.platform === 'win32' && product.win32VersionedUpdate) {
			return path.dirname(path.dirname(path.dirname(appRoot)));
		}

		return path.dirname(path.dirname(appRoot));
	}

	function getPortableDataPath(): string {
		const portable = process.env['DCCODE_PORTABLE'] || process.env['VSCODE_PORTABLE'];
		if (portable) {
			return portable;
		}

		if (process.platform === 'win32' || process.platform === 'linux') {
			return path.join(getApplicationPath(), 'data');
		}

		const portableDataName = product.portable || `${product.applicationName}-portable-data`;
		return path.join(path.dirname(getApplicationPath()), portableDataName);
	}

	const portableDataPath = getPortableDataPath();
	const isPortable = !('target' in product) && fs.existsSync(portableDataPath);
	const portableTempPath = path.join(portableDataPath, 'tmp');
	const isTempPortable = isPortable && fs.existsSync(portableTempPath);

	if (isPortable) {
		process.env['DCCODE_PORTABLE'] = process.env['VSCODE_PORTABLE'] = portableDataPath;
	} else {
		delete process.env['DCCODE_PORTABLE'];
		delete process.env['VSCODE_PORTABLE'];
	}

	if (isTempPortable) {
		if (process.platform === 'win32') {
			process.env['TMP'] = portableTempPath;
			process.env['TEMP'] = portableTempPath;
		} else {
			process.env['TMPDIR'] = portableTempPath;
		}
	}

	return {
		portableDataPath,
		isPortable
	};
}
