import { app, BrowserWindow } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export interface SecondInstanceArgs {
	argv: string[];
	workingDirectory: string;
}

export class SingleInstanceLock extends Disposable {
	private _locked = false;
	private _pendingArgs: string[] = [];
	private _pendingWorkingDirectory = '';
	private readonly _onDidReceiveSecondInstance = new Emitter<SecondInstanceArgs>();
	public readonly onDidReceiveSecondInstance = this._onDidReceiveSecondInstance.event;

	constructor() {
		super();
		this._register(this._onDidReceiveSecondInstance);
	}

	public acquire(): boolean {
		if (this._locked) {
			return true;
		}
		if (!app.requestSingleInstanceLock()) {
			this._locked = false;
			return false;
		}
		this._locked = true;
		this._register(toDisposable(() => {
			if (this._locked) {
				app.releaseSingleInstanceLock();
			}
		}));
		app.on('second-instance', (_event: Electron.Event, argv: string[], workingDirectory: string) => {
			this._pendingArgs = argv;
			this._pendingWorkingDirectory = workingDirectory;
			this._onDidReceiveSecondInstance.fire({ argv, workingDirectory });
		});
		return true;
	}

	public getLocked(): boolean {
		return this._locked;
	}

	public getPendingArgs(): string[] {
		return [...this._pendingArgs];
	}

	public getPendingWorkingDirectory(): string {
		return this._pendingWorkingDirectory;
	}

	public clearPendingArgs(): void {
		this._pendingArgs = [];
		this._pendingWorkingDirectory = '';
	}

	public takePendingArgs(): SecondInstanceArgs | null {
		if (this._pendingArgs.length === 0) {
			return null;
		}
		const result: SecondInstanceArgs = {
			argv: [...this._pendingArgs],
			workingDirectory: this._pendingWorkingDirectory
		};
		this.clearPendingArgs();
		return result;
	}

	public ensureFocusExisting(): boolean {
		if (!this._locked) {
			return false;
		}
		const windows = BrowserWindow.getAllWindows();
		if (windows.length === 0) {
			return false;
		}
		const target = windows.find((w) => !w.isDestroyed() && w.isVisible()) ?? windows[0];
		if (target.isDestroyed()) {
			return false;
		}
		if (target.isMinimized()) {
			target.restore();
		}
		target.show();
		target.focus();
		return true;
	}

	public focusOrCreate(fallback: () => void): void {
		if (!this.ensureFocusExisting()) {
			fallback();
		}
	}

	public release(): void {
		if (this._locked) {
			app.releaseSingleInstanceLock();
			this._locked = false;
		}
	}

	public override dispose(): void {
		this.release();
		super.dispose();
	}
}

export function acquireSingleInstanceLock(): SingleInstanceLock {
	const lock = new SingleInstanceLock();
	lock.acquire();
	return lock;
}

export function isFirstInstance(): boolean {
	return app.requestSingleInstanceLock();
}

export function getProcessArgs(): string[] {
	return process.argv;
}

export function extractPathsFromArgs(argv: string[]): string[] {
	const paths: string[] = [];
	for (const arg of argv) {
		if (!arg.startsWith('-') && !arg.startsWith('--') && arg !== '.') {
			paths.push(arg);
		}
	}
	return paths;
}
