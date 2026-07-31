import * as fs from 'fs';
import * as path from 'path';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
}

export interface SharedProcessLogsOptions {
	logDir?: string;
	maxSizeBytes?: number;
	maxBackupFiles?: number;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
};

export class SharedProcessLogs extends Disposable {
	private readonly _logDir: string;
	private readonly _logFile: string;
	private readonly _maxSizeBytes: number;
	private readonly _maxBackupFiles: number;
	private _entries: LogEntry[] = [];
	private readonly _maxEntries: number;

	constructor(options: SharedProcessLogsOptions = {}) {
		super();
		this._logDir = options.logDir ?? defaultLogDir();
		this._logFile = path.join(this._logDir, 'shared-process.log');
		this._maxSizeBytes = options.maxSizeBytes ?? 1024 * 1024;
		this._maxBackupFiles = options.maxBackupFiles ?? 3;
		this._maxEntries = 2000;
		this._ensureDir();
		this._rotateIfNeeded();
		this._loadExisting();
	}

	public append(level: LogLevel, message: string): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message
		};
		this._entries.push(entry);
		if (this._entries.length > this._maxEntries) {
			this._entries.shift();
		}
		try {
			fs.appendFileSync(this._logFile, formatEntry(entry) + '\n', 'utf-8');
		} catch (err) {
			console.error('[shared-process-logs] append failed:', err);
		}
		this._rotateIfNeeded();
	}

	public debug(message: string): void {
		this.append('debug', message);
	}

	public info(message: string): void {
		this.append('info', message);
	}

	public warn(message: string): void {
		this.append('warn', message);
	}

	public error(message: string): void {
		this.append('error', message);
	}

	public getLogContent(): string {
		try {
			if (fs.existsSync(this._logFile)) {
				return fs.readFileSync(this._logFile, 'utf-8');
			}
		} catch {
			// Ignore.
		}
		return '';
	}

	public getLogEntries(): LogEntry[] {
		return [...this._entries];
	}

	public getLogEntriesByLevel(level: LogLevel): LogEntry[] {
		const threshold = LEVEL_ORDER[level];
		return this._entries.filter((entry) => LEVEL_ORDER[entry.level] >= threshold);
	}

	public getLogPath(): string {
		return this._logFile;
	}

	public getLogSizeBytes(): number {
		try {
			return fs.statSync(this._logFile).size;
		} catch {
			return 0;
		}
	}

	public clear(): void {
		this._entries = [];
		try {
			fs.writeFileSync(this._logFile, '', 'utf-8');
		} catch (err) {
			console.error('[shared-process-logs] clear failed:', err);
		}
	}

	public override dispose(): void {
		super.dispose();
	}

	private _ensureDir(): void {
		try {
			fs.mkdirSync(this._logDir, { recursive: true });
		} catch (err) {
			console.error('[shared-process-logs] failed to create log dir:', err);
		}
	}

	private _rotateIfNeeded(): void {
		try {
			if (!fs.existsSync(this._logFile)) {
				return;
			}
			const size = fs.statSync(this._logFile).size;
			if (size < this._maxSizeBytes) {
				return;
			}
			for (let i = this._maxBackupFiles - 1; i >= 1; i--) {
				const from = `${this._logFile}.${i}`;
				const to = `${this._logFile}.${i + 1}`;
				if (fs.existsSync(from)) {
					fs.renameSync(from, to);
				}
			}
			if (fs.existsSync(this._logFile)) {
				fs.renameSync(this._logFile, `${this._logFile}.1`);
			}
			fs.writeFileSync(this._logFile, '', 'utf-8');
		} catch (err) {
			console.error('[shared-process-logs] rotation failed:', err);
		}
	}

	private _loadExisting(): void {
		try {
			if (!fs.existsSync(this._logFile)) {
				return;
			}
			const content = fs.readFileSync(this._logFile, 'utf-8');
			for (const line of content.split('\n')) {
				if (!line.trim()) {
					continue;
				}
				const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\[(\w+)\] (.*)$/);
				if (match) {
					const entry: LogEntry = {
						timestamp: match[1],
						level: (match[2].toLowerCase() in LEVEL_ORDER ? match[2].toLowerCase() : 'info') as LogLevel,
						message: match[3]
					};
					this._entries.push(entry);
				}
			}
		} catch {
			// Ignore.
		}
	}
}

function formatEntry(entry: LogEntry): string {
	return `[${entry.timestamp}][${entry.level.toUpperCase()}] ${entry.message}`;
}

export function defaultLogDir(): string {
	const userData = process.env.DC_USER_DATA ?? process.cwd();
	return path.join(userData, 'logs');
}

export function createSharedProcessLogs(options?: SharedProcessLogsOptions): SharedProcessLogs {
	return new SharedProcessLogs(options);
}
