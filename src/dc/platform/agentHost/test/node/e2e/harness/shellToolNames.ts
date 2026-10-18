/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const SHELL_TOOL_PREFIXES = ['', 'read_', 'write_', 'stop_', 'list_'] as const;
const SHELL_TOOL_PLACEHOLDERS = new Map<string, string>();
for (const prefix of SHELL_TOOL_PREFIXES) {
	const placeholder = `\${${prefix}shell}`;
	SHELL_TOOL_PLACEHOLDERS.set(`${prefix}bash`, placeholder);
	SHELL_TOOL_PLACEHOLDERS.set(`${prefix}powershell`, placeholder);
}
SHELL_TOOL_PLACEHOLDERS.set('bash_shutdown', '${shell_shutdown}');
SHELL_TOOL_PLACEHOLDERS.set('powershell_shutdown', '${shell_shutdown}');

export function normalizeShellToolNameForCapture(toolName: string): string {
	return SHELL_TOOL_PLACEHOLDERS.get(toolName) ?? toolName;
}

export function expandShellToolName(toolName: string, platform: NodeJS.Platform = process.platform): string {
	const match = /^\$\{(?<prefix>read_|write_|stop_|list_)?shell(?<shutdown>_shutdown)?\}$/.exec(toolName);
	if (!match) {
		return toolName;
	}
	const shell = platform === 'win32' ? 'powershell' : 'bash';
	return match.groups?.shutdown ? `${shell}_shutdown` : `${match.groups?.prefix ?? ''}${shell}`;
}
