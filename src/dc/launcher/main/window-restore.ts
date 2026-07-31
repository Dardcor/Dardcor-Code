import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Disposable } from '../../core/lifecycle/disposable';

export interface RestoreSession {
	paths: string[];
	folderPath?: string;
	openFiles: string[];
	activeFile?: string;
	timestamp: number;
}

export interface WindowRestoreOptions {
	restoreFile?: string;
	maxPaths?: number;
	enabled?: boolean;
}

export class WindowRestore extends Disposable {
	private _session: RestoreSession;
	private readonly _restoreFile: string;
	private readonly _maxPaths: number;
	private readonly _enabled: boolean;

	constructor(options: WindowRestoreOptions = {}) {
		super();
		this._restoreFile = options.restoreFile ?? path.join(app.getPath('userData'), 'window-restore.json');
		this._maxPaths = options.maxPaths ?? 20;
		this._enabled = options.enabled ?? true;
		this._session = this._load();
	}

	public get enabled(): boolean {
		return this._enabled;
	}

	public get session(): RestoreSession {
		return { ...this._session, openFiles: [...this._session.openFiles], paths: [...this._session.paths] };
	}

	public hasSession(): boolean {
		return this._session.paths.length > 0 || this._session.openFiles.length > 0;
	}

	public getLastSessionPaths(): string[] {
		return [...this._session.paths];
	}

	public getLastOpenFiles(): string[] {
		return [...this._session.openFiles];
	}

	public getLastFolder(): string | undefined {
		return this._session.folderPath;
	}

	public getLastActiveFile(): string | undefined {
		return this._session.activeFile;
	}

	public restore(callback: (paths: string[]) => void): void {
		if (!this._enabled) {
			return;
		}
		const paths = this._session.paths.filter((p) => this._pathExists(p));
		if (paths.length === 0) {
			return;
		}
		callback(paths);
	}

	public restoreOpenFiles(callback: (paths: string[]) => void): void {
		if (!this._enabled) {
			return;
		}
		const files = this._session.openFiles.filter((p) => this._pathExists(p));
		if (files.length === 0) {
			return;
		}
		callback(files);
	}

	public savePaths(paths: string[]): void {
		const unique = this._dedupe(paths.filter((p) => !!p));
		this._session.paths = unique.slice(0, this._maxPaths);
		this._session.timestamp = Date.now();
		this._write();
	}

	public setOpenFiles(files: string[], activeFile?: string): void {
		this._session.openFiles = this._dedupe(files).slice(0, this._maxPaths);
		this._session.activeFile = activeFile;
		this._session.timestamp = Date.now();
		this._write();
	}

	public setFolder(folderPath: string): void {
		this._session.folderPath = folderPath;
		this._session.timestamp = Date.now();
		this._write();
	}

	public addOpenFile(filePath: string): void {
		const files = this._session.openFiles.filter((f) => f !== filePath);
		files.push(filePath);
		this.setOpenFiles(files, filePath);
	}

	public removeOpenFile(filePath: string): void {
		this.setOpenFiles(
			this._session.openFiles.filter((f) => f !== filePath),
			this._session.activeFile === filePath ? undefined : this._session.activeFile
		);
	}

	public clear(): void {
		this._session = { paths: [], openFiles: [], timestamp: Date.now() };
		this._write();
	}

	public persistNow(): void {
		this._write();
	}

	private _load(): RestoreSession {
		try {
			const raw = fs.readFileSync(this._restoreFile, 'utf-8');
			const data = JSON.parse(raw) as RestoreSession;
			return {
				paths: Array.isArray(data?.paths) ? data.paths : [],
				openFiles: Array.isArray(data?.openFiles) ? data.openFiles : [],
				folderPath: typeof data?.folderPath === 'string' ? data.folderPath : undefined,
				activeFile: typeof data?.activeFile === 'string' ? data.activeFile : undefined,
				timestamp: data?.timestamp ?? Date.now()
			};
		} catch {
			return { paths: [], openFiles: [], timestamp: Date.now() };
		}
	}

	private _write(): void {
		try {
			fs.mkdirSync(path.dirname(this._restoreFile), { recursive: true });
			fs.writeFileSync(this._restoreFile, JSON.stringify(this._session, null, 2), 'utf-8');
		} catch (err) {
			console.error('[window-restore] failed to persist session:', err);
		}
	}

	private _pathExists(p: string): boolean {
		try {
			return fs.existsSync(p);
		} catch {
			return false;
		}
	}

	private _dedupe(paths: string[]): string[] {
		const seen = new Set<string>();
		const result: string[] = [];
		for (const p of paths) {
			if (!seen.has(p)) {
				seen.add(p);
				result.push(p);
			}
		}
		return result;
	}
}

export function getRestoreFilePath(): string {
	return path.join(app.getPath('userData'), 'window-restore.json');
}

export function createWindowRestore(options?: WindowRestoreOptions): WindowRestore {
	return new WindowRestore(options);
}
