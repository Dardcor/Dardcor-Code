/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ITerminalFormatMessageOptions {
	excludeLeadingNewLine?: boolean;
	loudFormatting?: boolean;
}

export function formatMessageForTerminal(message: string, options: ITerminalFormatMessageOptions = {}): string {
	let result = '';
	if (!options.excludeLeadingNewLine) {
		result += '\r\n';
	}
	result += '\x1b[0m\x1b[7m * ';
	if (options.loudFormatting) {
		result += '\x1b[0;104m';
	} else {
		result += '\x1b[0m';
	}
	result += ` ${message} \x1b[0m\n\r`;
	return result;
}
