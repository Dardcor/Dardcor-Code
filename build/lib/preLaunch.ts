import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = []) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
		child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
		child.on('error', reject);
	});
}

async function exists(subdir: string) {
	try {
		await fs.stat(path.join(rootDir, subdir));
		return true;
	} catch {
		return false;
	}
}

async function ensureNodeModules() {
	if (!(await exists('node_modules'))) {
		await runProcess(npm, ['ci']);
	}
}

async function getElectron() {
	if (await isExpectedElectronInstalled()) {
		return;
	}
	await runProcess(npm, ['run', 'electron']);
}

async function isExpectedElectronInstalled(): Promise<boolean> {
	try {
		const { getElectronVersion } = await import('./util.ts');
		const { electronVersion } = getElectronVersion();
		const installedVersion = (await fs.readFile(path.join(rootDir, '.build', 'electron', 'version'), 'utf8')).trim().replace(/^v/, '');
		return installedVersion === electronVersion;
	} catch {
		return false;
	}
}

async function ensureCompiled() {
	const coreFiles = [
		path.join('out', 'main.js'),
		path.join('out', 'dc', 'platform', 'environment', 'node', 'userDataPath.js'),
		path.join('out', 'dc', 'workbench', 'workbench.desktop.main.js'),
	];

	const requiredFiles = [
		...coreFiles,
		path.join('out', '.build-done'),
	];

	let isComplete = await exists('out');
	if (isComplete) {
		const hasCoreFiles = (await Promise.all(coreFiles.map(f => exists(f)))).every(Boolean);
		if (hasCoreFiles && !(await exists(path.join('out', '.build-done')))) {
			try {
				await fs.writeFile(
					path.join(rootDir, 'out', '.build-done'),
					JSON.stringify({ timestamp: new Date().toISOString(), status: 'complete', source: 'compile' }, null, 2),
					'utf8'
				);
			} catch {}
		}

		for (const file of requiredFiles) {
			if (!(await exists(file))) {
				isComplete = false;
				break;
			}
		}
	}

	if (!isComplete) {
		console.log('[preLaunch] Client build is missing or incomplete. Transpiling client...');
		await runProcess(npm, ['run', 'transpile-client']);
	}
}

async function main() {
	await ensureNodeModules();
	await getElectron();
	await ensureCompiled();

	const { getBuiltInExtensions } = await import('./builtInExtensions.ts');
	await getBuiltInExtensions();
}

if (import.meta.main || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
