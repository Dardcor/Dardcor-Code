import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

const watchers = new Map<number, fsSync.FSWatcher>();
let nextWatcherId = 1;

export function registerFileChannels(): void {
	ipcMain.handle('fs:readFile', async (_event: any, filePath: string) => {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			return { content };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:writeFile', async (_event: any, filePath: string, content: string) => {
		try {
			await fs.writeFile(filePath, content, 'utf-8');
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:readDir', async (_event: any, dirPath: string) => {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			const result = entries
				.filter((e: any) => !e.name.startsWith('.'))
				.sort((a: any, b: any) => {
					if (a.isDirectory() && !b.isDirectory()) return -1;
					if (!a.isDirectory() && b.isDirectory()) return 1;
					return a.name.localeCompare(b.name);
				})
				.map((e: any) => ({
					name: e.name,
					isDirectory: e.isDirectory(),
					isFile: e.isFile(),
					path: path.join(dirPath, e.name)
				}));
			return { entries: result };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:stat', async (_event: any, filePath: string) => {
		try {
			const stat = await fs.stat(filePath);
			return {
				isFile: stat.isFile(),
				isDirectory: stat.isDirectory(),
				size: stat.size,
				mtime: stat.mtime.getTime()
			};
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:mkdir', async (_event: any, dirPath: string, recursive?: boolean) => {
		try {
			await fs.mkdir(dirPath, { recursive: recursive ?? true });
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:delete', async (_event: any, filePath: string, recursive?: boolean) => {
		try {
			await fs.rm(filePath, { recursive: recursive ?? true, force: true });
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:rename', async (_event: any, oldPath: string, newPath: string) => {
		try {
			await fs.rename(oldPath, newPath);
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:watch', (event: any, dirPath: string, recursive?: boolean) => {
		try {
			const watcher = fsSync.watch(dirPath, { recursive: recursive ?? false }, (eventType, filename) => {
				const sender = event?.sender;
				if (sender && !sender.isDestroyed()) {
					sender.send('fs:watchEvent', {
						path: dirPath,
						eventType,
						filename: filename ? filename.toString() : null
					});
				}
			});
			const id = nextWatcherId++;
			watchers.set(id, watcher);
			watcher.on('error', () => {
				watchers.delete(id);
			});
			event?.sender?.once?.('destroyed', () => {
				try {
					watcher.close();
				} catch {
					// Already closed.
				}
				watchers.delete(id);
			});
			return { id };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:readFileBinary', async (_event: any, filePath: string) => {
		try {
			const buffer = await fs.readFile(filePath);
			const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
			return { buffer: arrayBuffer };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('fs:unwatch', (_event: any, id: number) => {
		const watcher = watchers.get(id);
		if (watcher) {
			try {
				watcher.close();
			} catch {
				// Already closed.
			}
			watchers.delete(id);
		}
		return { success: true };
	});
}
