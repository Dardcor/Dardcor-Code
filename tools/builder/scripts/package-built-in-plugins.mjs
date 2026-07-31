/**
 * Dardcor Code - Built-in Extension Packaging Pipeline (Task 905)
 *
 * Scans `plugins/built-in/*` manifests, validates them, then packages each
 * plugin into a distributable VSIX-style zip under `dist/plugins`, plus an
 * aggregated `plugins-manifest.json` that the extension host loads at startup.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createZip } from '../packaging/vsix-packager.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLUGINS_DIR = path.join(ROOT, 'plugins', 'built-in');
const OUT_DIR = path.join(ROOT, 'dist', 'plugins');

const REQUIRED_FIELDS = ['name', 'version', 'publisher'];
const NAME_PATTERN = /^[a-z0-9][a-z0-9-_.]*$/i;

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		out: path.resolve(ROOT, opt('--out', OUT_DIR)),
		src: path.resolve(ROOT, opt('--src', PLUGINS_DIR)),
		skipZip: argv.includes('--skip-zip'),
	};
}

function listPluginDirs(srcDir) {
	if (!fs.existsSync(srcDir)) return [];
	return fs.readdirSync(srcDir, { withFileTypes: true })
		.filter(e => e.isDirectory())
		.map(e => e.name);
}

function validateManifest(pkg, dirName) {
	const problems = [];
	for (const field of REQUIRED_FIELDS) {
		if (!pkg[field]) problems.push(`missing "${field}"`);
	}
	if (pkg.name && !NAME_PATTERN.test(pkg.name)) problems.push(`invalid name "${pkg.name}"`);
	if (pkg.version && !/^\d+\.\d+\.\d+/.test(pkg.version)) problems.push(`invalid version "${pkg.version}"`);
	if (pkg.main && !fs.existsSync(path.join(PLUGINS_DIR, dirName, pkg.main))) problems.push(`main not found: ${pkg.main}`);
	return problems;
}

function collectFiles(dir, prefix = '') {
	const entries = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') continue;
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) entries.push(...collectFiles(abs, rel));
		else entries.push({ name: rel, data: fs.readFileSync(abs) });
	}
	return entries;
}

async function packagePlugin(pluginDir, name, outDir, skipZip) {
	const pkgPath = path.join(pluginDir, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		return { name, ok: false, error: 'no package.json' };
	}
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	const problems = validateManifest(pkg, name);
	if (problems.length > 0) {
		return { name, ok: false, error: problems.join('; ') };
	}

	const targetDir = path.join(outDir, name);
	fs.mkdirSync(targetDir, { recursive: true });
	const files = collectFiles(pluginDir);
	for (const file of files) {
		const dest = path.join(targetDir, ...file.name.split('/'));
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, file.data);
	}
	// per-plugin zip
	if (!skipZip) {
		const zipEntries = [
			{ name: '[Content_Types].xml', data: contentTypesXml() },
			{ name: 'extension/package.json', data: JSON.stringify(pkg, null, '\t') },
			...files.filter(f => f.name !== 'package.json').map(f => ({ name: `extension/${f.name}`, data: f.data })),
		];
		const zip = createZip(zipEntries);
		fs.writeFileSync(path.join(outDir, `${name}-${pkg.version}.vsix`), zip);
	}
	return { name, ok: true, version: pkg.version, files: files.length };
}

function contentTypesXml() {
	return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension="json" ContentType="application/json" />
	<Default Extension="js" ContentType="text/javascript" />
	<Default Extension="css" ContentType="text/css" />
	<Default Extension="svg" ContentType="image/svg+xml" />
</Types>`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(args.src)) {
		console.warn(`[package-built-in-plugins] plugins dir not found: ${args.src}`);
		process.exit(0);
	}
	fs.mkdirSync(args.out, { recursive: true });
	const results = [];
	for (const dirName of listPluginDirs(args.src)) {
		const result = await packagePlugin(path.join(args.src, dirName), dirName, args.out, args.skipZip);
		results.push(result);
		if (result.ok) console.log(`[package-built-in-plugins] ${result.name} v${result.version}: ${result.files} files packaged`);
		else console.error(`[package-built-in-plugins] ${result.name}: FAILED (${result.error})`);
	}
	const manifest = {
		generatedAt: new Date().toISOString(),
		plugins: results.map(r => ({ name: r.name, ok: r.ok, version: r.version, error: r.error })),
	};
	fs.writeFileSync(path.join(args.out, 'plugins-manifest.json'), JSON.stringify(manifest, null, '\t'));
	const failed = results.filter(r => !r.ok).length;
	console.log(`[package-built-in-plugins] packaged ${results.length - failed}/${results.length} plugins -> ${args.out}`);
	process.exit(failed > 0 ? 1 : 0);
}

export { packagePlugin, validateManifest, listPluginDirs };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[package-built-in-plugins] fatal:', err);
		process.exit(1);
	});
}
