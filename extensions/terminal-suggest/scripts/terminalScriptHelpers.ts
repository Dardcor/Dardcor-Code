/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { platform } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);

export function cleanupText(text: string): string {
	let cleanedText = text.replace(/\x1b\[\d+m/g, '');

	const backspaceRegex = /.\x08./g;
	while (backspaceRegex.test(cleanedText)) {
		cleanedText = cleanedText.replace(backspaceRegex, match => match.charAt(2));
	}

	cleanedText = cleanedText.replace(/.\x08/g, '');

	cleanedText = cleanedText.replace(/_\b/g, '');

	return cleanedText;
}

export const copyright = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/`;

export function checkWindows(): void {
	if (platform() === 'win32') {
		console.error('\x1b[31mThis command is not supported on Windows\x1b[0m');
		process.exit(1);
	}
}
