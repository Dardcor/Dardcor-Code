/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogEntryLike } from '../executionGraph.js';
import { Trace, TraceContext } from './trace.js';

export interface ITraceLogger {
	log(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	logRun<T>(fn: () => T): T;
}

export interface ITraceLogEntry extends LogEntryLike {
	readonly trace: Trace;
	readonly level: 'log' | 'warn' | 'error';
}

export function createTraceLogger(buffer: ITraceLogEntry[]): ITraceLogger {
	const make = (level: 'log' | 'warn' | 'error') => (message: string) => {
		buffer.push({
			trace: TraceContext.instance.currentTrace(),
			level,
			message: level === 'log' ? message : `[${level}] ${message}`,
		});
	};
	const log = make('log');
	return {
		log,
		warn: make('warn'),
		error: make('error'),
		logRun<T>(fn: () => T): T {
			log(`run: ${_describeFn(fn)}`);
			return fn();
		},
	};
}

function _describeFn(fn: () => unknown): string {
	const src = fn.toString();
	const arrow = src.match(/^\s*(?:async\s+)?\(\s*\)\s*=>\s*([\s\S]+?)\s*$/);
	if (arrow) { return _collapseWhitespace(arrow[1]); }
	const fnExpr = src.match(/^\s*(?:async\s+)?function\s*\w*\s*\(\s*\)\s*\{\s*([\s\S]+?)\s*\}\s*$/);
	if (fnExpr) { return _collapseWhitespace(fnExpr[1]); }
	return _collapseWhitespace(src);
}

function _collapseWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}
