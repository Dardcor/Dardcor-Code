/**
 * Dardcor Code - Automated App Launch Smoke Test Validator (Task 912)
 *
 * Verifies the application can be compiled, launched, and stays alive
 * without crashing for a grace period. Checks:
 *   1. dist output exists (compiles first if missing)
 *   2. electron main entry resolves
 *   3. `electron .` spawns and prints no fatal errors before being killed
 */

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MAIN_ENTRY = path.join(ROOT, 'dist', 'dc', 'launcher', 'main', 'electron-main.js');

const FATAL_PATTERNS = [
	/Cannot find module/,
	/Error:\s+/,
	/UnhandledPromiseRejection/,
	/TypeError:\s+/,
	/ReferenceError:\s+/,
	/throw new Error/,
	/ERROR:\s+/,
];

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		timeoutMs: Number(opt('--timeout', 15000)),
		compile: !argv.includes('--no-compile'),
		ci: argv.includes('--ci'),
		flags: argv.filter(a => a.startsWith('--electron-flag=')).map(a => a.split('=')[1]),
	};
}

function ensureDist(args) {
	if (fs.existsSync(MAIN_ENTRY)) {
		console.log(`[smoke-test] dist main entry present: ${path.relative(ROOT, MAIN_ENTRY)}`);
		return true;
	}
	if (!args.compile) {
		console.error('[smoke-test] dist missing and --no-compile given');
		return false;
	}
	console.log('[smoke-test] dist missing - compiling...');
	const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
	const result = spawnSync(cmd, ['tsc', '-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'pipe' });
	if (result.status !== 0) {
		console.error('[smoke-test] compile failed:\n' + result.stdout?.toString());
		return false;
	}
	return fs.existsSync(MAIN_ENTRY);
}

function launch(args) {
	return new Promise(resolve => {
		const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
		const bin = fs.existsSync(electronBin) ? electronBin : 'electron';
		const electronArgs = ['.', '--no-sandbox', '--disable-gpu'];
		if (args.ci && process.platform === 'linux') {
			electronArgs.unshift('-e', 'xvfb-run', '-a');
		}
		electronArgs.push(...args.flags.map(f => '--' + f));

		const child = spawn(bin, electronArgs, {
			cwd: ROOT,
			env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', DC_SMOKE_TEST: '1' },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let output = '';
		const events = [];
		const onData = chunk => {
			const text = chunk.toString();
			output += text;
			for (const line of text.split(/\r?\n/)) {
				if (!line.trim()) continue;
				events.push({ t: Date.now(), line: line.slice(0, 300) });
			}
			process.stdout.write('[app] ' + text);
		};
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);

		const timer = setTimeout(() => {
			const fatal = events.some(e => FATAL_PATTERNS.some(p => p.test(e.line)));
			child.kill();
			resolve({
				status: fatal ? 'fail' : 'pass',
				reason: fatal ? 'fatal error pattern matched in output' : `alive for ${args.timeoutMs}ms without crashing`,
				aliveMs: args.timeoutMs,
				output,
			});
		}, args.timeoutMs);

		child.on('error', err => {
			clearTimeout(timer);
			resolve({ status: 'fail', reason: 'spawn failed: ' + err.message, aliveMs: 0, output });
		});
		child.on('close', (code, signal) => {
			if (timer._destroyed) return;
			clearTimeout(timer);
			const fatal = events.some(e => FATAL_PATTERNS.some(p => p.test(e.line)));
			if (fatal) {
				resolve({ status: 'fail', reason: 'process exited with fatal output', aliveMs: 0, code, output });
			} else if (code === 0) {
				// Clean exit (e.g. user quit) is not a crash.
				resolve({ status: 'pass', reason: 'clean exit', aliveMs: 0, code, output });
			} else {
				resolve({ status: 'fail', reason: `exited early with code ${code}`, aliveMs: 0, code, output });
			}
		});
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!ensureDist(args)) {
		process.exit(1);
	}
	console.log('[smoke-test] launching application...');
	const result = await launch(args);
	console.log(`\n[smoke-test] ${result.status.toUpperCase()}: ${result.reason}`);
	if (result.aliveMs > 0) {
		console.log(`[smoke-test] app stayed alive ${result.aliveMs}ms`);
	}
	if (result.status === 'pass') {
		console.log('[smoke-test] SMOKE TEST PASSED');
		process.exit(0);
	}
	console.error('[smoke-test] SMOKE TEST FAILED');
	process.exit(1);
}

export { launch, ensureDist, FATAL_PATTERNS };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[smoke-test] fatal:', err);
		process.exit(1);
	});
}
