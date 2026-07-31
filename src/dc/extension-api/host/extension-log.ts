import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export type ExtensionLogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface IExtensionLogEntry {
	readonly level: ExtensionLogLevel;
	readonly message: string;
	readonly timestamp: number;
}

export interface IExtensionLogOptions {
	readonly maxLines?: number;
}

export class ExtensionLog extends Disposable {
	private readonly _lines: string[] = [];
	private readonly _entries: IExtensionLogEntry[] = [];
	private readonly _maxLines: number;

	private readonly _onDidLog = this._register(new Emitter<IExtensionLogEntry>());
	readonly onDidLog: Event<IExtensionLogEntry> = this._onDidLog.event;

	constructor(options: IExtensionLogOptions = {}) {
		super();
		this._maxLines = options.maxLines ?? 10_000;
	}

	public log(level: ExtensionLogLevel, message: string): void {
		const entry: IExtensionLogEntry = { level, message, timestamp: Date.now() };
		const line = `[${new Date(entry.timestamp).toISOString()}] [${level}] ${message}`;
		this._lines.push(line);
		this._entries.push(entry);
		if (this._lines.length > this._maxLines) {
			const overflow = this._lines.length - this._maxLines;
			this._lines.splice(0, overflow);
			this._entries.splice(0, overflow);
		}
		this._onDidLog.fire(entry);
	}

	public info(message: string): void {
		this.log('info', message);
	}

	public warn(message: string): void {
		this.log('warn', message);
	}

	public error(message: string): void {
		this.log('error', message);
	}

	public debug(message: string): void {
		this.log('debug', message);
	}

	public getOutputContent(): string {
		return this._lines.join('\n');
	}

	public getEntries(): IExtensionLogEntry[] {
		return this._entries.slice();
	}

	public clear(): void {
		this._lines.length = 0;
		this._entries.length = 0;
	}

	public get lineCount(): number {
		return this._lines.length;
	}

	public override dispose(): void {
		this._lines.length = 0;
		this._entries.length = 0;
		super.dispose();
	}
}
