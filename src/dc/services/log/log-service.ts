/**
 * Dardcor Code - Log Service Multi-Output Channel (Task 124)
 */

import { createDecorator } from '../instantiation/annotations';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';

export enum LogLevel {
	Trace = 0,
	Debug = 1,
	Info = 2,
	Warning = 3,
	Error = 4,
	Critical = 5,
	Off = 6
}

export interface ILogger {
	log(level: LogLevel, message: string): void;
}

export interface ILogService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeLogLevel: Event<LogLevel>;
	getLevel(): LogLevel;
	setLevel(level: LogLevel): void;
	trace(message: string, ...args: any[]): void;
	debug(message: string, ...args: any[]): void;
	info(message: string, ...args: any[]): void;
	warn(message: string, ...args: any[]): void;
	error(message: string | Error, ...args: any[]): void;
	critical(message: string | Error, ...args: any[]): void;
	addLogger(logger: ILogger): IDisposable;
}

export const ILogService = createDecorator<ILogService>('logService');

export function getLogLevelName(level: LogLevel): string {
	switch (level) {
		case LogLevel.Trace: return 'Trace';
		case LogLevel.Debug: return 'Debug';
		case LogLevel.Info: return 'Info';
		case LogLevel.Warning: return 'Warning';
		case LogLevel.Error: return 'Error';
		case LogLevel.Critical: return 'Critical';
		case LogLevel.Off: return 'Off';
	}
}

export function parseLogLevel(value: string | undefined): LogLevel | undefined {
	if (value === undefined) {
		return undefined;
	}
	const lower = value.toLowerCase();
	for (const level of [LogLevel.Trace, LogLevel.Debug, LogLevel.Info, LogLevel.Warning, LogLevel.Error, LogLevel.Critical, LogLevel.Off]) {
		if (getLogLevelName(level).toLowerCase() === lower) {
			return level;
		}
	}
	return undefined;
}

function pad(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

export function formatLogMessage(level: LogLevel, message: string): string {
	const now = new Date();
	const timestamp =
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
		`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
	return `[${timestamp}] [${getLogLevelName(level)}] ${message}`;
}

function formatArg(arg: any): string {
	if (arg instanceof Error) {
		return arg.message;
	}
	if (typeof arg === 'object' && arg !== null) {
		try {
			return JSON.stringify(arg);
		} catch {
			return String(arg);
		}
	}
	return String(arg);
}

export class LogService extends Disposable implements ILogService {
	declare readonly _serviceBrand: undefined;

	private _level: LogLevel = LogLevel.Info;
	private readonly _loggers: ILogger[] = [];

	private readonly _onDidChangeLogLevel = this._register(new Emitter<LogLevel>());
	readonly onDidChangeLogLevel = this._onDidChangeLogLevel.event;

	constructor(level: LogLevel = LogLevel.Info) {
		super();
		this._level = level;
	}

	public getLevel(): LogLevel {
		return this._level;
	}

	public setLevel(level: LogLevel): void {
		if (this._level === level) {
			return;
		}
		this._level = level;
		this._onDidChangeLogLevel.fire(level);
	}

	public trace(message: string, ...args: any[]): void {
		this._log(LogLevel.Trace, message, args);
	}

	public debug(message: string, ...args: any[]): void {
		this._log(LogLevel.Debug, message, args);
	}

	public info(message: string, ...args: any[]): void {
		this._log(LogLevel.Info, message, args);
	}

	public warn(message: string, ...args: any[]): void {
		this._log(LogLevel.Warning, message, args);
	}

	public error(message: string | Error, ...args: any[]): void {
		const text = message instanceof Error ? message.message : message;
		this._log(LogLevel.Error, text, args);
	}

	public critical(message: string | Error, ...args: any[]): void {
		const text = message instanceof Error ? message.message : message;
		this._log(LogLevel.Critical, text, args);
	}

	public addLogger(logger: ILogger): IDisposable {
		this._loggers.push(logger);
		return toDisposable(() => {
			const index = this._loggers.indexOf(logger);
			if (index >= 0) {
				this._loggers.splice(index, 1);
			}
		});
	}

	private _log(level: LogLevel, message: string, args: any[]): void {
		if (level < this._level) {
			return;
		}
		const formatted = args.length > 0 ? `${message} ${args.map(formatArg).join(' ')}` : message;
		for (const logger of this._loggers) {
			try {
				logger.log(level, formatted);
			} catch {
				// A failing logger must not break other channels.
			}
		}
	}
}
