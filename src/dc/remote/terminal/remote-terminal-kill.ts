import { Emitter, Event } from '../../core/events/emitter.js';

export type KillSignal = NodeJS.Signals | number | string;

export function isPosix(): boolean {
	return typeof process !== 'undefined' && process.platform !== 'win32';
}

export function isPidAlive(pid: number): boolean {
	if (typeof process === 'undefined' || typeof process.kill !== 'function' || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

export function killPid(pid: number, signal: KillSignal = 'SIGTERM'): boolean {
	if (typeof process === 'undefined' || typeof process.kill !== 'function' || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, signal as NodeJS.Signals);
		return true;
	} catch {
		return false;
	}
}

export function killProcessGroup(pid: number, signal: KillSignal = 'SIGTERM'): boolean {
	if (typeof process === 'undefined' || typeof process.kill !== 'function' || pid <= 0) {
		return false;
	}
	if (!isPosix()) {
		return killPid(pid, signal);
	}
	try {
		process.kill(-pid, signal as NodeJS.Signals);
		return true;
	} catch {
		return killPid(pid, signal);
	}
}

export class RemoteTerminalKill {
	private readonly _onDidKill = new Emitter<{ pid: number; signal: KillSignal; succeeded: boolean }>();
	readonly onDidKill: Event<{ pid: number; signal: KillSignal; succeeded: boolean }> = this._onDidKill.event;

	async kill(pid: number, signal?: KillSignal): Promise<boolean> {
		const resolved = signal ?? 'SIGTERM';
		const succeeded = killPid(pid, resolved);
		this._onDidKill.fire({ pid, signal: resolved, succeeded });
		return succeeded;
	}

	killTree(pid: number): Promise<boolean> {
		if (killProcessGroup(pid, 'SIGTERM')) {
			return Promise.resolve(true);
		}
		return Promise.resolve(killPid(pid, 'SIGTERM'));
	}

	forceKill(pid: number): Promise<boolean> {
		return this.kill(pid, 'SIGKILL');
	}

	sendSignal(pid: number, signal: KillSignal): Promise<boolean> {
		return this.kill(pid, signal);
	}

	isAlive(pid: number): boolean {
		return isPidAlive(pid);
	}

	async waitForExit(pid: number, timeoutMs = 5000): Promise<boolean> {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			if (!isPidAlive(pid)) {
				return true;
			}
			await new Promise<void>(resolve => setTimeout(resolve, 100));
		}
		return !isPidAlive(pid);
	}

	async killAndWait(pid: number, signal: KillSignal = 'SIGTERM', timeoutMs = 5000): Promise<boolean> {
		await this.kill(pid, signal);
		return this.waitForExit(pid, timeoutMs);
	}

	terminateGracefully(pid: number, graceMs = 3000): Promise<boolean> {
		return this.killAndWait(pid, 'SIGTERM', graceMs).then(exitOk => {
			if (exitOk) {
				return true;
			}
			return this.forceKill(pid);
		});
	}
}
