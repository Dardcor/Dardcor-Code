/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function redactPaths(input: string): string {
	return input
		.replace(/([\s|(]|file:\/\/)(\/[^\s]+)/g, '$1[redacted]')
		.replace(/([\s|(]|file:\/\/)([a-zA-Z]:[(\\|/){1,2}][^\s]+)/gi, '$1[redacted]')
		.replace(/([\s|(]|file:\/\/)(\\[^\s]+)/gi, '$1[redacted]');
}
