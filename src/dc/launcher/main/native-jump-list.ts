import { app } from 'electron';
import * as path from 'path';

export interface JumpListTask {
	title: string;
	program: string;
	args: string;
	iconPath?: string;
	iconIndex?: number;
	description?: string;
}

export interface JumpListResult {
	ok: boolean;
	status?: string;
}

export function isJumpListSupported(): boolean {
	return process.platform === 'win32';
}

export function setJumpList(tasks: JumpListTask[]): JumpListResult {
	if (!isJumpListSupported() || !app.isReady()) {
		return { ok: false, status: 'unsupported' };
	}
	try {
		const taskItems = tasks.map((task) => ({
			type: 'task' as const,
			title: task.title,
			program: task.program,
			args: task.args,
			iconPath: task.iconPath,
			iconIndex: task.iconIndex,
			description: task.description ?? task.title
		}));
		const status = app.setJumpList([
			{ type: 'custom', name: 'Tasks', items: taskItems }
		]);
		return { ok: status === 'ok', status };
	} catch (err) {
		console.error('[native-jump-list] setJumpList failed:', err);
		return { ok: false, status: String(err) };
	}
}

export function clearJumpList(): JumpListResult {
	if (!isJumpListSupported() || !app.isReady()) {
		return { ok: false, status: 'unsupported' };
	}
	try {
		const status = app.setJumpList([]);
		return { ok: status === 'ok', status };
	} catch (err) {
		console.error('[native-jump-list] clearJumpList failed:', err);
		return { ok: false, status: String(err) };
	}
}

export function setDefaultJumpListTasks(): JumpListResult {
	return setJumpList([
		{ title: 'New File', program: process.execPath, args: '--new-file' },
		{ title: 'Open File', program: process.execPath, args: '--open-file' },
		{ title: 'Open Folder', program: process.execPath, args: '--open-folder' },
		{ title: 'Recent', program: process.execPath, args: '--recent' }
	]);
}

export function addRecentToJumpList(filePath: string): JumpListResult {
	if (!isJumpListSupported() || !app.isReady()) {
		return { ok: false, status: 'unsupported' };
	}
	try {
		const status = app.setJumpList([
			{ type: 'recent' },
			{
				type: 'custom',
				name: 'Tasks',
				items: [
					{ type: 'task', title: 'New File', program: process.execPath, args: '--new-file' },
					{ type: 'task', title: 'Open Folder', program: process.execPath, args: '--open-folder' }
				]
			}
		]);
		return { ok: status === 'ok', status };
	} catch (err) {
		return { ok: false, status: String(err) };
	}
}

export function removeRecentFromJumpList(filePath: string): void {
	try {
		app.clearRecentDocuments();
	} catch {
		// Ignore.
	}
}

export function getJumpListTasks(customName: string = 'Tasks'): JumpListTask[] {
	const tasks: JumpListTask[] = [
		{ title: 'New File', program: process.execPath, args: '--new-file' },
		{ title: 'Open File', program: process.execPath, args: '--open-file' },
		{ title: 'Open Folder', program: process.execPath, args: '--open-folder' },
		{ title: 'New Window', program: process.execPath, args: '--new-window' }
	];
	return tasks;
}

export function getDefaultIconPath(): string {
	return path.join(app.getAppPath(), 'public', 'dardcor-code.png');
}
