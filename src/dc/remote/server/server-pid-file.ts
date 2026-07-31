import { writeFile, readFile, unlink, open } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

export interface IPidFileInfo {
	readonly pid: number;
	readonly createdAt: number;
	readonly port?: number;
}

export function formatPidFile(pid: number, port?: number): string {
	const payload: IPidFileInfo = { pid, createdAt: Date.now() };
	if (port !== undefined) {
		payload.port = port;
	}
	return JSON.stringify(payload, null, 2);
}

export function parsePidFile(content: string): IPidFileInfo | null {
	try {
		const parsed = JSON.parse(content) as IPidFileInfo;
		if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) {
			return null;
		}
		return { pid: parsed.pid, createdAt: parsed.createdAt ?? Date.now(), port: parsed.port };
	} catch {
		return null;
	}
}

export function isPidAlive(pid: number): boolean {
	if (typeof process === 'undefined' || typeof process.kill !== 'function') {
		return false;
	}
	if (pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

export class ServerPidFile {
	async write(pidFile: string, pid: number, port?: number): Promise<string> {
		await writeFile(pidFile, formatPidFile(pid, port), { encoding: 'utf8' });
		return pidFile;
	}

	async read(pidFile: string): Promise<number | null> {
		try {
			const content = await readFile(pidFile, 'utf8');
			const info = parsePidFile(content);
			return info?.pid ?? null;
		} catch {
			return null;
		}
	}

	readSync(pidFile: string): number | null {
		try {
			const info = parsePidFile(readFileSync(pidFile, 'utf8'));
			return info?.pid ?? null;
		} catch {
			return null;
		}
	}

	async readInfo(pidFile: string): Promise<IPidFileInfo | null> {
		try {
			const content = await readFile(pidFile, 'utf8');
			return parsePidFile(content);
		} catch {
			return null;
		}
	}

	async remove(pidFile: string): Promise<boolean> {
		try {
			await unlink(pidFile);
			return true;
		} catch {
			return false;
		}
	}

	async isRunning(pidFile: string): Promise<boolean> {
		const pid = await this.read(pidFile);
		if (pid === null) {
			return false;
		}
		return isPidAlive(pid);
	}

	isRunningSync(pidFile: string): boolean {
		const pid = this.readSync(pidFile);
		if (pid === null) {
			return false;
		}
		return isPidAlive(pid);
	}

	async lock(pidFile: string): Promise<boolean> {
		return this.lockWithPid(pidFile, typeof process !== 'undefined' ? process.pid : 0);
	}

	async lockWithPid(pidFile: string, pid: number): Promise<boolean> {
		try {
			const handle = await open(pidFile, 'wx');
			try {
				await handle.writeFile(formatPidFile(pid));
			} finally {
				await handle.close();
			}
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
				return false;
			}
			throw error;
		}
	}

	async acquire(pidFile: string): Promise<boolean> {
		if (await this.isRunning(pidFile)) {
			return false;
		}
		await this.remove(pidFile);
		return this.lock(pidFile);
	}

	async release(pidFile: string): Promise<boolean> {
		return this.remove(pidFile);
	}
}
