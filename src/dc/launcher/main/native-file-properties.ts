import { BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { formatBytes } from './native-file-trash.js';

export interface FileProperties {
	name: string;
	path: string;
	size: number;
	sizeHuman: string;
	created: string;
	modified: string;
	accessed: string;
	isDirectory: boolean;
	isFile: boolean;
	isSymbolicLink: boolean;
	permissions: string;
	permissionsOctal: string;
	owner: string;
	extension: string;
	fileType: string;
}

export function getFileProperties(filePath: string): FileProperties | null {
	try {
		const stat = fs.statSync(filePath, { throwIfNoEntry: true });
		const owner = `${stat.uid}:${stat.gid}`;
		return {
			name: path.basename(filePath),
			path: filePath,
			size: stat.size,
			sizeHuman: formatBytes(stat.size),
			created: new Date(stat.birthtime).toLocaleString(),
			modified: new Date(stat.mtime).toLocaleString(),
			accessed: new Date(stat.atime).toLocaleString(),
			isDirectory: stat.isDirectory(),
			isFile: stat.isFile(),
			isSymbolicLink: stat.isSymbolicLink(),
			permissions: formatPermissions(stat.mode),
			permissionsOctal: (stat.mode & 0o777).toString(8).padStart(3, '0'),
			owner: process.platform === 'win32' ? 'N/A' : owner,
			extension: path.extname(filePath).replace('.', ''),
			fileType: stat.isDirectory() ? 'Folder' : stat.isSymbolicLink() ? 'Symbolic Link' : 'File'
		};
	} catch {
		return null;
	}
}

export function formatPermissions(mode: number): string {
	const r = (bits: number): string => (bits & 4 ? 'r' : '-');
	const w = (bits: number): string => (bits & 2 ? 'w' : '-');
	const x = (bits: number): string => (bits & 1 ? 'x' : '-');
	const owner = (mode >> 6) & 7;
	const group = (mode >> 3) & 7;
	const other = mode & 7;
	return `${r(owner)}${w(owner)}${x(owner)}${r(group)}${w(group)}${x(group)}${r(other)}${w(other)}${x(other)}`;
}

export function buildPropertiesDetail(props: FileProperties): string {
	const lines: string[] = [];
	lines.push(`Name: ${props.name}`);
	lines.push(`Path: ${props.path}`);
	lines.push(`Type: ${props.fileType}`);
	lines.push(`Size: ${props.sizeHuman} (${props.size} bytes)`);
	lines.push(`Created: ${props.created}`);
	lines.push(`Modified: ${props.modified}`);
	lines.push(`Accessed: ${props.accessed}`);
	lines.push(`Permissions: ${props.permissions} (${props.permissionsOctal})`);
	lines.push(`Owner: ${props.owner}`);
	lines.push(`Extension: ${props.extension || '(none)'}`);
	return lines.join('\n');
}

export async function showFileProperties(window: BrowserWindow | null | undefined, filePath: string): Promise<boolean> {
	const props = getFileProperties(filePath);
	if (!props) {
		const parent = window && !window.isDestroyed() ? window : undefined;
		const options = {
			type: 'error' as const,
			title: 'File Properties',
			message: 'Could not read file properties',
			detail: `Unable to access: ${filePath}`,
			buttons: ['OK']
		};
		if (parent) {
			await dialog.showMessageBox(parent, options);
		} else {
			await dialog.showMessageBox(options);
		}
		return false;
	}

	const parent = window && !window.isDestroyed() ? window : undefined;
	const options = {
		type: 'info' as const,
		title: 'File Properties',
		message: props.name,
		detail: buildPropertiesDetail(props),
		buttons: ['OK'],
		noLink: true
	};
	if (parent) {
		await dialog.showMessageBox(parent, options);
	} else {
		await dialog.showMessageBox(options);
	}
	return true;
}

export async function showFolderProperties(window: BrowserWindow | null | undefined, folderPath: string): Promise<boolean> {
	const props = getFileProperties(folderPath);
	if (!props) {
		return showFileProperties(window, folderPath);
	}
	let itemCount = 0;
	let totalSize = 0;
	try {
		for (const entry of fs.readdirSync(folderPath)) {
			try {
				const stat = fs.statSync(path.join(folderPath, entry));
				itemCount++;
				totalSize += stat.size;
			} catch {
				itemCount++;
			}
		}
	} catch {
		// Ignore read errors.
	}
	const parent = window && !window.isDestroyed() ? window : undefined;
	const detail = [
		buildPropertiesDetail(props),
		`Contains: ${itemCount} items`,
		`Total size: ${formatBytes(totalSize)}`
	].join('\n');
	const options = {
		type: 'info' as const,
		title: 'Folder Properties',
		message: props.name,
		detail,
		buttons: ['OK'],
		noLink: true
	};
	if (parent) {
		await dialog.showMessageBox(parent, options);
	} else {
		await dialog.showMessageBox(options);
	}
	return true;
}
