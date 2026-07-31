/**
 * Dardcor Code - Windows NSIS Executable Setup Package Build Script (Task 920)
 *
 * Generates a Unicode NSIS installer script for the packaged app and, when
 * `makensis` is available, compiles it into a setup .exe. Falls back to
 * producing the .nsi plus a portable ZIP archive of the dist output so the
 * pipeline still yields a distributable artifact without makensis.
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
		outDir: path.resolve(ROOT, opt('--out-dir', 'release/win')),
		name: opt('--name', 'Dardcor Code'),
		version: opt('--version', '1.0.0'),
		arch: opt('--arch', 'x64'),
		makensis: opt('--makensis', 'makensis'),
	};
}

function nsisScript(args) {
	const exeName = 'Dardcor Code.exe';
	return `; Dardcor Code - NSIS installer script (generated)
Unicode true
!include "MUI2.nsh"
!define PRODUCT_NAME "${args.name}"
!define PRODUCT_VERSION "${args.version}"
!define PRODUCT_EXE "${exeName}"
!define PRODUCT_DIR_REGKEY "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}"

Name "\${PRODUCT_NAME} \${PRODUCT_VERSION}"
OutFile "${path.join(args.outDir, 'Dardcor-Code-Setup-' + args.version + '.exe')}"
InstallDir "$PROGRAMFILES64\\${args.name}"
InstallDirRegKey HKLM "\${PRODUCT_DIR_REGKEY}" ""
RequestExecutionLevel admin

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Indonesian"

Section "Install"
	SetOutPath "$INSTDIR"
	File /r "${args.appDir}\\*.*"
	WriteUninstaller "$INSTDIR\\uninstall.exe"
	CreateShortcut "$DESKTOP\\${args.name}.lnk" "$INSTDIR\\${exeName}"
	CreateDirectory "$SMPROGRAMS\\${args.name}"
	CreateShortcut "$SMPROGRAMS\\${args.name}\\${args.name}.lnk" "$INSTDIR\\${exeName}"
	WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${args.name}" "DisplayName" "\${PRODUCT_NAME}"
	WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${args.name}" "DisplayVersion" "\${PRODUCT_VERSION}"
	WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${args.name}" "UninstallString" "$INSTDIR\\uninstall.exe"
SectionEnd

Section "Uninstall"
	RMDir /r "$INSTDIR"
	Delete "$DESKTOP\\${args.name}.lnk"
	RMDir /r "$SMPROGRAMS\\${args.name}"
	DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${args.name}"
	DeleteRegKey HKLM "\${PRODUCT_DIR_REGKEY}"
SectionEnd
`;
}

function buildPortableZip(args) {
	const files = [];
	const walk = (dir, prefix) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(abs, prefix ? `${prefix}/${entry.name}` : entry.name);
			else files.push({ name: (prefix ? prefix + '/' : '') + entry.name, data: fs.readFileSync(abs) });
		}
	};
	walk(args.appDir, '');
	const zip = createZip(files);
	const out = path.join(args.outDir, `Dardcor-Code-portable-${args.version}-${args.arch}.zip`);
	fs.writeFileSync(out, zip);
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(path.join(args.appDir, 'package.json')) && !fs.existsSync(args.appDir)) {
		console.error(`[win-installer] app dir not found: ${args.appDir}`);
		process.exit(1);
	}
	fs.mkdirSync(args.outDir, { recursive: true });
	const script = path.join(args.outDir, 'installer.nsi');
	fs.writeFileSync(script, nsisScript(args));
	console.log(`[win-installer] generated NSIS script: ${script}`);

	const portable = buildPortableZip(args);
	console.log(`[win-installer] portable zip: ${portable}`);

	const result = spawnSync(args.makensis, [script], { stdio: 'pipe', shell: true });
	if (result.status === 0) {
		console.log(`[win-installer] NSIS compiled: ${path.join(args.outDir, 'Dardcor-Code-Setup-' + args.version + '.exe')}`);
	} else {
		const detail = (result.stderr?.toString() || result.stdout?.toString() || '').split('\n').filter(l => /error/i.test(l)).slice(0, 5).join('\n');
		console.warn(`[win-installer] makensis not available or failed (${result.status ?? result.error?.message}); artifacts: .nsi + portable zip`);
		if (detail) console.warn(detail);
	}
	console.log('[win-installer] done');
}

export { nsisScript, buildPortableZip };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[win-installer] fatal:', err);
		process.exit(1);
	});
}
