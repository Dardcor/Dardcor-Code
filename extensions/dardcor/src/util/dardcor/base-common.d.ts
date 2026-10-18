
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare global {


	interface IdleDeadline {
		readonly didTimeout: boolean;
		timeRemaining(): number;
	}

	function requestIdleCallback(callback: (args: IdleDeadline) => void, options?: { timeout: number }): number;
	function cancelIdleCallback(handle: number): void;



	interface TimeoutHandle { readonly _: never; }
	type Timeout = TimeoutHandle;
	function setTimeout(handler: string | Function, timeout?: number, ...arguments: any[]): Timeout;
	function clearTimeout(timeout: Timeout | undefined): void;

	function setInterval(callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]): Timeout;
	function clearInterval(timeout: Timeout | undefined): void;



	interface ErrorConstructor {
		captureStackTrace(targetObject: object, constructorOpt?: Function): void;
		stackTraceLimit: number;
	}
}

export { }
