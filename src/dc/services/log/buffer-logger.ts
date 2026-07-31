/**
 * Dardcor Code - Memory Buffer Logger (Task 191)
 * Mirrors: vs/platform/log/common/bufferLog.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable';
import { LogLevel } from './log-service';

export interface ILogEntry {
	timestamp: number;
	level: LogLevel;
	message: string;
}

export class BufferLogger implements IDisposable {
	private readonly _buffer: ILogEntry[] = [];

	constructor(private readonly _maxEntries = 500) {}

	log(level: LogLevel, message: string): void {
		this._buffer.push({
			timestamp: Date.now(),
			level,
			message,
		});
		if (this._buffer.length > this._maxEntries) {
			this._buffer.shift();
		}
	}

	getEntries(): ILogEntry[] {
		return [...this._buffer];
	}

	getContent(): string {
		return this._buffer.map((entry) => `${formatTimestamp(entry.timestamp)} [${getLevelName(entry.level)}] ${entry.message}`).join('\n');
	}

	clear(): void {
		this._buffer.length = 0;
	}

	dispose(): void {
		this.clear();
	}
}

function getLevelName(level: LogLevel): string {
	switch (level) {
		case LogLevel.Trace: return 'trace';
		case LogLevel.Debug: return 'debug';
		case LogLevel.Info: return 'info';
		case LogLevel.Warning: return 'warn';
		case LogLevel.Error: return 'error';
		case LogLevel.Critical: return 'critical';
		default: return 'off';
	}
}

function formatTimestamp(ts: number): string {
	return new Date(ts).toISOString();
}
