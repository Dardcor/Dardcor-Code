/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { osIsWindows } from './os';
import * as fs from 'fs/promises';

export function isExecutable(filePath: string, windowsExecutableExtensions?: Set<string>): Promise<boolean> | boolean {
	if (osIsWindows()) {
		const extensions = windowsExecutableExtensions ?? defaultWindowsExecutableExtensionsSet;
		return hasWindowsExecutableExtension(filePath, extensions);
	}
	return isExecutableUnix(filePath);
}

export async function isExecutableUnix(filePath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(filePath);
		return (stats.mode & 0o100) !== 0;
	} catch (error) {
		return false;
	}
}

export const windowsDefaultExecutableExtensions: string[] = [
	'.exe',
	'.bat',
	'.cmd',
	'.com',

	'.msi',

	'.ps1',

	'.vbs',
	'.js',
	'.jar',
	'.py',
	'.rb',
	'.pl',
	'.sh',
];

const defaultWindowsExecutableExtensionsSet = new Set<string>();
for (const ext of windowsDefaultExecutableExtensions) {
	defaultWindowsExecutableExtensionsSet.add(ext);
}

export class WindowsExecutableExtensionsCache {
	private _rawConfig: { [key: string]: boolean | undefined } | undefined;
	private _cachedExtensions: Set<string> | undefined;

	constructor(rawConfig?: { [key: string]: boolean | undefined }) {
		this._rawConfig = rawConfig;
	}

	update(rawConfig: { [key: string]: boolean | undefined } | undefined): void {
		this._rawConfig = rawConfig;
		this._cachedExtensions = undefined;
	}

	getExtensions(): Set<string> {
		if (!this._cachedExtensions) {
			this._cachedExtensions = resolveWindowsExecutableExtensions(this._rawConfig);
		}
		return this._cachedExtensions;
	}
}

function hasWindowsExecutableExtension(filePath: string, extensions: Set<string>): boolean {
	const fileName = filePath.slice(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1);
	for (const ext of extensions) {
		if (fileName.endsWith(ext)) {
			return true;
		}
	}
	return false;
}

function resolveWindowsExecutableExtensions(configuredWindowsExecutableExtensions?: { [key: string]: boolean | undefined }): Set<string> {
	const extensions = new Set<string>();
	const configured = configuredWindowsExecutableExtensions ?? {};
	const excluded = new Set<string>();

	for (const [ext, value] of Object.entries(configured)) {
		if (value !== true) {
			excluded.add(ext);
		}
	}

	for (const ext of windowsDefaultExecutableExtensions) {
		if (!excluded.has(ext)) {
			extensions.add(ext);
		}
	}

	for (const [ext, value] of Object.entries(configured)) {
		if (value === true) {
			extensions.add(ext);
		}
	}

	return extensions;
}
