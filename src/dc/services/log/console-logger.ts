/**
 * Dardcor Code - Console Logger (Task 163)
 * Mirrors: vs/platform/log/browser/consoleLog.ts (developer console formatting channel)
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { LogLevel } from './log-service.js';

function getLogLevelString(level: LogLevel): string {
	switch (level) {
		case LogLevel.Trace: return 'TRACE';
		case LogLevel.Debug: return 'DEBUG';
		case LogLevel.Info: return 'INFO';
		case LogLevel.Warning: return 'WARN';
		case LogLevel.Error: return 'ERROR';
		case LogLevel.Critical: return 'CRITICAL';
		case LogLevel.Off: return 'OFF';
		default: return 'INFO';
	}
}

export class ConsoleLogger implements IDisposable {
	private _level: LogLevel;

	constructor(level: LogLevel = LogLevel.Info) {
		this._level = level;
	}

	setLevel(level: LogLevel): void {
		this._level = level;
	}

	log(level: LogLevel, message: string, ...args: any[]): void {
		if (level < this._level || level === LogLevel.Off) {
			return;
		}
		const timestamp = new Date().toLocaleTimeString();
		const tag = `[${timestamp}] [${getLogLevelString(level)}]`;

		switch (level) {
			case LogLevel.Trace:
			case LogLevel.Debug:
				console.debug(tag, message, ...args);
				break;
			case LogLevel.Info:
				console.info(tag, message, ...args);
				break;
			case LogLevel.Warning:
				console.warn(tag, message, ...args);
				break;
			case LogLevel.Error:
			case LogLevel.Critical:
				console.error(tag, message, ...args);
				break;
		}
	}

	dispose(): void {}
}
