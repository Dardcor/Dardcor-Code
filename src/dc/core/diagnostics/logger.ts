/**
 * Dardcor Code - Structured Logger
 */

export enum LogLevel {
	Trace = 0,
	Debug = 1,
	Info = 2,
	Warning = 3,
	Error = 4
}

export class Logger {
	constructor(private _level: LogLevel = LogLevel.Info) {}

	public info(msg: string, ...args: any[]): void {
		if (this._level <= LogLevel.Info) console.log(`[INFO] ${msg}`, ...args);
	}

	public warn(msg: string, ...args: any[]): void {
		if (this._level <= LogLevel.Warning) console.warn(`[WARN] ${msg}`, ...args);
	}

	public error(msg: string, ...args: any[]): void {
		if (this._level <= LogLevel.Error) console.error(`[ERROR] ${msg}`, ...args);
	}
}
