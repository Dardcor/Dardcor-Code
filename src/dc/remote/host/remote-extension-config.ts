/**
 * Dardcor Code - Remote Extension Setting Configuration Reader (Task 835)
 */

import { readFileSync, existsSync, watch, FSWatcher } from 'node:fs';
import { resolve, join } from 'node:path';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface IRemoteExtensionConfigPaths {
	readonly userSettings?: string;
	readonly workspaceSettings?: string;
}

function stripJsonComments(source: string): string {
	let result = '';
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		const next = source[i + 1];
		if (inLineComment) {
			if (char === '\n') {
				inLineComment = false;
				result += char;
			}
			continue;
		}
		if (inBlockComment) {
			if (char === '*' && next === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (inString) {
			if (char === '\\') {
				result += char + (next ?? '');
				i++;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			result += char;
			continue;
		}
		if (char === '"') {
			inString = true;
			result += char;
			continue;
		}
		if (char === '/' && next === '/') {
			inLineComment = true;
			i++;
			continue;
		}
		if (char === '/' && next === '*') {
			inBlockComment = true;
			i++;
			continue;
		}
		result += char;
	}
	return result;
}

export class RemoteExtensionConfig extends Disposable {
	private _settings: Record<string, any> = {};
	private _watchers: FSWatcher[] = [];
	private _loaded = false;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		private readonly _paths: IRemoteExtensionConfigPaths,
		private readonly _workspaceRoot: string
	) {
		super();
	}

	get loaded(): boolean {
		return this._loaded;
	}

	async load(): Promise<void> {
		this._settings = {};
		const files = [
			this._paths.userSettings,
			this._paths.workspaceSettings,
			join(this._workspaceRoot, '.vscode', 'settings.json')
		].filter((file): file is string => !!file && existsSync(file));

		for (const file of files) {
			try {
				const content = readFileSync(file, 'utf8');
				const parsed = JSON.parse(stripJsonComments(content)) as Record<string, any>;
				this._settings = { ...parsed, ...this._settings };
			} catch {
				// Ignore malformed settings files.
			}
		}
		this._loaded = true;
		this._startWatching(files);
	}

	reload(): Promise<void> {
		return this.load();
	}

	get<T>(key: string, fallback?: T): T | undefined {
		if (Object.prototype.hasOwnProperty.call(this._settings, key)) {
			return this._settings[key] as T;
		}
		return fallback;
	}

	has(key: string): boolean {
		return Object.prototype.hasOwnProperty.call(this._settings, key);
	}

	getSection(section: string): Record<string, any> {
		const value = this._settings[section];
		return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
	}

	getAll(): Record<string, any> {
		return { ...this._settings };
	}

	getExtensionSetting(extensionId: string, key: string, fallback?: any): any {
		return this.get(`${extensionId}.${key}`, fallback);
	}

	private _startWatching(files: string[]): void {
		for (const watcher of this._watchers) {
			watcher.close();
		}
		this._watchers = [];
		for (const file of files) {
			try {
				const watcher = watch(file, () => {
					this.reload().then(() => this._onDidChange.fire());
				});
				this._watchers.push(watcher);
			} catch {
				// ignore
			}
		}
	}

	override dispose(): void {
		for (const watcher of this._watchers) {
			try {
				watcher.close();
			} catch {
				// ignore
			}
		}
		this._watchers = [];
		super.dispose();
	}
}

export function defaultRemoteConfigPaths(homeDir?: string): IRemoteExtensionConfigPaths {
	const home = homeDir ?? (typeof process !== 'undefined' ? process.env.HOME ?? process.env.USERPROFILE : undefined) ?? '';
	return {
		userSettings: home ? resolve(home, '.dc-server', 'settings.json') : undefined,
		workspaceSettings: undefined
	};
}
