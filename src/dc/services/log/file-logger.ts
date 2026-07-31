/**
 * Dardcor Code - Rotating File Logger (Task 125)
 * Mirrors: vs/platform/log/node/loggerService.ts rotating log output
 */

declare const require: any;

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { LogLevel } from './log-service.js';

function getLogLevelString(level: LogLevel): string {
	switch (level) {
		case LogLevel.Trace: return 'TRACE';
		case LogLevel.Debug: return 'DEBUG';
		case LogLevel.Info: return 'INFO';
		case LogLevel.Warning: return 'WARN';
		case LogLevel.Error: return 'ERROR';
		case LogLevel.Off: return 'OFF';
		default: return 'INFO';
	}
}

export class RotatingFileLogger implements IDisposable {
	private _stream: any = null;
	private _currentSize = 0;
	private _disposed = false;

	constructor(
		private readonly _filePath: string,
		private readonly _maxSizeBytes = 5 * 1024 * 1024,
		private readonly _maxFiles = 3
	) {}

	async open(): Promise<void> {
		try {
			const fs = require('fs');
			const path = require('path');
			fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
			try {
				const stat = fs.statSync(this._filePath);
				this._currentSize = stat.size;
			} catch {
				this._currentSize = 0;
			}
			this._stream = fs.createWriteStream(this._filePath, { flags: 'a' });
		} catch {
			// not in Node environment
		}
	}

	log(level: LogLevel, message: string): void {
		if (this._disposed || !this._stream) return;
		const line = `[${new Date().toISOString()}] [${getLogLevelString(level)}] ${message}\n`;
		this._stream.write(line);
		this._currentSize += line.length;
		if (this._currentSize >= this._maxSizeBytes) {
			this._rotate();
		}
	}

	private _rotate(): void {
		try {
			const fs = require('fs');
			this._stream?.end();
			for (let i = this._maxFiles - 1; i >= 1; i--) {
				const oldP = `${this._filePath}.${i}`;
				const newP = `${this._filePath}.${i + 1}`;
				if (fs.existsSync(oldP)) {
					fs.renameSync(oldP, newP);
				}
			}
			if (fs.existsSync(this._filePath)) {
				fs.renameSync(this._filePath, `${this._filePath}.1`);
			}
			this._stream = fs.createWriteStream(this._filePath, { flags: 'a' });
			this._currentSize = 0;
		} catch {
			// ignore rotate error
		}
	}

	dispose(): void {
		this._disposed = true;
		this._stream?.end();
		this._stream = null;
	}
}
