import * as fs from 'fs';
import path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { dirsWithPackageJson } from './dirs.ts';
import { root, stateFile, stateContentsFile, computeState, computeContents, isUpToDate } from './installStateHash.ts';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function log(dir: string, message: string) {
	if (process.stdout.isTTY) {
		console.log(`\x1b[34m[${dir}]\x1b[0m`, message);
	} else {
		console.log(`[${dir}]`, message);
	}
}

function spawnAsync(command: string, args: string[], opts: child_process.SpawnOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = child_process.spawn(command, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
		child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Process exited with code: ${code}\n${output}`));
			} else {
				resolve(output);
			}
		});
	});
}

async function npmInstallAsync(dir: string, opts?: child_process.SpawnOptions): Promise<void> {
	const finalOpts: child_process.SpawnOptions = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: path.join(root, dir),
		shell: true,
	};

	const command = process.env['npm_command'] || 'install';

	log(dir, 'Installing dependencies...');
	const output = await spawnAsync(npm, command.split(' '), finalOpts);
	if (output.trim()) {
		for (const line of output.trim().split('\n')) {
			log(dir, line);
		}
	}
}

function setNpmrcConfig(dir: string, env: NodeJS.ProcessEnv) {
	const npmrcPath = path.join(root, dir, '.npmrc');
	const lines = fs.readFileSync(npmrcPath, 'utf8').split('\n');

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith('#')) {
			const [key, value] = trimmedLine.split('=');
			env[`npm_config_${key}`] = value.replace(/^"(.*)"$/, '$1');
		}
	}

	env['npm_config_node_gyp'] =
		process.platform === 'win32'
			? path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd')
			: path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp');

	if ((dir === 'remote' || dir === 'tools/builder') && process.platform === 'darwin') {
		env['npm_config_force_process_config'] = 'true';
	} else {
		delete env['npm_config_force_process_config'];
	}

	if (dir === 'tools/builder') {
		env['npm_config_arch'] = process.arch;
	}
}

function removeParcelWatcherPrebuild(dir: string) {
	const parcelModuleFolder = path.join(root, dir, 'node_modules', '@parcel');
	if (!fs.existsSync(parcelModuleFolder)) {
		return;
	}

	const parcelModules = fs.readdirSync(parcelModuleFolder);
	for (const moduleName of parcelModules) {
		if (moduleName.startsWith('watcher-')) {
			const modulePath = path.join(parcelModuleFolder, moduleName);
			fs.rmSync(modulePath, { recursive: true, force: true });
			log(dir, `Removed @parcel/watcher prebuilt module ${modulePath}`);
		}
	}
}

async function runWithConcurrency(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
	const errors: Error[] = [];
	let index = 0;

	async function worker() {
		while (index < tasks.length) {
			const i = index++;
			try {
				await tasks[i]();
			} catch (err) {
				errors.push(err as Error);
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

	if (errors.length > 0) {
		for (const err of errors) {
			console.error(err.message);
		}
		process.exit(1);
	}
}

async function main() {
	if (!process.env['DARDCOR_FORCE_INSTALL'] && isUpToDate()) {
		log('.', 'All dependencies up to date, skipping postinstall.');
		child_process.execSync('git config pull.rebase merges');
		child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
		return;
	}

	const _state = computeState();

	const nativeTasks: (() => Promise<void>)[] = [];
	const parallelTasks: (() => Promise<void>)[] = [];

	for (const dir of dirsWithPackageJson()) {
		if (dir === '') {
			removeParcelWatcherPrebuild(dir);
			continue;
		}

		if (dir === 'tools/builder') {
			nativeTasks.push(() => {
				const env: NodeJS.ProcessEnv = { ...process.env };
				if (process.env['CC']) { env['CC'] = 'gcc'; }
				if (process.env['CXX']) { env['CXX'] = 'g++'; }
				if (process.env['CXXFLAGS']) { env['CXXFLAGS'] = ''; }
				if (process.env['LDFLAGS']) { env['LDFLAGS'] = ''; }
				setNpmrcConfig('tools/builder', env);
				return npmInstallAsync('tools/builder', { env });
			});
			continue;
		}

		const taskDir = dir;
		parallelTasks.push(() => {
			const env = { ...process.env };
			return npmInstallAsync(taskDir, { env });
		});
	}

	for (const task of nativeTasks) {
		await task();
	}

	const concurrency = Math.min(os.cpus().length, 8);
	log('.', `Running ${parallelTasks.length} npm installs with concurrency ${concurrency}...`);
	await runWithConcurrency(parallelTasks, concurrency);

	child_process.execSync('git config pull.rebase merges');
	child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');

	fs.writeFileSync(stateFile, JSON.stringify(_state));
	fs.writeFileSync(stateContentsFile, JSON.stringify(computeContents()));
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
