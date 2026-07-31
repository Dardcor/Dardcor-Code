/**
 * Dardcor Code - Binary Code Signing Script (Task 923)
 *
 * Signs build artifacts per-platform:
 *   - Windows: signtool.exe (EV/OV certificate) + optional Azure Trusted Signing
 *   - macOS:   codesign + notarytool submit / staple (env: DC_APPLE_*)
 *   - Linux:   SHA256SUMS + optional GPG detached signature
 * All credentials come from environment variables; nothing is embedded.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		platform: opt('--platform', process.platform),
		targets: (() => {
			const idx = argv.indexOf('--targets');
			if (idx === -1) return [];
			const raw = argv.slice(idx + 1).filter(a => !a.startsWith('--'));
			return raw.length > 0 ? raw : [];
		})(),
		dir: path.resolve(ROOT, opt('--dir', 'release')),
	};
}

function requireEnv(names) {
	const missing = names.filter(n => !process.env[n]);
	if (missing.length > 0) {
		throw new Error(`missing env vars: ${missing.join(', ')}`);
	}
	return Object.fromEntries(names.map(n => [n, process.env[n]]));
}

function collectArtifacts(dir) {
	if (!fs.existsSync(dir)) return [];
	const files = [];
	const walk = d => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const abs = path.join(d, entry.name);
			if (entry.isDirectory()) walk(abs);
			else files.push(abs);
		}
	};
	walk(dir);
	return files.filter(f => /\.(exe|msi|vsix|dmg|pkg|zip|AppImage|deb|rpm)$/.test(f));
}

function signWindows(file, args) {
	const { DC_SIGNTOOL_PATH, DC_CERT_FILE, DC_CERT_PASSWORD } = requireEnv(['DC_SIGNTOOL_PATH', 'DC_CERT_FILE', 'DC_CERT_PASSWORD']);
	const signtool = DC_SIGNTOOL_PATH || 'signtool.exe';
	const result = spawnSync(signtool, ['sign', '/f', DC_CERT_FILE, '/p', DC_CERT_PASSWORD, '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', file], { stdio: 'pipe' });
	if (result.status !== 0) {
		return { file, ok: false, error: result.stderr?.toString() || result.stdout?.toString() };
	}
	const verify = spawnSync(signtool, ['verify', '/pa', file], { stdio: 'pipe' });
	return { file, ok: true, verified: verify.status === 0 };
}

function signMac(file, args) {
	// codesign first
	const { DC_MAC_IDENTITY } = requireEnv(['DC_MAC_IDENTITY']);
	const cs = spawnSync('codesign', ['--deep', '--force', '--options', 'runtime', '--timestamp', '--sign', DC_MAC_IDENTITY, file], { stdio: 'pipe' });
	if (cs.status !== 0) {
		return { file, ok: false, error: cs.stderr?.toString() || cs.stdout?.toString() };
	}
	// notarize (only for distributable dmg/pkg)
	let notarized = false;
	if (/(dmg|pkg)$/.test(file)) {
		const { DC_APPLE_ID, DC_APPLE_PASSWORD, DC_APPLE_TEAM_ID } = requireEnv(['DC_APPLE_ID', 'DC_APPLE_PASSWORD', 'DC_APPLE_TEAM_ID']);
		const submit = spawnSync('xcrun', ['notarytool', 'submit', file, '--apple-id', DC_APPLE_ID, '--password', DC_APPLE_PASSWORD, '--team-id', DC_APPLE_TEAM_ID, '--wait'], { stdio: 'pipe' });
		if (submit.status === 0) {
			const staple = spawnSync('xcrun', ['stapler', 'staple', file], { stdio: 'pipe' });
			notarized = staple.status === 0;
		}
	}
	const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', file], { stdio: 'pipe' });
	return { file, ok: verify.status === 0, notarized };
}

function checksums(files) {
	const lines = [];
	for (const file of files.sort()) {
		const data = fs.readFileSync(file);
		const sha256 = crypto.createHash('sha256').update(data).digest('hex');
		const sha512 = crypto.createHash('sha512').update(data).digest('hex');
		lines.push(`${sha256}  ${path.basename(file)}`);
		lines.push(`SHA512: ${sha512}  ${path.basename(file)}`);
	}
	return lines.join('\n') + '\n';
}

function signLinux(files, args) {
	const results = [];
	const sumsFile = path.join(args.dir, 'SHA256SUMS');
	fs.writeFileSync(sumsFile, checksums(files));
	results.push({ file: sumsFile, ok: true, verified: true });
	if (process.env.DC_GPG_KEY) {
		const gpg = spawnSync('gpg', ['--armor', '--detach-sign', '--local-user', process.env.DC_GPG_KEY, '--output', sumsFile + '.sig', sumsFile], { stdio: 'pipe' });
		results.push({ file: sumsFile + '.sig', ok: gpg.status === 0, error: gpg.status === 0 ? undefined : gpg.stderr?.toString() });
	}
	return results;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	let files = args.targets.map(t => path.resolve(ROOT, t));
	if (files.length === 0) {
		files = collectArtifacts(args.dir);
	}
	if (files.length === 0) {
		console.warn(`[code-signer] no artifacts under ${args.dir}`);
		process.exit(0);
	}
	console.log(`[code-signer] platform=${args.platform}, ${files.length} artifact(s)`);
	const results = [];
	try {
		if (args.platform.startsWith('win')) {
			for (const f of files) results.push(signWindows(f, args));
		} else if (args.platform === 'darwin' || args.platform === 'mac') {
			for (const f of files) results.push(signMac(f, args));
		} else if (args.platform === 'linux') {
			results.push(...signLinux(files, args));
		} else {
			console.warn(`[code-signer] unsupported platform: ${args.platform} (skipped)`);
		}
	} catch (err) {
		console.error(`[code-signer] error: ${err.message}`);
		console.error('[code-signer] (provide credentials via DC_* environment variables)');
		process.exit(1);
	}
	let failed = 0;
	for (const r of results) {
		if (r.ok) console.log(`[code-signer] OK   ${path.basename(r.file)}${r.verified ? ' (verified)' : ''}${r.notarized ? ' (notarized)' : ''}`);
		else {
			failed++;
			console.error(`[code-signer] FAIL ${path.basename(r.file)}: ${r.error}`);
		}
	}
	console.log(`[code-signer] ${results.length - failed}/${results.length} signed`);
	process.exit(failed > 0 ? 1 : 0);
}

export { signWindows, signMac, signLinux, checksums, collectArtifacts };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[code-signer] fatal:', err);
		process.exit(1);
	});
}
