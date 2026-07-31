/**
 * Dardcor Code - Production Bundler Script for Extension Host Worker (Task 903)
 *
 * Bundles the extension host worker entry into a single self-contained
 * ES module that can be spawned as a dedicated web worker / utility process.
 * Reads the extension-host target from ../config/esbuild.config.js.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONFIG_URL = new URL('../config/esbuild.config.js', import.meta.url);
const DEFAULT_OUT = path.join(ROOT, 'dist', 'extension-host');
const HOST_NAME = 'extension-host';

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		watch: argv.includes('--watch') || argv.includes('-w'),
		minify: argv.includes('--minify'),
		out: path.resolve(ROOT, opt('--out', DEFAULT_OUT)),
	};
}

async function loadConfig() {
	const mod = await import(CONFIG_URL.href);
	return mod.default;
}

async function bundleWithEsbuild(esbuild, config, args) {
	const target = config.targets.find(t => t.name === HOST_NAME);
	if (!target) {
		throw new Error(`esbuild.config.js has no "${HOST_NAME}" target`);
	}
	if (!fs.existsSync(path.resolve(ROOT, target.entry))) {
		console.warn(`[bundle-extension-host] entry not implemented yet, skipping: ${target.entry}`);
		return null;
	}
	fs.mkdirSync(args.out, { recursive: true });
	const outFile = path.join(args.out, 'extension-host.mjs');
	const result = await esbuild.build({
		absWorkingDir: ROOT,
		entryPoints: [target.entry],
		outfile: outFile,
		bundle: true,
		format: 'esm',
		target: 'es2022',
		platform: 'browser',
		conditions: ['worker'],
		sourcemap: !args.minify,
		minify: args.minify,
		logLevel: 'info',
	});
	console.log(`[bundle-extension-host] ${outFile} (${formatBytes(fs.statSync(outFile).size)})`);
	if (args.watch) {
		const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
		const child = spawn(cmd, ['esbuild', target.entry, '--bundle', '--format=esm', '--outfile=' + outFile, '--watch'], {
			cwd: ROOT,
			stdio: 'inherit',
		});
		child.on('error', err => console.warn('[bundle-extension-host] watch unavailable:', err.message));
	}
	return result;
}

async function fallbackCopy(target, args) {
	console.warn('[bundle-extension-host] esbuild not installed - using fallback copy (NOT a real bundle)');
	fs.mkdirSync(args.out, { recursive: true });
	const src = path.resolve(ROOT, target.entry);
	if (fs.existsSync(src)) {
		const dest = path.join(args.out, 'extension-host-entry.js');
		fs.copyFileSync(src, dest);
		console.log(`[bundle-extension-host] fallback copied entry to ${dest}`);
	} else {
		console.warn(`[bundle-extension-host] entry missing: ${src}`);
	}
}

function formatBytes(bytes) {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
	return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const config = await loadConfig();
	const target = config?.targets?.find(t => t.name === HOST_NAME);
	if (!target) {
		console.error('[bundle-extension-host] no extension-host target in esbuild.config.js');
		process.exit(1);
	}
	const esbuild = await import('esbuild').catch(() => null);
	if (esbuild) {
		await bundleWithEsbuild(esbuild, config, args);
	} else {
		await fallbackCopy(target, args);
	}
	console.log('[bundle-extension-host] done');
}

export { loadConfig, bundleWithEsbuild, formatBytes, HOST_NAME };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[bundle-extension-host] fatal:', err);
		process.exit(1);
	});
}
