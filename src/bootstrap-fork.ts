/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as performance from './dc/base/common/performance.js';
import { removeGlobalNodeJsModuleLookupPaths, devInjectNodeModuleLookupPath } from './bootstrap-node.js';
import { bootstrapESM } from './bootstrap-esm.js';

performance.mark('code/fork/start');


function pipeLoggingToParent(): void {
	const MAX_STREAM_BUFFER_LENGTH = 1024 * 1024;
	const MAX_LENGTH = 100000;

	function safeToString(args: ArrayLike<unknown>): string {
		const seen: unknown[] = [];
		const argsArray: unknown[] = [];

		if (args.length) {
			for (let i = 0; i < args.length; i++) {
				let arg = args[i];

				if (typeof arg === 'undefined') {
					arg = 'undefined';
				}

				else if (arg instanceof Error) {
					const errorObj = arg;
					if (errorObj.stack) {
						arg = errorObj.stack;
					} else {
						arg = errorObj.toString();
					}
				}

				argsArray.push(arg);
			}
		}

		try {
			const res = JSON.stringify(argsArray, function (key, value: unknown) {

				if (isObject(value) || Array.isArray(value)) {
					if (seen.indexOf(value) !== -1) {
						return '[Circular]';
					}

					seen.push(value);
				}

				return value;
			});

			if (res.length > MAX_LENGTH) {
				return 'Output omitted for a large object that exceeds the limits';
			}

			return res;
		} catch (error) {
			return `Output omitted for an object that cannot be inspected ('${error.toString()}')`;
		}
	}

	function safeSend(arg: { type: string; severity: string; arguments: string }): void {
		try {
			if (process.send) {
				process.send(arg);
			}
		} catch (error) {
		}
	}

	function isObject(obj: unknown): boolean {
		return typeof obj === 'object'
			&& obj !== null
			&& !Array.isArray(obj)
			&& !(obj instanceof RegExp)
			&& !(obj instanceof Date);
	}

	function safeSendConsoleMessage(severity: 'log' | 'warn' | 'error', args: string): void {
		safeSend({ type: '__$console', severity, arguments: args });
	}

	function wrapConsoleMethod(method: 'log' | 'info' | 'warn' | 'error', severity: 'log' | 'warn' | 'error'): void {
		Object.defineProperty(console, method, {
			set: () => { },
			get: () => function () { safeSendConsoleMessage(severity, safeToString(arguments)); },
		});
	}

	function wrapStream(streamName: 'stdout' | 'stderr', severity: 'log' | 'warn' | 'error'): void {
		const stream = process[streamName];
		const original = stream.write;

		let buf = '';

		Object.defineProperty(stream, 'write', {
			set: () => { },
			get: () => (chunk: string | Buffer | Uint8Array, encoding: BufferEncoding | undefined, callback: ((err?: Error | null) => void) | undefined) => {
				buf += chunk.toString(encoding);
				const eol = buf.length > MAX_STREAM_BUFFER_LENGTH ? buf.length : buf.lastIndexOf('\n');
				if (eol !== -1) {
					console[severity](buf.slice(0, eol));
					buf = buf.slice(eol + 1);
				}

				original.call(stream, chunk, encoding, callback);
			},
		});
	}

	if (process.env['DCCODE_VERBOSE_LOGGING'] === 'true' || process.env['VSCODE_VERBOSE_LOGGING'] === 'true') {
		wrapConsoleMethod('info', 'log');
		wrapConsoleMethod('log', 'log');
		wrapConsoleMethod('warn', 'warn');
		wrapConsoleMethod('error', 'error');
	} else {
		console.log = function () { };
		console.warn = function () { };
		console.info = function () { };
		wrapConsoleMethod('error', 'error');
	}

	wrapStream('stderr', 'error');
	wrapStream('stdout', 'log');
}

function handleExceptions(): void {

	process.on('uncaughtException', function (err) {
		console.error('Uncaught Exception: ', err);
	});

	process.on('unhandledRejection', function (reason) {
		console.error('Unhandled Promise Rejection: ', reason);
	});
}

function terminateWhenParentTerminates(): void {
	const parentPid = Number(process.env['DCCODE_PARENT_PID'] || process.env['VSCODE_PARENT_PID']);

	if (typeof parentPid === 'number' && !isNaN(parentPid)) {
		setInterval(function () {
			try {
				process.kill(parentPid, 0);
			} catch (e) {
				process.exit();
			}
		}, 5000);
	}
}

function configureCrashReporter(): void {
	const crashReporterProcessType = process.env['DCCODE_CRASH_REPORTER_PROCESS_TYPE'] || process.env['VSCODE_CRASH_REPORTER_PROCESS_TYPE'];
	if (crashReporterProcessType) {
		try {
			//@ts-expect-error
			if (process['crashReporter'] && typeof process['crashReporter'].addExtraParameter === 'function' ) {
				//@ts-expect-error
				process['crashReporter'].addExtraParameter('processType', crashReporterProcessType);
			}
		} catch (error) {
			console.error(error);
		}
	}
}


configureCrashReporter();


removeGlobalNodeJsModuleLookupPaths();

const devInjectPath = process.env['DCCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'] || process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'];
if (devInjectPath) {
	devInjectNodeModuleLookupPath(devInjectPath);
}

if (!!process.send && (process.env['DCCODE_PIPE_LOGGING'] === 'true' || process.env['VSCODE_PIPE_LOGGING'] === 'true')) {
	pipeLoggingToParent();
}

if (!process.env['DCCODE_HANDLES_UNCAUGHT_ERRORS'] && !process.env['VSCODE_HANDLES_UNCAUGHT_ERRORS']) {
	handleExceptions();
}

if (process.env['DCCODE_PARENT_PID'] || process.env['VSCODE_PARENT_PID']) {
	terminateWhenParentTerminates();
}

await bootstrapESM();

let entryPoint = process.env['DCCODE_ESM_ENTRYPOINT'] || process.env['VSCODE_ESM_ENTRYPOINT'] || '';
if (entryPoint.startsWith('vs/')) {
	entryPoint = 'dc/' + entryPoint.substring(3);
}
await import([`./${entryPoint}.js`].join('/') );
