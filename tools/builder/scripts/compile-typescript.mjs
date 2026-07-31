/**
 * Dardcor Code - Fast TypeScript Compiler Script (Task 901)
 *
 * Prefers `esbuild` when available (transform-per-file, no type check,
 * much faster than `tsc`). Falls back to spawning `tsc -p` which performs
 * full type checking. Supports `--watch`, `--out`, `--tsconfig`.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_TSCONFIG = path.join(ROOT, 'tsconfig.json');
const DEFAULT_OUT = path.join(ROOT, 'dist');

function parseArgs(argv) {
	const args = {
		watch: false,
		out: DEFAULT_OUT,
		tsconfig: DEFAULT_TSCONFIG,
		check: false,
		files: [],
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--watch' || arg === '-w') args.watch = true;
		else if (arg === '--check') args.check = true;
		else if (arg === '--out' || arg === '-o') args.out = argv[++i];
		else if (arg === '--tsconfig' || arg === '-p') args.tsconfig = argv[++i];
		else args.files.push(arg);
	}
	return args;
}

async function tryLoadEsbuild() {
	try {
		const mod = await import('esbuild');
		return mod;
	} catch {
		return null;
	}
}

function measure() {
	const start = process.hrtime.bigint();
	return () => Number(process.hrtime.bigint() - start) / 1e6;
}

async function compileWithEsbuild(esbuild, args) {
	const outDir = path.isAbsolute(args.out) ? args.out : path.resolve(ROOT, args.out);
	const tsconfigDir = path.dirname(args.tsconfig);
	const result = await esbuild.build({
		entryPoints: args.files.length > 0 ? args.files : undefined,
		absWorkingDir: ROOT,
		outdir: outDir,
		tsconfig: args.tsconfig,
		bundle: false,
		format: 'esm',
		target: 'es2022',
		platform: 'neutral',
		mainFields: ['module', 'main'],
		sourcemap: false,
		minify: false,
		write: true,
		logLevel: 'warning',
	});
	return result;
}

function compileWithTsc(args, onData) {
	return new Promise((resolve, reject) => {
		const tsconfigArg = path.relative(ROOT, args.tsconfig) || args.tsconfig;
		const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
		const tscArgs = ['tsc'];
		if (args.watch) tscArgs.push('--watch', '--preserveWatchOutput');
		else tscArgs.push('--noEmit');
		tscArgs.push('-p', tsconfigArg);
		const child = spawn(cmd, tscArgs, {
			cwd: ROOT,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		child.stdout.on('data', chunk => {
			stdout += chunk.toString();
			if (onData) onData(chunk.toString());
			process.stdout.write(chunk);
		});
		child.stderr.on('data', chunk => process.stderr.write(chunk));
		child.on('error', reject);
		child.on('close', code => {
			const errors = (stdout.match(/error TS\d+/g) || []).length;
			resolve({ code, errors, watch: args.watch });
		});
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const elapsed = measure();
	const esbuild = await tryLoadEsbuild();

	if (esbuild && !args.check) {
		try {
			const result = await compileWithEsbuild(esbuild, args);
			console.log(`[compile-typescript] esbuild: ${result.errors.length} errors, ${result.warnings.length} warnings in ${elapsed().toFixed(1)}ms`);
			if (args.watch) {
				// esbuild build API has no watch mode; run `esbuild` CLI in watch if requested
				const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
				const child = spawn(cmd, ['esbuild', ...(args.files.length ? args.files : ['src/dc/main.ts']), '--outdir=' + args.out, '--format=esm', '--watch'], {
					cwd: ROOT, stdio: 'inherit',
				});
				child.on('error', err => console.warn('[compile-typescript] esbuild watch unavailable:', err.message));
			}
			process.exit(result.errors.length > 0 ? 1 : 0);
		} catch (err) {
			console.error('[compile-typescript] esbuild failed, falling back to tsc:', err.message);
		}
	}

	console.log('[compile-typescript] using tsc (' + (args.check ? 'type-check only' : 'emit') + ')...');
	const result = await compileWithTsc(args);
	if (result.watch) {
		console.log('[compile-typescript] watching for changes (Ctrl+C to stop)...');
		return;
	}
	console.log(`[compile-typescript] tsc ${result.code === 0 ? 'OK' : 'FAILED'} (${result.errors} error(s)) in ${elapsed().toFixed(1)}ms`);
	process.exit(result.code);
}

export { compileWithTsc, compileWithEsbuild, tryLoadEsbuild, parseArgs, ROOT };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[compile-typescript] fatal:', err);
		process.exit(1);
	});
}
