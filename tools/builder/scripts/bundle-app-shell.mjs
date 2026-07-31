/**
 * Dardcor Code - Production Bundler Script for App Shell (Task 902)
 *
 * Reads the shared esbuild configuration from ../config/esbuild.config.js
 * and bundles the workbench app shell (plus web entry) into dist/bundle.
 * Uses `esbuild` when installed; otherwise performs a structural copy
 * fallback so the pipeline remains usable without extra dependencies.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONFIG_URL = new URL('../config/esbuild.config.js', import.meta.url);
const OUT_DIR = path.join(ROOT, 'dist', 'bundle');
const BUNDLE_NAMES = ['app-shell', 'web-workbench'];

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		watch: argv.includes('--watch') || argv.includes('-w'),
		minify: argv.includes('--minify') || argv.includes('--production'),
		output: path.resolve(ROOT, opt('--out', 'dist/bundle')),
	};
}

async function loadConfig() {
	const mod = await import(CONFIG_URL.href);
	return mod.default;
}

function copyTree(src, dest) {
	if (!fs.existsSync(src)) {
		return 0;
	}
	let count = 0;
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const from = path.join(src, entry.name);
		const to = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			count += copyTree(from, to);
		} else {
			fs.mkdirSync(path.dirname(to), { recursive: true });
			fs.copyFileSync(from, to);
			count++;
		}
	}
	return count;
}

async function bundleWithEsbuild(esbuild, config, args) {
	const targets = config.targets.filter(t => BUNDLE_NAMES.includes(t.name));
	const builds = [];
	for (const target of targets) {
		console.log(`[bundle-app-shell] bundling "${target.name}" (entry: ${target.entry})`);
		const result = await esbuild.build({
			absWorkingDir: ROOT,
			entryPoints: [target.entry],
			outdir: args.output,
			outbase: path.dirname(target.entry),
			bundle: true,
			format: 'esm',
			target: 'es2022',
			platform: 'browser',
			sourcemap: !args.minify ? 'external' : false,
			minify: args.minify,
			logLevel: 'info',
		});
		builds.push(result);
	}
	if (args.watch) {
		const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
		const entries = targets.map(t => t.entry).join(' ');
		const child = spawn(cmd, ['esbuild', ...targets.map(t => t.entry), '--bundle', '--format=esm', '--outdir=' + args.output, '--watch'], {
			cwd: ROOT,
			stdio: 'inherit',
		});
		child.on('error', err => console.warn('[bundle-app-shell] watch unavailable:', err.message));
	}
	return builds;
}

async function fallbackCopy(config, args) {
	console.warn('[bundle-app-shell] esbuild not installed - using fallback copy (NOT a real bundle)');
	let copied = 0;
	for (const target of config.targets.filter(t => BUNDLE_NAMES.includes(t.name))) {
		const srcDir = path.dirname(path.resolve(ROOT, target.entry));
		copied += copyTree(srcDir, args.output);
	}
	// copy static assets
	copied += copyTree(path.join(ROOT, 'public'), args.output);
	fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(args.output, 'index.html'));
	console.log(`[bundle-app-shell] fallback copied ${copied} files to ${args.output}`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const config = await loadConfig();
	if (!config || !Array.isArray(config.targets)) {
		console.error('[bundle-app-shell] invalid esbuild.config.js - expected { targets: [...] }');
		process.exit(1);
	}
	const esbuild = await import('esbuild').catch(() => null);
	if (esbuild) {
		await bundleWithEsbuild(esbuild, config, args);
	} else {
		await fallbackCopy(config, args);
	}
	const outputs = config.targets.filter(t => BUNDLE_NAMES.includes(t.name)).map(t => t.name);
	console.log(`[bundle-app-shell] done: ${outputs.join(', ')} -> ${args.output}`);
}

export { loadConfig, bundleWithEsbuild, fallbackCopy, BUNDLE_NAMES };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[bundle-app-shell] fatal:', err);
		process.exit(1);
	});
}
