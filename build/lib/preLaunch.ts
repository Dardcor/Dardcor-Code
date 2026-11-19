import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import * as util from './util.ts';
import { getVersion } from './getVersion.ts';
import { ensureWindowsElectronPermissions } from './windowsElectronPermissions.ts';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = []) {
	return new Promise<void>((resolve, reject) => {
		const npmExecPath = process.env['npm_execpath'];
		const canRunNpmCliDirectly = command === npm && !!npmExecPath && path.isAbsolute(npmExecPath);
		const executable = canRunNpmCliDirectly ? process.execPath : command;
		const executableArgs = canRunNpmCliDirectly ? [npmExecPath, ...args] : args;
		const child = spawn(executable, executableArgs, {
			cwd: rootDir,
			stdio: 'inherit',
			env: process.env,
			shell: process.platform === 'win32' && !canRunNpmCliDirectly
		});
		child.once('error', error => reject(new Error(`Failed to start ${command}: ${error.message}`, { cause: error })));
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			const result = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
			reject(new Error(`${command} ${args.join(' ')} failed with ${result}.`));
		});
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
		const { electronVersion } = util.getElectronVersion();
		const product = JSON.parse(await fs.readFile(path.join(rootDir, 'product.json'), 'utf8')) as { nameShort: string; win32VersionedUpdate?: boolean };
		const commit = getVersion(rootDir);
		if (process.platform === 'win32' && product.win32VersionedUpdate && !commit) {
			return false;
		}

		const resourcesFolder = commit ? util.getVersionedResourcesFolder(process.platform, commit) : '';
		const electronRoot = path.join(rootDir, '.build', 'electron');
		const resourceRoot = path.join(electronRoot, resourcesFolder);
		const installedVersion = (await fs.readFile(path.join(resourceRoot, 'version'), 'utf8')).trim().replace(/^v/, '');
		if (installedVersion !== electronVersion) {
			return false;
		}

		if (process.platform === 'win32') {
			const requiredFiles = [
				path.join(electronRoot, `${product.nameShort}.exe`),
				path.join(resourceRoot, 'icudtl.dat'),
				path.join(resourceRoot, 'resources.pak')
			];
			const fileStats = await Promise.all(requiredFiles.map(file => fs.stat(file)));
			return fileStats.every(stat => stat.isFile() && stat.size > 0);
		}

		return true;
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
	await ensureWindowsElectronPermissions(path.join(rootDir, '.build', 'electron'));
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
