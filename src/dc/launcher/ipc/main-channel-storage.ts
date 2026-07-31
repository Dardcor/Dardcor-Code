import { app, ipcMain } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type StorageRecord = Record<string, unknown>;

let cache: StorageRecord | null = null;
let storageFile: string | null = null;

function getStorageFile(): string {
	if (!storageFile) {
		storageFile = join(app.getPath('userData'), 'storage.json');
	}
	return storageFile;
}

async function load(): Promise<StorageRecord> {
	if (cache) {
		return cache;
	}
	try {
		const raw = await readFile(getStorageFile(), 'utf-8');
		const parsed = JSON.parse(raw) as unknown;
		cache = parsed && typeof parsed === 'object' ? parsed as StorageRecord : {};
	} catch {
		cache = {};
	}
	return cache;
}

async function persist(): Promise<void> {
	if (!cache) {
		return;
	}
	const file = getStorageFile();
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf-8');
	await rename(tmp, file);
}

export function registerStorageChannels(): void {
	ipcMain.handle('storage:get', async (_event: any, key: string) => {
		try {
			const data = await load();
			return { value: data[key] ?? null };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('storage:set', async (_event: any, key: string, value: unknown) => {
		try {
			const data = await load();
			data[key] = value;
			await persist();
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('storage:delete', async (_event: any, key: string) => {
		try {
			const data = await load();
			delete data[key];
			await persist();
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('storage:all', async () => {
		try {
			const data = await load();
			return { values: { ...data } };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});
}
