/**
 * Dardcor Code - Linux .deb / .rpm / .AppImage Package Build Script (Task 922)
 *
 * Builds a Debian package (control file + usr layout, via dpkg-deb when
 * present, tarball fallback otherwise), emits an RPM spec for mock/rpmbuild,
 * and constructs an AppImage-style squashfs directory with AppRun launcher
 * (mksquashfs when available, tar.gz fallback).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		appDir: path.resolve(ROOT, opt('--app-dir', 'dist')),
		outDir: path.resolve(ROOT, opt('--out-dir', 'release/linux')),
		name: opt('--name', 'dardcor-code'),
		productName: opt('--product-name', 'Dardcor Code'),
		version: opt('--version', '1.0.0'),
		arch: opt('--arch', 'amd64'),
		maintainer: opt('--maintainer', 'Dardcor Team <team@dardcor.com>'),
	};
}

const EXEC = 'dardcor-code';
const ID = 'com.dardcor.code';

function desktopEntry(args) {
	return `[Desktop Entry]
Name=${args.productName}
Comment=Native desktop code editor
Exec=${EXEC} %F
Icon=${ID}
Terminal=false
Type=Application
Categories=Development;IDE;TextEditor;
StartupWMClass=${ID}
MimeType=text/plain;
`;
}

function controlFile(args) {
	return `Package: ${args.name}
Version: ${args.version}
Section: editors
Priority: optional
Architecture: ${args.arch}
Maintainer: ${args.maintainer}
Installed-Size: ${installedSizeKb(args.appDir)}
Homepage: https://github.com/dardcor/dardcor-code
Description: ${args.productName}
 A fast native desktop code editor built with Electron.
`;
}

function installedSizeKb(appDir) {
	let bytes = 0;
	const walk = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(abs);
			else bytes += fs.statSync(abs).size;
		}
	};
	walk(appDir);
	return Math.ceil(bytes / 1024);
}

function buildDeb(args) {
	const root = path.join(args.outDir, 'deb-root');
	const usrLib = path.join(root, 'usr', 'lib', args.name);
	const usrBin = path.join(root, 'usr', 'bin');
	const desktopDir = path.join(root, 'usr', 'share', 'applications');
	const iconsDir = path.join(root, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps');
	fs.mkdirSync(path.join(root, 'DEBIAN'), { recursive: true });
	fs.mkdirSync(usrLib, { recursive: true });
	fs.mkdirSync(usrBin, { recursive: true });
	fs.mkdirSync(desktopDir, { recursive: true });
	fs.mkdirSync(iconsDir, { recursive: true });

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
	copyTree(args.appDir, usrLib);
	fs.writeFileSync(path.join(usrBin, EXEC), `#!/bin/sh\nexec "/usr/lib/${args.name}/"*/* 2>/dev/null || exec /usr/lib/${args.name}/dardcor-code "$@"\n`);
	fs.chmodSync(path.join(usrBin, EXEC), 0o755);
	fs.writeFileSync(path.join(desktopDir, `${args.name}.desktop`), desktopEntry(args));
	fs.writeFileSync(path.join(root, 'DEBIAN', 'control'), controlFile(args));
	const icon = path.join(ROOT, 'public', 'dardcor-code.png');
	if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(iconsDir, `${ID}.png`));

	const debFile = path.join(args.outDir, `${args.name}_${args.version}_${args.arch}.deb`);
	const result = spawnSync('dpkg-deb', ['--build', root, debFile], { stdio: 'pipe' });
	if (result.status === 0) {
		return { ok: true, file: debFile, tool: 'dpkg-deb' };
	}
	// Fallback: plain tar of the root (installable manually)
	const tarFile = path.join(args.outDir, `${args.name}_${args.version}_${args.arch}.tar.gz`);
	const tar = spawnSync('tar', ['-czf', tarFile, '-C', root, '.'], { stdio: 'pipe' });
	if (tar.status !== 0) {
		return { ok: false, error: (result.stderr?.toString() || '') + (tar.stderr?.toString() || '') };
	}
	return { ok: true, file: tarFile, tool: 'tar-fallback' };
}

function rpmSpec(args) {
	return `Name: ${args.name}
Version: ${args.version}
Release: 1
Summary: ${args.productName} - native desktop code editor
License: MIT
URL: https://github.com/dardcor/dardcor-code
BuildArch: noarch

%description
A fast native desktop code editor built with Electron.

%prep
mkdir -p %{buildroot}/usr/lib/${args.name}
cp -r ${args.appDir}/* %{buildroot}/usr/lib/${args.name}/

%install
mkdir -p %{buildroot}/usr/bin
cat > %{buildroot}/usr/bin/${EXEC} <<'EOF'
#!/bin/sh
exec /usr/lib/${args.name}/dardcor-code "$@"
EOF
chmod +x %{buildroot}/usr/bin/${EXEC}

%files
/usr/lib/${args.name}
/usr/bin/${EXEC}

%changelog
* Fri Jul 31 2026 Dardcor Team <team@dardcor.com> - ${args.version}
- Initial package.
`;
}

function buildAppImage(args) {
	const dir = path.join(args.outDir, `${args.name}-appimage-root`);
	const usrDir = path.join(dir, 'usr');
	const appsDir = path.join(usrDir, 'bin');
	const libDir = path.join(usrDir, 'lib', args.name);
	const desktopDir = path.join(usrDir, 'share', 'applications');
	const iconsDir = path.join(usrDir, 'share', 'icons', 'hicolor', '512x512', 'apps');
	fs.mkdirSync(libDir, { recursive: true });
	fs.mkdirSync(appsDir, { recursive: true });
	fs.mkdirSync(desktopDir, { recursive: true });
	fs.mkdirSync(iconsDir, { recursive: true });

	const copyTree = (src, dest) => {
		for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
			const from = path.join(src, entry.name);
			const to = path.join(dest, entry.name);
			if (entry.isDirectory()) {
				fs.mkdirSync(to, { recursive: true });
				copyTree(from, to);
			} else fs.copyFileSync(from, to);
		}
	};
	copyTree(args.appDir, libDir);
	fs.writeFileSync(path.join(appsDir, EXEC), `#!/bin/sh\nexec "${path.join('..', 'lib', args.name, '')}"*/* 2>/dev/null || exec ${path.join('..', 'lib', args.name, '')}*\n`);
	fs.writeFileSync(path.join(dir, 'AppRun'), `#!/bin/sh\nSELF="$0"\nHERE="$(dirname "$(readlink -f "$SELF")")"\nexec "$HERE/usr/bin/${EXEC}" "$@"\n`);
	fs.chmodSync(path.join(dir, 'AppRun'), 0o755);
	fs.writeFileSync(path.join(desktopDir, `${args.name}.desktop`), desktopEntry(args));
	const icon = path.join(ROOT, 'public', 'dardcor-code.png');
	if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(iconsDir, `${ID}.png`));

	const squash = spawnSync('mksquashfs', [dir, path.join(args.outDir, `${args.name}-${args.version}-${args.arch}.AppImage`), '-noappend'], { stdio: 'pipe' });
	if (squash.status === 0) {
		return { ok: true, file: path.join(args.outDir, `${args.name}-${args.version}-${args.arch}.AppImage`), tool: 'mksquashfs' };
	}
	const tar = spawnSync('tar', ['-czf', path.join(args.outDir, `${args.name}-${args.version}-${args.arch}.appimage.tar.gz`), '-C', dir, '.'], { stdio: 'pipe' });
	return { ok: tar.status === 0, file: path.join(args.outDir, `${args.name}-${args.version}-${args.arch}.appimage.tar.gz`), tool: tar.status === 0 ? 'tar-fallback' : null, error: squash.stderr?.toString().slice(0, 300) };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(args.appDir)) {
		console.error(`[linux-installer] app dir not found: ${args.appDir}`);
		process.exit(1);
	}
	fs.mkdirSync(args.outDir, { recursive: true });

	const deb = buildDeb(args);
	if (deb.ok) console.log(`[linux-installer] deb: ${deb.file} (${deb.tool})`);
	else console.error(`[linux-installer] deb FAILED: ${deb.error}`);

	const spec = path.join(args.outDir, `${args.name}.spec`);
	fs.writeFileSync(spec, rpmSpec(args));
	console.log(`[linux-installer] rpm spec (use rpmbuild -bb): ${spec}`);

	const appImage = buildAppImage(args);
	if (appImage.ok) console.log(`[linux-installer] appimage: ${appImage.file} (${appImage.tool})`);
	else console.error(`[linux-installer] appimage FAILED: ${appImage.error}`);

	console.log('[linux-installer] done');
	process.exit(deb.ok && appImage.ok ? 0 : 1);
}

export { desktopEntry, controlFile, rpmSpec, buildDeb, buildAppImage };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[linux-installer] fatal:', err);
		process.exit(1);
	});
}
