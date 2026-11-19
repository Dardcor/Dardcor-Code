/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function parseArgs(argv: string[]): Record<string, string> {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--')) {
			const key = argv[i].substring(2);
			if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
				args[key] = argv[i + 1];
				i++;
			} else {
				args[key] = 'true';
			}
		}
	}
	return args;
}
