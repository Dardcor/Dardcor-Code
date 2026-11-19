/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ErrorListenerCallback {
	(error: any): void;
}

export interface ErrorListenerUnbind {
	(): void;
}

export class ErrorHandler {
	private unexpectedErrorHandler: (e: any) => void;
	private listeners: ErrorListenerCallback[];

	constructor() {

		this.listeners = [];

		this.unexpectedErrorHandler = function (e: any) {
			setTimeout(() => {
				if (e.stack) {
					if (ErrorNoTelemetry.isErrorNoTelemetry(e)) {
						throw new ErrorNoTelemetry(e.message + '\n\n' + e.stack);
					}

					throw new Error(e.message + '\n\n' + e.stack);
				}

				throw e;
			}, 0);
		};
	}

	addListener(listener: ErrorListenerCallback): ErrorListenerUnbind {
		this.listeners.push(listener);

		return () => {
			this._removeListener(listener);
		};
	}

	private emit(e: any): void {
		this.listeners.forEach((listener) => {
			listener(e);
		});
	}

	private _removeListener(listener: ErrorListenerCallback): void {
		this.listeners.splice(this.listeners.indexOf(listener), 1);
	}

	setUnexpectedErrorHandler(newUnexpectedErrorHandler: (e: any) => void): void {
		this.unexpectedErrorHandler = newUnexpectedErrorHandler;
	}

	getUnexpectedErrorHandler(): (e: any) => void {
		return this.unexpectedErrorHandler;
	}

	onUnexpectedError(e: any): void {
		this.unexpectedErrorHandler(e);
		this.emit(e);
	}

	onUnexpectedExternalError(e: any): void {
		this.unexpectedErrorHandler(e);
	}
}

export const errorHandler = new ErrorHandler();

export function setUnexpectedErrorHandler(newUnexpectedErrorHandler: (e: any) => void): void {
	errorHandler.setUnexpectedErrorHandler(newUnexpectedErrorHandler);
}

export function isSigPipeError(e: unknown): e is Error {
	if (!e || typeof e !== 'object') {
		return false;
	}

	const cast = e as Record<string, string | undefined>;
	return cast.code === 'EPIPE' && cast.syscall?.toUpperCase() === 'WRITE';
}

export function onBugIndicatingError(e: any): undefined {
	errorHandler.onUnexpectedError(e);
	return undefined;
}

export function onUnexpectedError(e: any): undefined {
	if (!isCancellationError(e)) {
		errorHandler.onUnexpectedError(e);
	}
	return undefined;
}

export function onUnexpectedExternalError(e: any): undefined {
	if (!isCancellationError(e)) {
		errorHandler.onUnexpectedExternalError(e);
	}
	return undefined;
}

export interface SerializedError {
	readonly $isError: true;
	readonly name: string;
	readonly message: string;
	readonly stack: string;
	readonly noTelemetry: boolean;
	readonly code?: string;
	readonly cause?: SerializedError;
}

type ErrorWithCode = Error & {
	code: string | undefined;
};

export function transformErrorForSerialization(error: Error): SerializedError;
export function transformErrorForSerialization(error: any): any;
export function transformErrorForSerialization(error: any): any {
	if (error instanceof Error) {
		const { name, message, cause } = error;
		// eslint-disable-next-line local/code-no-any-casts
		const stack: string = (<any>error).stacktrace || (<any>error).stack;
		return {
			$isError: true,
			name,
			message,
			stack,
			noTelemetry: ErrorNoTelemetry.isErrorNoTelemetry(error),
			cause: cause ? transformErrorForSerialization(cause) : undefined,
			code: (<ErrorWithCode>error).code
		};
	}

	return error;
}

export function transformErrorFromSerialization(data: SerializedError): Error {
	let error: Error;
	if (data.noTelemetry) {
		error = new ErrorNoTelemetry();
	} else {
		error = new Error();
		error.name = data.name;
	}
	error.message = data.message;
	error.stack = data.stack;
	if (data.code) {
		(<ErrorWithCode>error).code = data.code;
	}
	if (data.cause) {
		error.cause = transformErrorFromSerialization(data.cause);
	}
	return error;
}

export interface V8CallSite {
	getThis(): unknown;
	getTypeName(): string | null;
	getFunction(): Function | undefined;
	getFunctionName(): string | null;
	getMethodName(): string | null;
	getFileName(): string | null;
	getLineNumber(): number | null;
	getColumnNumber(): number | null;
	getEvalOrigin(): string | undefined;
	isToplevel(): boolean;
	isEval(): boolean;
	isNative(): boolean;
	isConstructor(): boolean;
	toString(): string;
}

export const canceledName = 'Canceled';

export function isCancellationError(error: any): boolean {
	if (error instanceof CancellationError) {
		return true;
	}
	return error instanceof Error && error.name === canceledName && error.message === canceledName;
}

export class CancellationError extends Error {
	constructor() {
		super(canceledName);
		this.name = this.message;
	}
}

export class PendingMigrationError extends Error {

	private static readonly _name = 'PendingMigrationError';

	static is(error: unknown): error is PendingMigrationError {
		return error instanceof PendingMigrationError || (error instanceof Error && error.name === PendingMigrationError._name);
	}

	constructor(message: string) {
		super(message);
		this.name = PendingMigrationError._name;
	}
}

export function canceled(): Error {
	const error = new Error(canceledName);
	error.name = error.message;
	return error;
}

export function illegalArgument(name?: string): Error {
	if (name) {
		return new Error(`Illegal argument: ${name}`);
	} else {
		return new Error('Illegal argument');
	}
}

export function illegalState(name?: string): Error {
	if (name) {
		return new Error(`Illegal state: ${name}`);
	} else {
		return new Error('Illegal state');
	}
}

export class ReadonlyError extends TypeError {
	constructor(name?: string) {
		super(name ? `${name} is read-only and cannot be changed` : 'Cannot change read-only property');
	}
}

export function getErrorMessage(err: any): string {
	if (!err) {
		return 'Error';
	}

	if (err.message) {
		return err.message;
	}

	if (err.stack) {
		return err.stack.split('\n')[0];
	}

	return String(err);
}

export class NotImplementedError extends Error {
	constructor(message?: string) {
		super('NotImplemented');
		if (message) {
			this.message = message;
		}
	}
}

export class NotSupportedError extends Error {
	constructor(message?: string) {
		super('NotSupported');
		if (message) {
			this.message = message;
		}
	}
}

export class ExpectedError extends Error {
	readonly isExpected = true;
}

export class ErrorNoTelemetry extends Error {
	override readonly name: string;

	constructor(msg?: string) {
		super(msg);
		this.name = 'CodeExpectedError';
	}

	public static fromError(err: Error): ErrorNoTelemetry {
		if (err instanceof ErrorNoTelemetry) {
			return err;
		}

		const result = new ErrorNoTelemetry();
		result.message = err.message;
		result.stack = err.stack;
		return result;
	}

	public static isErrorNoTelemetry(err: Error): err is ErrorNoTelemetry {
		return err.name === 'CodeExpectedError';
	}
}

export class BugIndicatingError extends Error {
	constructor(message?: string) {
		super(message || 'An unexpected bug occurred.');
		Object.setPrototypeOf(this, BugIndicatingError.prototype);

	}
}
