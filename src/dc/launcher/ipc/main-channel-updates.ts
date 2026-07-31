import { app, ipcMain } from 'electron';

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export interface IUpdateStatus {
	state: UpdateState;
	version?: string;
	progress?: number;
	error?: string;
}

let status: IUpdateStatus = { state: 'idle', progress: 0 };
let timers: NodeJS.Timeout[] = [];

function setStatus(next: IUpdateStatus): IUpdateStatus {
	status = { ...status, ...next };
	return { ...status };
}

function clearTimers(): void {
	for (const timer of timers) {
		clearTimeout(timer);
		clearInterval(timer);
	}
	timers = [];
}

function emitProgress(sender: any, payload: IUpdateStatus): void {
	if (sender && !sender.isDestroyed()) {
		sender.send('update:progress', payload);
	}
}

export function registerUpdateChannels(): void {
	ipcMain.handle('update:check', (event: any) => {
		try {
			clearTimers();
			setStatus({ state: 'checking', progress: 0, error: undefined });
			const sender = event?.sender;
			const timer = setTimeout(() => {
				setStatus({ state: 'available', version: app.getVersion() });
				emitProgress(sender, status);
			}, 1000);
			timers.push(timer);
			return { status: { ...status } };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('update:download', (event: any) => {
		try {
			if (status.state !== 'available') {
				return { status: { ...status } };
			}
			clearTimers();
			setStatus({ state: 'downloading', progress: 0 });
			const sender = event?.sender;
			const interval = setInterval(() => {
				const next = Math.min(100, (status.progress ?? 0) + 10);
				setStatus({ state: status.state, progress: next });
				emitProgress(sender, status);
				if (next >= 100) {
					clearInterval(interval);
					setStatus({ state: 'ready', progress: 100 });
					emitProgress(sender, status);
				}
			}, 500);
			timers.push(interval);
			return { status: { ...status } };
		} catch (err: any) {
			setStatus({ state: 'error', error: err?.message ?? String(err) });
			return { status: { ...status } };
		}
	});

	ipcMain.handle('update:install', () => {
		try {
			if (status.state !== 'ready') {
				return { status: { ...status } };
			}
			clearTimers();
			setStatus({ state: 'idle', progress: 0 });
			app.relaunch();
			app.quit();
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('update:getState', () => {
		return { status: { ...status } };
	});
}
