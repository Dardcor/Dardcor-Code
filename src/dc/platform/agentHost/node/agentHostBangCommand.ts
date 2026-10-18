/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const BANG_COMMAND_PREFIX = '!';

export function parseBangCommand(prompt: string): string | undefined {
	if (!prompt.startsWith(BANG_COMMAND_PREFIX)) {
		return undefined;
	}
	const command = prompt.slice(BANG_COMMAND_PREFIX.length).trim();
	return command.length > 0 ? command : undefined;
}
