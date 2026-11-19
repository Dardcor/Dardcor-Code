/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment, isLinux } from './platform.js';

export interface CommandOptions {
	cwd?: string;

	env?: { [key: string]: string };
}

export interface Executable {
	command: string;

	isShellCommand: boolean;

	args: string[];

	options?: CommandOptions;
}

export interface ForkOptions extends CommandOptions {
	execArgv?: string[];
}

export const enum Source {
	stdout,
	stderr
}

export interface SuccessData {
	error?: Error;
	cmdCode?: number;
	terminated?: boolean;
}

export interface ErrorData {
	error?: Error;
	terminated?: boolean;
	stdout?: string;
	stderr?: string;
}

export interface TerminateResponse {
	success: boolean;
	code?: TerminateResponseCode;
	error?: any;
}

export const enum TerminateResponseCode {
	Success = 0,
	Unknown = 1,
	AccessDenied = 2,
	ProcessNotFound = 3,
}

export interface ProcessItem {
	name: string;
	cmd: string;
	pid: number;
	ppid: number;
	load: number;
	mem: number;

	children?: ProcessItem[];
}

export function sanitizeProcessEnvironment(env: IProcessEnvironment, ...preserve: string[]): void {
	const set = preserve.reduce<Record<string, boolean>>((set, key) => {
		set[key] = true;
		return set;
	}, {});
	const keysToRemove = [
		/^ELECTRON_.+$/,
		/^VSCODE_(?!(PORTABLE|SHELL_LOGIN|ENV_REPLACE|ENV_APPEND|ENV_PREPEND)).+$/,
		/^SNAP(|_.*)$/,
		/^GDK_PIXBUF_.+$/,
	];
	const envKeys = Object.keys(env);
	envKeys
		.filter(key => !set[key])
		.forEach(envKey => {
			for (let i = 0; i < keysToRemove.length; i++) {
				if (envKey.search(keysToRemove[i]) !== -1) {
					delete env[envKey];
					break;
				}
			}
		});
}

export function removeDangerousEnvVariables(env: IProcessEnvironment | undefined): void {
	if (!env) {
		return;
	}

	delete env['DEBUG'];

	delete env['NODE_OPTIONS'];

	if (isLinux) {
		delete env['LD_PRELOAD'];
	}
}
