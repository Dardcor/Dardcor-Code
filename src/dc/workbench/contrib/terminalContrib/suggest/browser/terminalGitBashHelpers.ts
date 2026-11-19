/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function gitBashToWindowsPath(path: string, driveLetter?: string): string {
	const systemDrive = (driveLetter || 'C:').toUpperCase();
	if (path === '/') {
		return `${systemDrive}\\`;
	}
	const match = path.match(/^\/([a-zA-Z])(\/.*)?$/);
	if (match) {
		const drive = match[1].toUpperCase();
		const rest = match[2] ? match[2].replace(/\//g, '\\') : '\\';
		return `${drive}:${rest}`;
	}
	return path.replace(/\//g, '\\');
}

export function windowsToGitBashPath(path: string): string {
	return path
		.replace(/^[a-zA-Z]:\\/, match => `/${match[0].toLowerCase()}/`)
		.replace(/\\/g, '/');
}
