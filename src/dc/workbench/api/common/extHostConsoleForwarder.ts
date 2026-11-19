/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStackArgument } from '../../../base/common/console.js';
import { safeStringify } from '../../../base/common/objects.js';
import { MainContext, MainThreadConsoleShape } from './extHost.protocol.js';
import { IExtHostInitDataService } from './extHostInitDataService.js';
import { IExtHostRpcService } from './extHostRpcService.js';

export abstract class AbstractExtHostConsoleForwarder {

	private readonly _mainThreadConsole: MainThreadConsoleShape;
	private readonly _includeStack: boolean;
	private readonly _logNative: boolean;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
	) {
		this._mainThreadConsole = extHostRpc.getProxy(MainContext.MainThreadConsole);
		this._includeStack = initData.consoleForward.includeStack;
		this._logNative = initData.consoleForward.logNative;

		this._wrapConsoleMethod('info', 'log');
		this._wrapConsoleMethod('log', 'log');
		this._wrapConsoleMethod('warn', 'warn');
		this._wrapConsoleMethod('debug', 'debug');
		this._wrapConsoleMethod('error', 'error');
	}

	private _wrapConsoleMethod(method: 'log' | 'info' | 'warn' | 'error' | 'debug', severity: 'log' | 'warn' | 'error' | 'debug') {
		const that = this;
		const original = console[method];

		Object.defineProperty(console, method, {
			set: () => { },
			get: () => (...args: unknown[]) => {
				that._handleConsoleCall(method, severity, original, args);
			},
		});
	}

	private _handleConsoleCall(method: 'log' | 'info' | 'warn' | 'error' | 'debug', severity: 'log' | 'warn' | 'error' | 'debug', original: (...args: unknown[]) => void, args: unknown[]): void {
		this._mainThreadConsole.$logExtensionHostMessage({
			type: '__$console',
			severity,
			arguments: safeStringifyArgumentsToArray(args, this._includeStack)
		});
		if (this._logNative) {
			this._nativeConsoleLogMessage(method, original, args);
		}
	}

	protected abstract _nativeConsoleLogMessage(method: 'log' | 'info' | 'warn' | 'error' | 'debug', original: (...args: unknown[]) => void, args: unknown[]): void;

}

const MAX_LENGTH = 100000;

function safeStringifyArgumentsToArray(args: unknown[], includeStack: boolean): string {
	const argsArray = [];

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

	if (includeStack) {
		const stack = new Error().stack;
		if (stack) {
			argsArray.push({ __$stack: stack.split('\n').slice(3).join('\n') } satisfies IStackArgument);
		}
	}

	try {
		const res = safeStringify(argsArray);

		if (res.length > MAX_LENGTH) {
			return 'Output omitted for a large object that exceeds the limits';
		}

		return res;
	} catch (error) {
		return `Output omitted for an object that cannot be inspected ('${error.toString()}')`;
	}
}
