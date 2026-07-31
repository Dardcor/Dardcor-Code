import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export interface FileAssociation {
	extension: string;
	description: string;
	icon?: string;
	command?: string;
}

const ASSOCIATION_EXTENSIONS: string[] = [
	'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
	'json', 'html', 'htm', 'css', 'scss', 'less', 'md'
];

const EXTENSION_DESCRIPTIONS: Record<string, string> = {
	ts: 'TypeScript Source File',
	tsx: 'TypeScript React Source File',
	js: 'JavaScript Source File',
	jsx: 'JavaScript React Source File',
	mjs: 'JavaScript Module',
	cjs: 'CommonJS Module',
	json: 'JSON Data File',
	html: 'HTML Document',
	htm: 'HTML Document',
	css: 'CSS Stylesheet',
	scss: 'SCSS Stylesheet',
	less: 'LESS Stylesheet',
	md: 'Markdown Document'
};

export function isWindows(): boolean {
	return process.platform === 'win32';
}

export function isSupportedPlatform(): boolean {
	return process.platform === 'win32';
}

export function getFileAssociations(): FileAssociation[] {
	return ASSOCIATION_EXTENSIONS.map((extension) => ({
		extension,
		description: EXTENSION_DESCRIPTIONS[extension] ?? `${extension.toUpperCase()} File`,
		icon: '',
		command: getExecutablePath()
	}));
}

export function getExecutablePath(): string {
	return process.execPath;
}

export function registerFileAssociations(): Promise<boolean> {
	if (!isSupportedPlatform()) {
		return Promise.resolve(false);
	}
	const associations = getFileAssociations();
	const commands: Promise<boolean>[] = [];
	for (const association of associations) {
		commands.push(registerExtensionAssociation(association));
	}
	return Promise.all(commands).then((results) => results.every((r) => r));
}

export function registerExtensionAssociation(association: FileAssociation): Promise<boolean> {
	if (!isWindows()) {
		return registerLinuxAssociation(association);
	}
	const exe = association.command ?? getExecutablePath();
	const ext = association.extension;
	const quotedExe = `"${exe}"`;
	const progId = `DardcorCode.${ext}`;
	const steps: string[][] = [
		['add', `HKCU\\Software\\Classes\\.${ext}`, '/ve', '/d', progId, '/f'],
		['add', `HKCU\\Software\\Classes\\${progId}`, '/ve', '/d', association.description, '/f'],
		['add', `HKCU\\Software\\Classes\\${progId}\\DefaultIcon`, '/ve', '/d', `${quotedExe},0`, '/f'],
		['add', `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`, '/ve', '/d', `${quotedExe} "%1"`, '/f']
	];
	return runRegistrySteps(steps);
}

export function registerLinuxAssociation(association: FileAssociation): Promise<boolean> {
	if (process.platform !== 'linux') {
		return Promise.resolve(false);
	}
	return new Promise((resolve) => {
		const appsDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.local', 'share', 'applications');
		const exe = association.command ?? getExecutablePath();
		const desktopEntry = [
			'[Desktop Entry]',
			'Type=Application',
			'Name=Dardcor Code',
			`Exec=${exe} %f`,
			`MimeType=x-scheme-handler/${association.extension.replace('.', '')}`,
			'Terminal=false',
			'Categories=Development;IDE;'
		].join('\n');
		try {
			fs.mkdirSync(appsDir, { recursive: true });
			const entryPath = path.join(appsDir, `dardcor-code-${association.extension}.desktop`);
			fs.writeFileSync(entryPath, desktopEntry, 'utf-8');
			resolve(true);
		} catch (err) {
			console.error('[native-file-associations] linux registration failed:', err);
			resolve(false);
		}
	});
}

export function unregisterFileAssociations(): Promise<boolean> {
	if (!isWindows()) {
		return Promise.resolve(false);
	}
	const steps: string[][] = [];
	for (const extension of ASSOCIATION_EXTENSIONS) {
		const progId = `DardcorCode.${extension}`;
		steps.push(['delete', `HKCU\\Software\\Classes\\.${extension}`, '/f']);
		steps.push(['delete', `HKCU\\Software\\Classes\\${progId}`, '/f']);
	}
	return runRegistrySteps(steps);
}

export async function isExtensionRegistered(extension: string): Promise<boolean> {
	if (!isWindows()) {
		return false;
	}
	return new Promise((resolve) => {
		const child = spawn('reg', ['query', `HKCU\\Software\\Classes\\.${extension}`], {
			windowsHide: true
		});
		let output = '';
		child.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});
		child.on('error', () => resolve(false));
		child.on('close', (code) => {
			resolve(code === 0 && output.length > 0);
		});
	});
}

export function registerAsProtocolClient(scheme: string): boolean {
	try {
		return app.setAsDefaultProtocolClient(scheme);
	} catch (err) {
		console.warn(`[native-file-associations] failed to register protocol '${scheme}':`, err);
		return false;
	}
}

function runRegistrySteps(steps: string[][]): Promise<boolean> {
	let chain: Promise<boolean> = Promise.resolve(true);
	for (const args of steps) {
		chain = chain.then((ok) => (ok ? runRegCommand(args) : false));
	}
	return chain;
}

function runRegCommand(args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const child = spawn('reg', args, { windowsHide: true });
			child.on('error', () => resolve(false));
			child.on('close', (code) => resolve(code === 0));
		} catch {
			resolve(false);
		}
	});
}

export function getAssociationIconPath(extension: string): string {
	return path.join(app.getAppPath(), 'public', 'dardcor-code.png');
}
