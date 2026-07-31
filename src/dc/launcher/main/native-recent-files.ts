import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface RecentState {
	files: string[];
	folders: string[];
	timestamp: number;
}

const MAX_RECENT = 10;

function getRecentFilePath(): string {
	return path.join(app.getPath('userData'), 'recent-files.json');
}

function loadState(): RecentState {
	try {
		const raw = fs.readFileSync(getRecentFilePath(), 'utf-8');
		const data = JSON.parse(raw) as Partial<RecentState>;
		return {
			files: Array.isArray(data.files) ? data.files : [],
			folders: Array.isArray(data.folders) ? data.folders : [],
			timestamp: data.timestamp ?? Date.now()
		};
	} catch {
		return { files: [], folders: [], timestamp: Date.now() };
	}
}

function saveState(state: RecentState): void {
	try {
		fs.mkdirSync(path.dirname(getRecentFilePath()), { recursive: true });
		fs.writeFileSync(getRecentFilePath(), JSON.stringify(state, null, 2), 'utf-8');
	} catch (err) {
		console.error('[native-recent-files] failed to save:', err);
	}
}

function pushRecent(list: string[], entry: string): string[] {
	const filtered = list.filter((item) => item !== entry);
	filtered.unshift(entry);
	return filtered.slice(0, MAX_RECENT);
}

export function addRecentFile(filePath: string): void {
	if (!filePath) {
		return;
	}
	try {
		app.addRecentDocument(filePath);
	} catch (err) {
		console.warn('[native-recent-files] app.addRecentDocument failed:', err);
	}
	const state = loadState();
	state.files = pushRecent(state.files, filePath);
	state.timestamp = Date.now();
	saveState(state);
}

export function addRecentFolder(folderPath: string): void {
	if (!folderPath) {
		return;
	}
	const state = loadState();
	state.folders = pushRecent(state.folders, folderPath);
	state.timestamp = Date.now();
	saveState(state);
}

export function clearRecents(): void {
	try {
		app.clearRecentDocuments();
	} catch (err) {
		console.warn('[native-recent-files] app.clearRecentDocuments failed:', err);
	}
	saveState({ files: [], folders: [], timestamp: Date.now() });
}

export function getRecentFiles(): string[] {
	return loadState().files;
}

export function getRecentFolders(): string[] {
	return loadState().folders;
}

export function getRecentFilesAndFolders(): { files: string[]; folders: string[] } {
	const state = loadState();
	return { files: state.files, folders: state.folders };
}

export function removeRecentFile(filePath: string): void {
	const state = loadState();
	state.files = state.files.filter((f) => f !== filePath);
	state.timestamp = Date.now();
	saveState(state);
}

export function removeRecentFolder(folderPath: string): void {
	const state = loadState();
	state.folders = state.folders.filter((f) => f !== folderPath);
	state.timestamp = Date.now();
	saveState(state);
}

export function isRecentDocumentsSupported(): boolean {
	return process.platform === 'win32' || process.platform === 'darwin';
}

export function getRecentFileCount(): number {
	return loadState().files.length;
}
