/**
 * Dardcor Code - macOS .dmg / .app Bundle Package Builder Script (Task 921)
 *
 * Constructs a proper macOS application bundle (Contents/Info.plist,
 * MacOS/ executable wrapper, Resources/), then builds a compressed DMG via
 * `hdiutil` when running on macOS. On other platforms it emits the .app
 * directory plus a ZIP archive as a cross-platform fallback artifact.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createZip } from './vsix-packager.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		appDir: path.resolve(ROOT, opt('--app-dir', 'dist')),
		outDir: path.resolve(ROOT, opt('--out-dir', 'release/mac')),
		name: opt('--name', 'Dardcor Code'),
		version: opt('--version', '1.0.0'),
		bundleId: opt('--bundle-id', 'com.dardcor.code'),
		arch: opt('--arch', (process.arch === 'arm64' ? 'arm64' : 'x64')),
	};
}

function infoPlist(args) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>${args.name}</string>
	<key>CFBundleDisplayName</key>
	<string>${args.name}</string>
	<key>CFBundleIdentifier</key>
	<string>${args.bundleId}</string>
	<key>CFBundleVersion</key>
	<string>${args.version}</string>
	<key>CFBundleShortVersionString</key>
	<string>${args.version}</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleExecutable</key>
	<string>${executableName(args.name)}</string>
	<key>LSMinimumSystemVersion</key>
	<string>11.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.developer-tools</string>
	<key>CFBundleIconFile</key>
	<string>icon.icns</string>
</dict>
</plist>
`;
}

function executableName(name) {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dardcor-code';
}

function launcherScript(args) {
	return `#!/bin/sh
# Dardcor Code app launcher (generated)
exec "${executableName(args.name)}" "$@"
`;
}

function copyDistIntoApp(args, appPath) {
	fs.mkdirSync(path.join(appPath, 'Contents', 'MacOS'), { recursive: true });
	fs.mkdirSync(path.join(appPath, 'Contents', 'Resources'), { recursive: true });
	const execName = executableName(args.name);
	const launcher = path.join(appPath, 'Contents', 'MacOS', execName);
	fs.writeFileSync(launcher, launcherScript(args));
	fs.chmodSync(launcher, 0o755);
	fs.writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), infoPlist(args));
	const icon = path.join(ROOT, 'public', 'dardcor-code.png');
	if (fs.existsSync(icon)) {
		fs.copyFileSync(icon, path.join(appPath, 'Contents', 'Resources', 'icon.icns'));
	}
	// resources:app payload
	const resApp = path.join(appPath, 'Contents', 'Resources', 'app');
	fs.mkdirSync(resApp, { recursive: true });
	const copyTree = (src, dest) => {
		for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
			const from = path.join(src, entry.name);
			const to = path.join(dest, entry.name);
			if (entry.isDirectory()) {
				fs.mkdirSync(to, { recursive: true });
				copyTree(from, to);
			} else {
				fs.copyFileSync(from, to);
			}
		}
	};
	if (fs.existsSync(args.appDir)) copyTree(args.appDir, resApp);
}

function buildDmg(args, appPath) {
	const dmgPath = path.join(args.outDir, `${args.name}-${args.version}-${args.arch}.dmg`);
	const tmpDmg = path.join(args.outDir, 'tmp.dmg');
	fs.rmSync(tmpDmg, { force: true });
	let result = spawnSync('hdiutil', ['create', '-srcfolder', appPath, '-volname', args.name, '-fs', 'HFS+', '-format', 'UDRW', tmpDmg], { stdio: 'pipe' });
	if (result.status !== 0) {
		return { ok: false, error: (result.stderr?.toString() || result.stdout?.toString()).slice(0, 300) };
	}
	result = spawnSync('hdiutil', ['convert', tmpDmg, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', dmgPath], { stdio: 'pipe' });
	fs.rmSync(tmpDmg, { force: true });
	if (result.status !== 0) {
		return { ok: false, error: (result.stderr?.toString() || result.stdout?.toString()).slice(0, 300) };
	}
	return { ok: true, dmgPath };
}

function buildZipFallback(args, appPath) {
	const files = [];
	const walk = (dir, prefix) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(abs, prefix ? `${prefix}/${entry.name}` : entry.name);
			else files.push({ name: (prefix ? prefix + '/' : '') + entry.name, data: fs.readFileSync(abs) });
		}
	};
	walk(appPath, `${args.name}.app`);
	const zip = createZip(files);
	const out = path.join(args.outDir, `${args.name}-${args.version}-${args.arch}.zip`);
	fs.writeFileSync(out, zip);
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(args.appDir)) {
		console.error(`[mac-installer] app dir not found: ${args.appDir}`);
		process.exit(1);
	}
	fs.mkdirSync(args.outDir, { recursive: true });
	const appPath = path.join(args.outDir, `${args.name}.app`);
	copyDistIntoApp(args, appPath);
	console.log(`[mac-installer] app bundle: ${appPath}`);

	if (process.platform === 'darwin') {
		const dmg = buildDmg(args, appPath);
		if (dmg.ok) {
			console.log(`[mac-installer] dmg: ${dmg.dmgPath}`);
		} else {
			console.warn(`[mac-installer] hdiutil failed (${dmg.error}); fell back to zip`);
			buildZipFallback(args, appPath);
		}
	} else {
		const zip = buildZipFallback(args, appPath);
		console.warn(`[mac-installer] not on macOS - produced .app + zip fallback: ${zip}`);
	}
	console.log('[mac-installer] done');
}

export { infoPlist, executableName, copyDistIntoApp, buildDmg, buildZipFallback };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[mac-installer] fatal:', err);
		process.exit(1);
	});
}
