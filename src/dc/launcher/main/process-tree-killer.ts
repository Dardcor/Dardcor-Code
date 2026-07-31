import { spawn, execFile } from 'child_process';

export type KillSignal = NodeJS.Signals | number;

export function killProcessTree(pid: number, signal: KillSignal = 'SIGTERM'): Promise<boolean> {
	if (!pid || pid <= 0) {
		return Promise.resolve(false);
	}
	if (process.platform === 'win32') {
		return new Promise((resolve) => {
			const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
				stdio: 'ignore',
				windowsHide: true
			});
			child.on('error', () => resolve(false));
			child.on('close', (code) => resolve(code === 0));
		});
	}
	return new Promise((resolve) => {
		try {
			process.kill(-pid, signal);
			resolve(true);
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error?.code === 'ESRCH') {
				resolve(true);
				return;
			}
			resolve(false);
		}
	});
}

export function killProcess(pid: number, signal: KillSignal = 'SIGTERM'): Promise<boolean> {
	if (!pid || pid <= 0) {
		return Promise.resolve(false);
	}
	return new Promise((resolve) => {
		try {
			process.kill(pid, signal);
			resolve(true);
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error?.code === 'ESRCH') {
				resolve(true);
				return;
			}
			resolve(false);
		}
	});
}

export async function killTreeAndWait(pid: number, timeoutMs: number = 5000): Promise<boolean> {
	const killed = await killProcessTree(pid);
	if (!killed) {
		return false;
	}
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!(await isProcessAlive(pid))) {
			return true;
		}
		await delay(200);
	}
	return !(await isProcessAlive(pid));
}

export function isProcessAlive(pid: number): Promise<boolean> {
	if (!pid || pid <= 0) {
		return Promise.resolve(false);
	}
	return new Promise((resolve) => {
		try {
			process.kill(pid, 0);
			resolve(true);
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			resolve(error?.code !== 'ESRCH');
		}
	});
}

export function listChildProcesses(pid: number): Promise<number[]> {
	if (process.platform === 'win32') {
		return listWindowsChildren(pid);
	}
	return new Promise((resolve) => {
		execFile('pgrep', ['-P', String(pid)], (err, stdout) => {
			if (err) {
				resolve([]);
				return;
			}
			const children = stdout
				.split(/\s+/)
				.map((line) => Number(line.trim()))
				.filter((value) => !isNaN(value) && value > 0);
			resolve(children);
		});
	});
}

function listWindowsChildren(pid: number): Promise<number[]> {
	return new Promise((resolve) => {
		execFile('wmic', ['process', 'where', `ParentProcessId=${pid}`, 'get', 'ProcessId'], (err, stdout) => {
			if (err) {
				resolve([]);
				return;
			}
			const children = stdout
				.split(/\r?\n/)
				.slice(1)
				.map((line) => Number(line.trim()))
				.filter((value) => !isNaN(value) && value > 0);
			resolve(children);
		});
	});
}

export async function getProcessTreeIds(rootPid: number): Promise<number[]> {
	const result: number[] = [rootPid];
	const queue = [rootPid];
	while (queue.length > 0) {
		const current = queue.shift()!;
		const children = await listChildProcesses(current);
		for (const child of children) {
			result.push(child);
			queue.push(child);
		}
	}
	return result;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
