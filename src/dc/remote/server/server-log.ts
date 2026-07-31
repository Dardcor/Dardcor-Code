/**
 * Dardcor Code - Server Log Writer & File Rotation Manager (Task 832)
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { ServerCliLogLevel } from './server-cli-parser';

export interface IServerLogOptions {
	readonly level?: ServerCliLogLevel;
	readonly filePath?: string;
	readonly maxFileBytes?: number;
	readonly maxRotatedFiles?: number;
	readonly consoleOutput?: boolean;
}

function pad(value: number, width = 2): string {
	return String(value).padStart(width, '0');
}

function formatTimestamp(date: Date): string {
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
	);
}

export class ServerLog extends Disposable {
	private readonly _level: ServerCliLogLevel;
	private readonly _filePath?: string;
	private readonly _maxFileBytes: number;
	private readonly _maxRotatedFiles: number;
	private readonly _consoleOutput: boolean;

	private _bytesWritten = 0;
	private _writesSinceCheck = 0;

	private readonly _onDidLog = this._register(new Emitter<{ level: ServerCliLogLevel; message: string; timestamp: number }>());
	readonly onDidLog: Event<{ level: ServerCliLogLevel; message: string; timestamp: number }> = this._onDidLog.event;

	constructor(options: IServerLogOptions = {}) {
		super();
		this._level = options.level ?? ServerCliLogLevel.Info;
		this._filePath = options.filePath;
		this._maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
		this._maxRotatedFiles = options.maxRotatedFiles ?? 3;
		this._consoleOutput = options.consoleOutput ?? true;
		if (this._filePath) {
			this._ensureDirectory();
		}
	}

	get level(): ServerCliLogLevel {
		return this._level;
	}

	debug(message: string, ...args: unknown[]): void {
		this._log(ServerCliLogLevel.Debug, message, args);
	}

	info(message: string, ...args: unknown[]): void {
		this._log(ServerCliLogLevel.Info, message, args);
	}

	warn(message: string, ...args: unknown[]): void {
		this._log(ServerCliLogLevel.Warn, message, args);
	}

	error(message: string | Error, ...args: unknown[]): void {
		this._log(ServerCliLogLevel.Error, message instanceof Error ? message.message : message, args);
	}

	private _log(level: ServerCliLogLevel, message: string, args: unknown[]): void {
		if (level < this._level) {
			return;
		}
		const formatted = args.length > 0 ? `${message} ${args.map(a => {
			try {
				return typeof a === 'string' ? a : JSON.stringify(a);
			} catch {
				return String(a);
			}
		}).join(' ')}` : message;
		const line = `[${formatTimestamp(new Date())}] [${ServerCliLogLevel[level]}] ${formatted}\n`;
		if (this._consoleOutput) {
			if (level >= ServerCliLogLevel.Warn) {
				console.error(line.trimEnd());
			} else {
				console.log(line.trimEnd());
			}
		}
		this._onDidLog.fire({ level, message: formatted, timestamp: Date.now() });
		if (this._filePath) {
			this._writeToFile(line);
		}
	}

	private _writeToFile(line: string): void {
		try {
			this._writesSinceCheck++;
			if (this._writesSinceCheck >= 10) {
				this._writesSinceCheck = 0;
				this._checkRotation();
			}
			appendFileSync(this._filePath!, line, 'utf8');
			this._bytesWritten += Buffer.byteLength(line, 'utf8');
			if (this._bytesWritten >= this._maxFileBytes) {
				this._rotate();
			}
		} catch {
			// Logging must never crash the server.
		}
	}

	private _checkRotation(): void {
		if (!this._filePath) {
			return;
		}
		try {
			if (existsSync(this._filePath) && statSync(this._filePath).size >= this._maxFileBytes) {
				this._rotate();
			}
		} catch {
			// ignore
		}
	}

	private _rotate(): void {
		if (!this._filePath) {
			return;
		}
		try {
			for (let i = this._maxRotatedFiles - 1; i >= 1; i--) {
				const source = `${this._filePath}.${i}`;
				if (existsSync(source)) {
					renameSync(source, `${this._filePath}.${i + 1}`);
				}
			}
			if (existsSync(this._filePath)) {
				renameSync(this._filePath, `${this._filePath}.1`);
			}
			this._bytesWritten = 0;
		} catch {
			// ignore rotation failures
		}
	}

	private _ensureDirectory(): void {
		try {
			const dir = dirname(this._filePath!);
			if (dir && !existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
		} catch {
			// ignore
		}
	}

	static resolveDefaultLogPath(root: string): string {
		return join(root, '.dc-server', 'server.log');
	}
}
