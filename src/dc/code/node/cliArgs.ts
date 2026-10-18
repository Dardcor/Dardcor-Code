/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function combineUriFlags(args: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--') {
			result.push(...args.slice(i));
			break;
		}
		if ((arg === '--folder-uri' || arg === '--file-uri') && i + 1 < args.length && !args[i + 1].startsWith('-')) {
			result.push(`${arg}=${args[i + 1]}`);
			i++;
		} else {
			result.push(arg);
		}
	}
	return result;
}
