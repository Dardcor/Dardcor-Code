/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from './uri.js';

export interface IRemoteConsoleLog {
	type: string;
	severity: string;
	arguments: string;
}

export interface IStackArgument {
	__$stack: string;
}

export interface IStackFrame {
	uri: URI;
	line: number;
	column: number;
}

export function isRemoteConsoleLog(obj: unknown): obj is IRemoteConsoleLog {
	const entry = obj as IRemoteConsoleLog;

	return entry && typeof entry.type === 'string' && typeof entry.severity === 'string';
}

export function parse(entry: IRemoteConsoleLog): { args: any[]; stack?: string } {
	const args: any[] = [];
	let stack: string | undefined;

	try {
		const parsedArguments: any[] = JSON.parse(entry.arguments);

		const stackArgument = parsedArguments[parsedArguments.length - 1] as IStackArgument;
		if (stackArgument && stackArgument.__$stack) {
			parsedArguments.pop();
			stack = stackArgument.__$stack;
		}

		args.push(...parsedArguments);
	} catch (error) {
		args.push('Unable to log remote console arguments', entry.arguments);
	}

	return { args, stack };
}

export function getFirstFrame(entry: IRemoteConsoleLog): IStackFrame | undefined;
export function getFirstFrame(stack: string | undefined): IStackFrame | undefined;
export function getFirstFrame(arg0: IRemoteConsoleLog | string | undefined): IStackFrame | undefined {
	if (typeof arg0 !== 'string') {
		return getFirstFrame(parse(arg0!).stack);
	}

	const stack = arg0;
	if (stack) {
		const topFrame = findFirstFrame(stack);

		const matches = /at [^\/]*((?:(?:[a-zA-Z]+:)|(?:[\/])|(?:\\\\))(?:.+)):(\d+):(\d+)/.exec(topFrame || '');
		if (matches && matches.length === 4) {
			return {
				uri: URI.file(matches[1]),
				line: Number(matches[2]),
				column: Number(matches[3])
			};
		}
	}

	return undefined;
}

function findFirstFrame(stack: string | undefined): string | undefined {
	if (!stack) {
		return stack;
	}

	const newlineIndex = stack.indexOf('\n');
	if (newlineIndex === -1) {
		return stack;
	}

	return stack.substring(0, newlineIndex);
}

export function log(entry: IRemoteConsoleLog, label: string): void {
	const { args, stack } = parse(entry);

	const isOneStringArg = typeof args[0] === 'string' && args.length === 1;

	let topFrame = findFirstFrame(stack);
	if (topFrame) {
		topFrame = `(${topFrame.trim()})`;
	}

	let consoleArgs: string[] = [];

	if (typeof args[0] === 'string') {
		if (topFrame && isOneStringArg) {
			consoleArgs = [`%c[${label}] %c${args[0]} %c${topFrame}`, color('blue'), color(''), color('grey')];
		} else {
			consoleArgs = [`%c[${label}] %c${args[0]}`, color('blue'), color(''), ...args.slice(1)];
		}
	}

	else {
		consoleArgs = [`%c[${label}]%`, color('blue'), ...args];
	}

	if (topFrame && !isOneStringArg) {
		consoleArgs.push(topFrame);
	}

	// eslint-disable-next-line local/code-no-any-casts
	if (typeof (console as any)[entry.severity] !== 'function') {
		throw new Error('Unknown console method');
	}
	// eslint-disable-next-line local/code-no-any-casts
	(console as any)[entry.severity].apply(console, consoleArgs);
}

function color(color: string): string {
	return `color: ${color}`;
}
