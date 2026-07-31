import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostLogService {
	trace(message: string, ...args: any[]): void;
	debug(message: string, ...args: any[]): void;
	info(message: string, ...args: any[]): void;
	warn(message: string, ...args: any[]): void;
	error(message: string | Error, ...args: any[]): void;
	fatal(message: string | Error, ...args: any[]): void;
}

export class ExtensionHostLogService implements IExtensionHostLogService {
	private _level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' = 'info';

	trace(message: string, ...args: any[]): void {
		console.trace(`[ExtHost Trace] ${message}`, ...args);
	}

	debug(message: string, ...args: any[]): void {
		console.debug(`[ExtHost Debug] ${message}`, ...args);
	}

	info(message: string, ...args: any[]): void {
		console.info(`[ExtHost Info] ${message}`, ...args);
	}

	warn(message: string, ...args: any[]): void {
		console.warn(`[ExtHost Warn] ${message}`, ...args);
	}

	error(message: string | Error, ...args: any[]): void {
		console.error(`[ExtHost Error]`, message, ...args);
	}

	fatal(message: string | Error, ...args: any[]): void {
		console.error(`[ExtHost Fatal]`, message, ...args);
	}
}
