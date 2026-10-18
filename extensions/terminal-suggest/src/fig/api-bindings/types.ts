/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface EnvironmentVariable {
	key: string;
	value?: string;
}

export interface ShellContext {
	pid?: number;
	ttys?: string;
	processName?: string;
	currentWorkingDirectory?: string;
	sessionId?: string;
	integrationVersion?: number;
	terminal?: string;
	hostname?: string;
	shellPath?: string;
	/** the environment variables of the shell, note that only exported variables are included */
	environmentVariables?: EnvironmentVariable[];
	alias?: string;
}
