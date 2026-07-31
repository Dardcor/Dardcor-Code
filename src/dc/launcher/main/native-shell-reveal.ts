import { shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export function revealInShell(filePath: string): void {
	if (!filePath) {
		return;
	}
	try {
		if (fs.existsSync(filePath)) {
			const stat = fs.statSync(filePath);
			if (stat.isDirectory()) {
				shell.openPath(filePath);
				return;
			}
			shell.showItemInFolder(filePath);
			return;
		}
	} catch (err) {
		console.warn('[native-shell-reveal] stat failed:', err);
	}
	const dir = path.dirname(filePath);
	if (fs.existsSync(dir)) {
		shell.openPath(dir);
	}
}

export function selectInShell(filePath: string): void {
	revealInShell(filePath);
}

export async function revealInDefaultApp(filePath: string): Promise<string> {
	if (!filePath || !fs.existsSync(filePath)) {
		return `File does not exist: ${filePath}`;
	}
	return shell.openPath(filePath);
}

export async function openDirectory(dirPath: string): Promise<string> {
	if (!fs.existsSync(dirPath)) {
		return `Directory does not exist: ${dirPath}`;
	}
	return shell.openPath(dirPath);
}

export async function openPathExternal(filePath: string): Promise<string> {
	return revealInDefaultApp(filePath);
}

export function revealMultiple(items: string[]): void {
	for (const item of items) {
		revealInShell(item);
	}
}

export function getRevealTarget(filePath: string): string {
	return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);
}

export async function revealAndReport(filePath: string): Promise<boolean> {
	const error = await revealInDefaultApp(filePath);
	return error === '';
}

export function isPathAccessible(filePath: string): boolean {
	try {
		fs.accessSync(filePath);
		return true;
	} catch {
		return false;
	}
}
