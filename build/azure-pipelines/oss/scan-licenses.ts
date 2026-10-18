/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import fs from 'fs';
import path from 'path';
import https from 'https';
import { fetchUriText } from './apply-overrides.js';
import { parseNoticeFile } from './parse-notices.js';
import { parseArgs } from './utils.js';

interface LicenseEntry {
	name: string;
	version: string;
	license: string;
	url: string;
	licenseText: string;
	fromExtension: string;
}

const COPYRIGHT_PATTERN = /copyright|(\(c\)|©)/i;

const MIN_LICENSE_BODY_LENGTH = 40;

function validateCopyright(name: string, licenseText: string, source: string): void {
	if (!COPYRIGHT_PATTERN.test(licenseText)) {
		console.warn(`  MISSING COPYRIGHT: ${name} (${source}) \u2014 license found but no copyright statement`);
	}
}

function findLicenseFile(pkgDir: string): string | undefined {
	try {
		const files = fs.readdirSync(pkgDir);
		const licenseFile = files.find(f =>
			/^license(\.md|\.txt|\.mit|\.bsd|\.apache)?$/i.test(f) ||
			/^licence(\.md|\.txt)?$/i.test(f)
		);
		return licenseFile ? path.join(pkgDir, licenseFile) : undefined;
	} catch {
		return undefined;
	}
}

function githubRawLicenseCandidates(repositoryUrl: string, commitHash: string): string[] {
	const m = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
	if (!m) {
		return [];
	}
	const owner = m[1];
	const repo = m[2];
	const fileNames = [
		'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt',
		'LICENSE-MIT', 'LICENSE.MIT', 'LICENSE-APACHE', 'COPYING', 'LICENCE', 'LICENCE.md',
		'LICENSE.markdown'
	];
	return fileNames.map(f => `https://raw.githubusercontent.com/${owner}/${repo}/${commitHash}/${f}`);
}

export async function fetchLicenseFromGitRepo(repositoryUrl: string, commitHash: string): Promise<string | undefined> {
	if (!repositoryUrl || !commitHash) {
		return undefined;
	}
	for (const uri of githubRawLicenseCandidates(repositoryUrl, commitHash)) {
		const text = await fetchUriText(uri);
		if (!text) {
			continue;
		}
		const trimmed = text.trim();
		if (trimmed.length > MIN_LICENSE_BODY_LENGTH && !/^\.{1,2}\//.test(trimmed)) {
			return trimmed;
		}
	}
	return undefined;
}



const CRATES_IO_USER_AGENT = 'vscode-oss-scanner';

export interface CrateInfo {
	crate: { id: string; repository: string };
	versions: Array<{ num: string; license: string }>;
}

export interface CargoPackage {
	name: string;
	version: string;
	source?: string;
}

export function parseCargoLock(content: string): CargoPackage[] {
	const packages: CargoPackage[] = [];
	const blocks = content.split(/^\s*\[\[package\]\]\s*$/m);
	for (let i = 1; i < blocks.length; i++) {
		const block = blocks[i];
		let name = '';
		let version = '';
		let source: string | undefined;
		for (const rawLine of block.split('\n')) {
			const line = rawLine.trim();
			if (line.startsWith('[')) {
				break;
			}
			const m = line.match(/^(name|version|source)\s*=\s*"([^"]*)"/);
			if (!m) {
				continue;
			}
			if (m[1] === 'name') {
				name = m[2];
			} else if (m[1] === 'version') {
				version = m[2];
			} else {
				source = m[2];
			}
		}
		if (name && version) {
			packages.push({ name, version, source });
		}
	}
	return packages;
}

export function getCrateRepository(info: CrateInfo): string {
	switch (info.crate.id) {
		case 'isatty': return 'https://github.com/dtolnay/isatty';
		case 'redox_syscall': return 'https://github.com/redox-os/syscall';
		case 'redox_termios': return 'https://github.com/redox-os/termios';
		case 'termion': return 'https://github.com/redox-os/termion';
		default: return info.crate.repository || '';
	}
}

export function crateLicenseRefs(name: string, version: string): string[] {
	return [
		`v${version}`,
		`${version}`,
		`${name}-v${version}`,
		`${name}-${version}`,
		'main',
		'master',
	];
}

export function isSpdxStub(body: string): boolean {
	const trimmed = (body || '').trim();
	if (!trimmed) {
		return false;
	}
	if (trimmed.length > 120) {
		return false;
	}
	if (trimmed.split(/\n/).filter(l => l.trim()).length > 1) {
		return false;
	}
	if (/copyright|permission|redistribution|warranty|\(c\)|©/i.test(trimmed)) {
		return false;
	}
	const deparen = trimmed.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
	const spdxShape = /^[A-Za-z0-9.+-]+(?:\s*(?:\/|\s+(?:OR|AND|WITH)\s+)\s*[A-Za-z0-9.+-]+)*$/;
	if (!spdxShape.test(deparen)) {
		return false;
	}
	const tokens = trimmed
		.replace(/[()]/g, ' ')
		.split(/\s*\/\s*|\s+(?:OR|AND|WITH)\s+/)
		.map(t => t.trim())
		.filter(t => t.length > 0);
	if (tokens.length === 0 || !tokens.every(t => /[A-Za-z]/.test(t))) {
		return false;
	}
	return true;
}

export function fetchCratesIoJson(name: string, timeoutMs = 10_000): Promise<CrateInfo | undefined> {
	return new Promise(resolve => {
		const options: https.RequestOptions = {
			host: 'crates.io',
			path: `/api/v1/crates/${encodeURIComponent(name)}`,
			headers: { 'User-Agent': CRATES_IO_USER_AGENT, 'Accept': 'application/json' },
			timeout: timeoutMs,
		};
		const req = https.get(options, res => {
			if (res.statusCode !== 200) {
				res.resume();
				resolve(undefined);
				return;
			}
			const MAX_BODY_SIZE = 10 * 1024 * 1024;
			let data = '';
			res.setEncoding('utf8');
			res.on('data', chunk => {
				data += chunk;
				if (data.length > MAX_BODY_SIZE) {
					req.destroy();
					resolve(undefined);
					return;
				}
			});
			res.on('end', () => {
				try {
					resolve(JSON.parse(data) as CrateInfo);
				} catch {
					resolve(undefined);
				}
			});
		});
		req.on('error', () => resolve(undefined));
		req.on('timeout', () => { req.destroy(); resolve(undefined); });
	});
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
	let next = 0;
	const workers: Promise<void>[] = [];
	const worker = async (): Promise<void> => {
		while (next < tasks.length) {
			const idx = next++;
			await tasks[idx]();
		}
	};
	for (let i = 0; i < Math.min(limit, tasks.length); i++) {
		workers.push(worker());
	}
	await Promise.all(workers);
}

function githubOwnerRepo(repositoryUrl: string): { owner: string; repo: string } | undefined {
	const m = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
	return m ? { owner: m[1], repo: m[2] } : undefined;
}

function isRealLicenseBody(text: string): boolean {
	const t = text.trim();
	if (t.length <= MIN_LICENSE_BODY_LENGTH) {
		return false;
	}
	if (/^\.{1,2}\//.test(t)) {
		return false;
	}
	if (/\.\/LICENSE/i.test(t)) {
		return false;
	}
	if (/^#+\s*licen[sc]e\b/i.test(t) && /at your option|licensing (of|in)|\bLICENSE-[A-Z]/i.test(t)) {
		return false;
	}
	return true;
}

const SPDX_LICENSE_FILENAMES: { [id: string]: string[] } = {
	'MIT': ['LICENSE-MIT', 'LICENSE-MIT.txt', 'LICENSE-MIT.md'],
	'APACHE-2.0': ['LICENSE-APACHE', 'LICENSE-APACHE.txt', 'LICENSE-APACHE.md'],
	'ZLIB': ['LICENSE-ZLIB', 'LICENSE-ZLIB.txt'],
	'UNLICENSE': ['UNLICENSE', 'UNLICENSE.txt', 'LICENSE-UNLICENSE'],
	'BSD-3-CLAUSE': ['LICENSE-BSD', 'LICENSE-BSD3', 'LICENSE-BSD-3-Clause'],
	'BSD-2-CLAUSE': ['LICENSE-BSD', 'LICENSE-BSD2'],
	'MPL-2.0': ['LICENSE-MPL', 'LICENSE-MPL-2.0', 'LICENSE-MPL2'],
};

export function spdxLicenseIds(expr: string): string[] {
	const ids: string[] = [];
	for (const raw of (expr || '').split(/\s*\/\s*|\s+(?:OR|AND|WITH)\s+/)) {
		const id = raw.replace(/[()]/g, '').trim();
		if (id.length > 0 && /[A-Za-z]/.test(id) && ids.indexOf(id) === -1) {
			ids.push(id);
		}
	}
	return ids;
}

export function hasSpdxAnd(expr: string): boolean {
	return /\bAND\b/.test(expr || '');
}

function licenseFileCandidates(id: string): string[] {
	const up = id.toUpperCase();
	const out: string[] = [];
	if (SPDX_LICENSE_FILENAMES[up]) {
		out.push(...SPDX_LICENSE_FILENAMES[up]);
	}
	out.push(`LICENSES/${id}.txt`, `LICENSES/${id}`, `LICENSE-${up}`, `LICENSE-${up}.txt`);
	return out;
}

export async function fetchCargoLicense(repoUrl: string, name: string, version: string, license: string): Promise<{ text: string; ref: string } | undefined> {
	const or = githubOwnerRepo(repoUrl);
	const ids = spdxLicenseIds(license);
	for (const ref of crateLicenseRefs(name, version)) {
		if (or) {
			for (const id of ids) {
				for (const file of licenseFileCandidates(id)) {
					const url = `https://raw.githubusercontent.com/${or.owner}/${or.repo}/${ref}/${file}`;
					const text = await fetchUriText(url);
					if (text && isRealLicenseBody(text)) {
						return { text: text.trim(), ref };
					}
				}
			}
		}
		const generic = await fetchLicenseFromGitRepo(repoUrl, ref);
		if (generic && isRealLicenseBody(generic)) {
			return { text: generic, ref };
		}
	}
	return undefined;
}

function readPkgJson(pkgDir: string): { name: string; version: string; license: string; repository: string } | undefined {
	const pkgPath = path.join(pkgDir, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		return undefined;
	}
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
		const repo = typeof pkg.repository === 'string'
			? pkg.repository
			: pkg.repository?.url || '';
		return {
			name: pkg.name || '',
			version: pkg.version || '',
			license: typeof pkg.license === 'string' ? pkg.license : '',
			repository: repo.replace(/^git\+/, '').replace(/\.git$/, ''),
		};
	} catch {
		return undefined;
	}
}

function collectPackagesInNodeModules(nmDir: string): string[] {
	const packages: string[] = [];
	if (!fs.existsSync(nmDir)) {
		return packages;
	}

	try {
		for (const entry of fs.readdirSync(nmDir)) {
			if (entry.startsWith('.')) {
				continue;
			}
			const full = path.join(nmDir, entry);
			if (!fs.statSync(full).isDirectory()) {
				continue;
			}

			if (entry.startsWith('@')) {
				try {
					for (const sub of fs.readdirSync(full)) {
						const subFull = path.join(full, sub);
						if (fs.statSync(subFull).isDirectory() && fs.existsSync(path.join(subFull, 'package.json'))) {
							packages.push(`${entry}/${sub}`);
						}
					}
				} catch { }
			} else if (fs.existsSync(path.join(full, 'package.json'))) {
				packages.push(entry);
			}
		}
	} catch { }

	return packages;
}


export const ARCH_SUFFIX_RE = /[/-](?:darwin|linux|linuxmusl|win32|android|freebsd|openbsd|netbsd|sunos|aix)-(?:x64|arm64|arm|ia32|ppc64|ppc64le|s390x|riscv64|loong64|mips64el|universal)(?:-(?:gnu|musl|msvc|glibc|gnueabihf|eabihf|androideabi))?$/;

export function isArchPackageName(name: string): boolean {
	return ARCH_SUFFIX_RE.test(name || '');
}

const VSCODE_SHIPPED_PLATFORMS = new Set(['darwin', 'linux', 'linuxmusl', 'win32']);
const VSCODE_SHIPPED_ARCHS = new Set(['x64', 'arm64', 'arm']);

export const NPM_SHIPPED_OS = new Set(['darwin', 'linux', 'win32']);

export function osAllows(osList: string[], platform: string): boolean {
	let hasPositive = false;
	let positiveMatch = false;
	for (const raw of osList) {
		if (typeof raw !== 'string' || raw.length === 0) {
			continue;
		}
		if (raw[0] === '!') {
			if (raw.slice(1) === platform) {
				return false;
			}
		} else {
			hasPositive = true;
			if (raw === platform) {
				positiveMatch = true;
			}
		}
	}
	return hasPositive ? positiveMatch : true;
}

export function isOsGatedShippedElsewhere(osList: string[], hostPlatform: string): boolean {
	if (!Array.isArray(osList) || osList.length === 0) {
		return false;
	}
	if (osAllows(osList, hostPlatform)) {
		return false;
	}
	for (const shipped of NPM_SHIPPED_OS) {
		if (osAllows(osList, shipped)) {
			return true;
		}
	}
	return false;
}

export function readBuiltInExtensionNames(productJson: unknown): string[] {
	const names: string[] = [];
	const pj = productJson as { builtInExtensions?: unknown; webBuiltInExtensions?: unknown } | undefined;
	if (!pj) {
		return names;
	}
	for (const list of [pj.builtInExtensions, pj.webBuiltInExtensions]) {
		if (Array.isArray(list)) {
			for (const ext of list) {
				const n = (ext as { name?: unknown })?.name;
				if (typeof n === 'string' && n) {
					names.push(n);
				}
			}
		}
	}
	return names;
}

export function readBuiltInExtensionManifest(productJson: unknown): Array<{ name: string; version: string; repo: string }> {
	const out: Array<{ name: string; version: string; repo: string }> = [];
	const pj = productJson as { builtInExtensions?: unknown; webBuiltInExtensions?: unknown } | undefined;
	if (!pj) {
		return out;
	}
	for (const list of [pj.builtInExtensions, pj.webBuiltInExtensions]) {
		if (Array.isArray(list)) {
			for (const ext of list) {
				const e = ext as { name?: unknown; version?: unknown; repo?: unknown };
				if (typeof e?.name === 'string' && e.name) {
					out.push({
						name: e.name,
						version: typeof e.version === 'string' ? e.version : '',
						repo: typeof e.repo === 'string' ? e.repo : '',
					});
				}
			}
		}
	}
	return out;
}

export function builtInExtensionLockfileUrl(repo: string, version: string): string | undefined {
	if (!repo || !version) {
		return undefined;
	}
	const m = repo.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
	if (!m) {
		return undefined;
	}
	return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/v${version}/package-lock.json`;
}

export function enumerateLockfileProdDeps(lockJson: unknown): Array<{ name: string; version: string }> {
	const lock = lockJson as { packages?: Record<string, { version?: string; dev?: boolean; link?: boolean }> } | undefined;
	const pkgs = lock?.packages;
	if (!pkgs || typeof pkgs !== 'object') {
		return [];
	}
	const out: Array<{ name: string; version: string }> = [];
	const seen = new Set<string>();
	for (const lockKey of Object.keys(pkgs)) {
		const meta = pkgs[lockKey];
		if (!meta || meta.dev === true || meta.link === true) {
			continue;
		}
		const nmIdx = lockKey.lastIndexOf('node_modules/');
		if (nmIdx < 0) {
			continue;
		}
		const name = lockKey.slice(nmIdx + 'node_modules/'.length);
		if (!name || isArchPackageName(name)) {
			continue;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({ name, version: meta.version || '' });
	}
	return out;
}

const _shippedSuffixCache = new Set<string>();
function _buildShippedSuffixes(): Set<string> {
	if (_shippedSuffixCache.size > 0) {
		return _shippedSuffixCache;
	}
	for (const p of VSCODE_SHIPPED_PLATFORMS) {
		for (const a of VSCODE_SHIPPED_ARCHS) {
			_shippedSuffixCache.add(`${p}-${a}`);
		}
	}
	_shippedSuffixCache.add('darwin-universal');
	return _shippedSuffixCache;
}

export function isShippedArch(name: string): boolean {
	const m = name.match(ARCH_SUFFIX_RE);
	if (!m) {
		return false;
	}
	const suffix = m[0].replace(/^[/-]/, '').replace(/-(gnu|musl|msvc|glibc|gnueabihf|eabihf|androideabi)$/, '');
	return _buildShippedSuffixes().has(suffix);
}

export function npmLicenseId(pkg: { license?: unknown; licenses?: unknown } | undefined): string {
	if (!pkg) {
		return '';
	}
	const lic = pkg.license;
	if (typeof lic === 'string') {
		return lic;
	}
	if (lic && typeof lic === 'object' && typeof (lic as { type?: unknown }).type === 'string') {
		return (lic as { type: string }).type;
	}
	const arr = pkg.licenses;
	if (Array.isArray(arr) && arr.length > 0) {
		const first = arr[0];
		if (typeof first === 'string') {
			return first;
		}
		if (first && typeof first === 'object' && typeof (first as { type?: unknown }).type === 'string') {
			return (first as { type: string }).type;
		}
	}
	return '';
}

function normalizeRepoUrl(repo: unknown): string {
	let url = '';
	if (typeof repo === 'string') {
		url = repo;
	} else if (repo && typeof repo === 'object' && typeof (repo as { url?: unknown }).url === 'string') {
		url = (repo as { url: string }).url;
	}
	return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

function readPackageJsonRaw(pkgDir: string): Record<string, unknown> | undefined {
	const pkgPath = path.join(pkgDir, 'package.json');
	try {
		if (!fs.existsSync(pkgPath)) {
			return undefined;
		}
		return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function archChildrenFromOptionalDeps(optDeps: unknown): Array<{ name: string; version: string }> {
	const out: Array<{ name: string; version: string }> = [];
	if (!optDeps || typeof optDeps !== 'object') {
		return out;
	}
	for (const [depName, depVer] of Object.entries(optDeps as Record<string, unknown>)) {
		if (isArchPackageName(depName)) {
			out.push({ name: depName, version: typeof depVer === 'string' ? depVer : '' });
		}
	}
	return out;
}

export interface NpmPackument {
	repository?: unknown;
	versions?: { [version: string]: { license?: unknown; licenses?: unknown; repository?: unknown; optionalDependencies?: unknown } };
}

export function fetchNpmRegistryJson(name: string, timeoutMs = 10_000): Promise<NpmPackument | undefined> {
	return new Promise(resolve => {
		const options: https.RequestOptions = {
			host: 'registry.npmjs.org',
			path: '/' + encodeURIComponent(name),
			headers: { 'Accept': 'application/json' },
			timeout: timeoutMs,
		};
		const req = https.get(options, res => {
			if (res.statusCode !== 200) {
				res.resume();
				resolve(undefined);
				return;
			}
			const MAX_BODY_SIZE = 10 * 1024 * 1024;
			let data = '';
			res.setEncoding('utf8');
			res.on('data', chunk => {
				data += chunk;
				if (data.length > MAX_BODY_SIZE) {
					req.destroy();
					resolve(undefined);
					return;
				}
			});
			res.on('end', () => {
				try {
					resolve(JSON.parse(data) as NpmPackument);
				} catch {
					resolve(undefined);
				}
			});
		});
		req.on('error', () => resolve(undefined));
		req.on('timeout', () => { req.destroy(); resolve(undefined); });
	});
}

export function familyText(
	cache: Map<string, { text: string; source: string }>,
	repoUrl: string,
	ownText: string | undefined,
	ownSource: 'disk' | 'repo' | undefined,
	parentText: string | undefined,
): { text: string; source: string } {
	if (repoUrl) {
		const hit = cache.get(repoUrl);
		if (hit) {
			return hit;
		}
	}
	let result: { text: string; source: string };
	if (ownText && ownSource) {
		result = { text: ownText, source: ownSource };
	} else if (parentText) {
		result = { text: parentText, source: 'parent' };
	} else {
		result = { text: '', source: 'none' };
	}
	if (repoUrl && result.text) {
		cache.set(repoUrl, result);
	}
	return result;
}

export function parentTextIfCompatible(parentLicenseId: string, childLicenseId: string, parentText: string): string | undefined {
	if (!parentText) {
		return undefined;
	}
	if (parentLicenseId && childLicenseId && parentLicenseId.toLowerCase() === childLicenseId.toLowerCase()) {
		return parentText;
	}
	return undefined;
}

function findFilesRecursive(repoRoot: string, targetFileName: string): string[] {
	const results: string[] = [];

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch { return; }
		for (const entry of entries) {
			if (entry === 'node_modules' || entry === '.git' || entry === 'out' || entry === 'test') {
				continue;
			}
			const full = path.join(dir, entry);
			if (entry === targetFileName) {
				results.push(full);
			} else {
				try {
					if (fs.statSync(full).isDirectory() && !fs.lstatSync(full).isSymbolicLink()) {
						walk(full);
					}
				} catch { }
			}
		}
	}

	walk(repoRoot);
	return results;
}

function findCgManifestFiles(repoRoot: string): string[] {
	return findFilesRecursive(repoRoot, 'cgmanifest.json');
}

function findCargoLockFiles(repoRoot: string): string[] {
	return findFilesRecursive(repoRoot, 'Cargo.lock');
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const repoRoot = args['repo'];
	const outputPath = args['output'];

	if (!repoRoot || !outputPath) {
		console.error('Usage: scan-licenses.js --repo <path> --output <path> [--cg <ThirdPartyNotices.generated.txt>]');
		process.exit(1);
	}

	const cgCovered = new Set<string>();
	const cgBodies = new Map<string, string>();
	const cgNoticePath = args['cg'];
	if (cgNoticePath && fs.existsSync(cgNoticePath)) {
		try {
			for (const e of parseNoticeFile(cgNoticePath)) {
				cgCovered.add(e.name.toLowerCase());
				if (typeof e.licenseText !== 'undefined' && !cgBodies.has(e.name.toLowerCase())) {
					cgBodies.set(e.name.toLowerCase(), e.licenseText);
				}
			}
			console.log(`Loaded CG coverage set: ${cgCovered.size} packages from ${cgNoticePath}`);
		} catch (err) {
			console.warn(`  WARN: could not parse --cg notice (${cgNoticePath}): ${err}`);
		}
	}

	const extensionsDir = path.join(repoRoot, 'extensions');
	if (!fs.existsSync(extensionsDir)) {
		console.error(`ERROR: extensions directory not found at ${extensionsDir}`);
		process.exit(1);
	}

	const extensions = fs.readdirSync(extensionsDir).filter(name => {
		const pkgPath = path.join(extensionsDir, name, 'package.json');
		if (!fs.existsSync(pkgPath)) {
			return false;
		}
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			return pkg.engines && pkg.engines.vscode;
		} catch {
			return false;
		}
	});

	const extensionNames = extensions.map(folder => {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(extensionsDir, folder, 'package.json'), 'utf8'));
			return { folder, name: pkg.name || folder };
		} catch {
			return { folder, name: folder };
		}
	});

	console.log(`Found ${extensions.length} built-in extensions with engines.vscode`);
	for (const ext of extensionNames) {
		if (ext.name !== ext.folder) {
			console.log(`  ${ext.name} (folder: ${ext.folder})`);
		}
	}

	console.log('');
	console.log('=========================================================================');
	console.log('SECTION 1: Scanning built-in extension dependencies');
	console.log('  Why: CG skips all packages with engines.vscode in their package.json.');
	console.log('  This is a CG workaround for consumers of VS Code extensions, but we');
	console.log('  ARE VS Code -- our built-in extensions ship in the product.');
	console.log('=========================================================================');
	console.log('');

	const entries = new Map<string, LicenseEntry>();
	const noLicenseSeen = new Map<string, { name: string; version: string }>();
	const stubOverrideKeys = new Set<string>();
	const unresolved: Array<{ name: string; version: string; reason: string }> = [];
	let scanned = 0;
	let noLicense = 0;


	for (const ext of extensions) {
		const nmDirs = [
			path.join(extensionsDir, ext, 'node_modules'),
			path.join(extensionsDir, ext, 'server', 'node_modules'),
			path.join(extensionsDir, ext, 'server', 'lib', 'node_modules'),
		];

		for (const nmDir of nmDirs) {
			const packages = collectPackagesInNodeModules(nmDir);

			for (const pkgName of packages) {
				const pkgDir = path.join(nmDir, ...pkgName.split('/'));
				const pkgInfo = readPkgJson(pkgDir);
				const resolvedName = pkgInfo?.name || pkgName;
				const key = resolvedName.toLowerCase();

				if (entries.has(key)) {
					continue;
				}

				scanned++;
				const licenseFilePath = findLicenseFile(pkgDir);

				if (licenseFilePath) {
					let licenseText: string;
					try {
						licenseText = fs.readFileSync(licenseFilePath, 'utf8').trim();
					} catch (err) {
						console.warn(`  WARN: could not read ${licenseFilePath}: ${(err as Error).message}`);
						continue;
					}
					validateCopyright(resolvedName, licenseText, `extension: ${ext}`);
					entries.set(key, {
						name: resolvedName,
						version: pkgInfo?.version || '',
						license: pkgInfo?.license || '',
						url: pkgInfo?.repository || '',
						licenseText,
						fromExtension: ext,
					});
				} else {
					noLicense++;
					noLicenseSeen.set(key, { name: resolvedName, version: pkgInfo?.version || '' });
					console.warn(`  NO LICENSE: ${resolvedName} (extension: ${ext})`);
				}
			}
		}
	}

	console.log('');
	console.log('=========================================================================');
	console.log('SECTION 2: Scanning root node_modules for ClearlyDefined gaps');
	console.log('  Why: CG detects these packages but ClearlyDefined may not have their');
	console.log('  license text. The LICENSE files exist on disk -- we read them directly.');
	console.log('=========================================================================');
	console.log('');

	let rootScanned = 0;
	let rootNoLicense = 0;

	const rootNmDir = path.join(repoRoot, 'node_modules');
	if (fs.existsSync(rootNmDir)) {
		const rootPackages = collectPackagesInNodeModules(rootNmDir);

		for (const pkgName of rootPackages) {
			const pkgDir = path.join(rootNmDir, ...pkgName.split('/'));
			const pkgInfo = readPkgJson(pkgDir);
			const resolvedName = pkgInfo?.name || pkgName;
			const key = resolvedName.toLowerCase();

			if (entries.has(key)) {
				continue;
			}

			rootScanned++;
			const licenseFilePath = findLicenseFile(pkgDir);

			if (licenseFilePath) {
				let licenseText: string;
				try {
					licenseText = fs.readFileSync(licenseFilePath, 'utf8').trim();
				} catch (err) {
					console.warn(`  WARN: could not read ${licenseFilePath}: ${(err as Error).message}`);
					continue;
				}
				validateCopyright(resolvedName, licenseText, 'root node_modules');
				entries.set(key, {
					name: resolvedName,
					version: pkgInfo?.version || '',
					license: pkgInfo?.license || '',
					url: pkgInfo?.repository || '',
					licenseText,
					fromExtension: '(root)',
				});
			} else {
				rootNoLicense++;
				noLicenseSeen.set(key, { name: resolvedName, version: pkgInfo?.version || '' });
				console.warn(`  NO LICENSE: ${resolvedName} (root node_modules)`);
			}
		}
	}

	console.log(`  Root packages scanned: ${rootScanned}`);
	console.log(`  Root LICENSE found: ${rootScanned - rootNoLicense}`);
	console.log(`  Root NO LICENSE: ${rootNoLicense}`);

	console.log('');
	console.log('=========================================================================');
	console.log('SECTION 3: Extracting licenses from cgmanifest.json licenseDetail');
	console.log('  Why: Language grammars, vendored code, and other manually declared');
	console.log('  components have license text inline in cgmanifest.json. CG ignores');
	console.log('  this field -- it is a VS Code custom extension.');
	console.log('=========================================================================');
	console.log('');

	let cgManifestFound = 0;
	let cgManifestNoDetail = 0;
	let cgManifestFetched = 0;
	let cgManifestFetchFailed = 0;
	let cgManifestSkippedCgCovered = 0;

	const cgManifestFiles = findCgManifestFiles(repoRoot);
	console.log(`  Found ${cgManifestFiles.length} cgmanifest.json files`);

	for (const manifestPath of cgManifestFiles) {
		let data: { registrations?: unknown[]; Registrations?: unknown[] };
		try {
			data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		} catch {
			console.warn(`  WARN: Could not parse ${manifestPath}`);
			continue;
		}
		const registrations = (data.registrations || data.Registrations || []) as Array<{
			component?: { git?: { name?: string; repositoryUrl?: string; commitHash?: string }; npm?: { name?: string }; other?: { name?: string; downloadUrl?: string } };
			licenseDetail?: unknown;
			license?: unknown;
			version?: string;
		}>;

		for (const reg of registrations) {
			const comp = reg.component;
			if (!comp) {
				continue;
			}

			const inner = comp.git || comp.npm || comp.other || {};
			const name = (inner as { name?: string }).name || '';
			if (!name) {
				continue;
			}

			const key = name.toLowerCase();

			if (entries.has(key)) {
				continue;
			}

			if (reg.licenseDetail && (reg.licenseDetail as unknown[]).length > 0) {
				const detail = reg.licenseDetail as string[] | string[][];
				let licenseText: string;
				if (Array.isArray(detail[0])) {
					licenseText = (detail[0] as string[]).join('\n');
				} else {
					licenseText = (detail as string[]).join('\n');
				}

				const url = comp.git?.repositoryUrl || comp.other?.downloadUrl || '';
				const version = reg.version || comp.git?.commitHash?.substring(0, 7) || '';
				const license = typeof reg.license === 'string' ? reg.license : '';
				const relPath = path.relative(repoRoot, manifestPath);
				validateCopyright(name, licenseText, `cgmanifest: ${relPath}`);

				entries.set(key, {
					name,
					version,
					license,
					url,
					licenseText,
					fromExtension: `(cgmanifest: ${relPath})`,
				});
				cgManifestFound++;
				continue;
			}

			if (cgCovered.has(key)) {
				cgManifestSkippedCgCovered++;
				continue;
			}

			const relPath = path.relative(repoRoot, manifestPath);
			const repoUrl = comp.git?.repositoryUrl || '';
			const commitHash = comp.git?.commitHash || '';
			if (repoUrl && commitHash) {
				const fetched = await fetchLicenseFromGitRepo(repoUrl, commitHash);
				if (fetched) {
					const license = typeof reg.license === 'string' ? reg.license : '';
					const version = reg.version || commitHash.substring(0, 7);
					validateCopyright(name, fetched, `cgmanifest-fetch: ${relPath}`);
					entries.set(key, {
						name,
						version,
						license,
						url: repoUrl,
						licenseText: fetched,
						fromExtension: `(cgmanifest-fetch: ${relPath})`,
					});
					cgManifestFetched++;
					console.log(`  FETCHED LICENSE: ${name} (${repoUrl}@${commitHash.substring(0, 7)})`);
					continue;
				}
				cgManifestFetchFailed++;
				unresolved.push({ name, version: reg.version || commitHash.substring(0, 7), reason: 'cgmanifest-fetch-failed' });
				console.warn(`  FETCH FAILED: ${name} (${repoUrl}@${commitHash.substring(0, 7)}) -- no LICENSE resolved`);
				continue;
			}

			cgManifestNoDetail++;
			console.warn(`  NO LICENSE DETAIL: ${name} (${relPath})`);
		}
	}

	console.log(`  Entries with licenseDetail: ${cgManifestFound}`);
	console.log(`  Entries without licenseDetail: ${cgManifestNoDetail}`);

	console.log('');
	console.log('=========================================================================');
	console.log('SECTION 4: Harvesting Rust crate licenses from Cargo.lock');
	console.log('  Why: CG misses some Rust crates entirely and emits the SPDX expression');
	console.log('  as the license body for others. We fetch the real LICENSE text from');
	console.log('  each crate\'s repo (tag-pinned), gated by CG coverage to bound fetches.');
	console.log('=========================================================================');
	console.log('');

	let cargoCratesSeen = 0;
	let cargoNoSource = 0;
	let cargoGitSource = 0;
	let cargoSkippedCgCovered = 0;
	let cargoSkippedAlready = 0;
	let cargoFetched = 0;
	let cargoStubOverride = 0;
	let cargoFetchFailed = 0;
	let cargoApiFailed = 0;
	let cargoAndIncomplete = 0;

	const cargoLockFiles = findCargoLockFiles(repoRoot);
	console.log(`  Found ${cargoLockFiles.length} Cargo.lock files`);

	interface PendingCrate {
		name: string;
		version: string;
		relPath: string;
		isStubOverride: boolean;
	}
	const pending: PendingCrate[] = [];
	const seenCargoKeys = new Set<string>();

	for (const lockPath of cargoLockFiles) {
		const relPath = path.relative(repoRoot, lockPath);
		let pkgs: CargoPackage[];
		try {
			pkgs = parseCargoLock(fs.readFileSync(lockPath, 'utf8'));
		} catch (err) {
			console.warn(`  WARN: could not parse ${relPath}: ${err}`);
			continue;
		}
		console.log(`  ${relPath}: ${pkgs.length} packages`);

		for (const pkg of pkgs) {
			cargoCratesSeen++;
			if (!pkg.source) {
				cargoNoSource++;
				continue;
			}
			if (pkg.source.startsWith('git+')) {
				cargoGitSource++;
				console.log(`  SKIP (git source, TODO): ${pkg.name}@${pkg.version}`);
				continue;
			}

			const key = pkg.name.toLowerCase();
			if (entries.has(key) || seenCargoKeys.has(key)) {
				cargoSkippedAlready++;
				continue;
			}

			const cgBody = cgBodies.get(key);
			const cgHasIt = cgCovered.has(key);
			if (cgHasIt && (typeof cgBody === 'undefined' || !isSpdxStub(cgBody))) {
				cargoSkippedCgCovered++;
				continue;
			}

			seenCargoKeys.add(key);
			pending.push({
				name: pkg.name,
				version: pkg.version,
				relPath,
				isStubOverride: cgHasIt && typeof cgBody !== 'undefined' && isSpdxStub(cgBody),
			});
		}
	}

	console.log(`  Resolving ${pending.length} crates via crates.io (coverage-gated)`);

	const cargoTasks = pending.map(p => async (): Promise<void> => {
		try {
			const info = await fetchCratesIoJson(p.name);
			if (!info) {
				cargoApiFailed++;
				unresolved.push({ name: p.name, version: p.version, reason: 'cargo-api-failed' });
				console.warn(`  CRATES.IO FAILED: ${p.name}@${p.version} -- no crate info`);
				return;
			}
			if (!Array.isArray(info.versions) || !info.crate || typeof info.crate.id !== 'string') {
				cargoApiFailed++;
				unresolved.push({ name: p.name, version: p.version, reason: 'cargo-api-failed' });
				console.warn(`  CRATES.IO FAILED: ${p.name}@${p.version} -- unexpected response shape (no versions/crate)`);
				return;
			}
			const versionInfo = info.versions.find(v => v.num === p.version);
			const license = versionInfo?.license || '';
			if (!versionInfo) {
				console.warn(`  WARN: version ${p.version} not found for crate ${p.name} -- using repo default`);
			}
			const repoUrl = getCrateRepository(info);
			if (!repoUrl) {
				cargoFetchFailed++;
				unresolved.push({ name: p.name, version: p.version, reason: 'cargo-no-repo-url' });
				console.warn(`  FETCH FAILED: ${p.name}@${p.version} -- no repository URL`);
				return;
			}

			const result = await fetchCargoLicense(repoUrl, p.name, p.version, license);
			if (!result) {
				cargoFetchFailed++;
				unresolved.push({ name: p.name, version: p.version, reason: 'cargo-no-license-resolved' });
				console.warn(`  FETCH FAILED: ${p.name}@${p.version} (${repoUrl}) -- no LICENSE resolved at any ref (needs cglicenses.json override)`);
				return;
			}
			if (hasSpdxAnd(license)) {
				cargoAndIncomplete++;
				console.warn(`  AND-LICENSE INCOMPLETE: ${p.name}@${p.version} -- SPDX "${license}" is conjunctive (AND); only one license's text was fetched. ALL named licenses are legally required -- add a cglicenses.json override with the full combined text.`);
			}
			const fetched = result.text;
			const usedRef = result.ref;

			const key = p.name.toLowerCase();
			entries.set(key, {
				name: p.name,
				version: p.version,
				license,
				url: repoUrl,
				licenseText: fetched,
				fromExtension: p.isStubOverride ? `(cargo-stub-override: ${p.relPath})` : `(cargo: ${p.relPath})`,
			});
			if (p.isStubOverride) {
				cargoStubOverride++;
				stubOverrideKeys.add(`${key}@${p.version}`);
				console.log(`  STUB OVERRIDE: ${p.name}@${p.version} (${repoUrl}@${usedRef})`);
			} else {
				cargoFetched++;
				console.log(`  FETCHED LICENSE: ${p.name}@${p.version} (${repoUrl}@${usedRef})`);
			}
		} catch (err) {
			cargoApiFailed++;
			unresolved.push({ name: p.name, version: p.version, reason: 'cargo-api-failed' });
			console.warn(`  CRATES.IO FAILED: ${p.name}@${p.version} -- unexpected error: ${(err as Error).message}`);
		}
	});

	await runWithConcurrency(cargoTasks, 4);

	console.log(`  Crates added (coverage gap): ${cargoFetched}`);
	console.log(`  Crates stub-overridden: ${cargoStubOverride}`);

	console.log('');
	console.log('=========================================================================');
	console.log('SECTION 5: Enumerating platform-specific binary packages (shipped arches)');
	console.log('  Why: arch-specific npm packages are optionalDependencies of an');
	console.log('  arch-independent parent. Only the host arch installs on disk, so the');
	console.log('  scan above misses the rest. We enumerate every SHIPPED arch.');
	console.log('  Shipped platforms: ' + Array.from(VSCODE_SHIPPED_PLATFORMS).join(', '));
	console.log('  Shipped arches: ' + Array.from(VSCODE_SHIPPED_ARCHS).join(', '));
	console.log('=========================================================================');
	console.log('');

	let pbParentsFound = 0;
	let pbAdded = 0;
	let pbFetchedRegistry = 0;
	let pbTextFromDisk = 0;
	let pbTextFromRepo = 0;
	let pbTextFromParent = 0;
	let pbNoText = 0;
	let pbSkippedAlready = 0;
	let pbSkippedCg = 0;
	let pbSkippedNotShipped = 0;

	const pbRoots = [
		path.join(repoRoot, 'node_modules'),
		path.join(repoRoot, 'remote', 'node_modules'),
		path.join(repoRoot, 'build', 'node_modules'),
	];
	for (const ext of extensions) {
		pbRoots.push(path.join(extensionsDir, ext, 'node_modules'));
		pbRoots.push(path.join(extensionsDir, ext, 'server', 'node_modules'));
		pbRoots.push(path.join(extensionsDir, ext, 'server', 'lib', 'node_modules'));
	}

	const pbOnDisk = new Map<string, string>();
	const pbSeedKeys = new Set<string>();
	const pbSeedParents: Array<{ key: string; dir: string; optDeps: Record<string, unknown> }> = [];
	for (const root of pbRoots) {
		for (const pkgName of collectPackagesInNodeModules(root)) {
			const dir = path.join(root, ...pkgName.split('/'));
			const ck = pkgName.toLowerCase();
			if (!pbOnDisk.has(ck)) {
				pbOnDisk.set(ck, dir);
			}
			const raw = readPackageJsonRaw(dir);
			const opt = raw?.optionalDependencies;
			if (!pbSeedKeys.has(ck) && opt && typeof opt === 'object' && archChildrenFromOptionalDeps(opt).length >= 1) {
				pbSeedKeys.add(ck);
				pbSeedParents.push({ key: ck, dir, optDeps: opt as Record<string, unknown> });
			}
		}
	}
	pbParentsFound = pbSeedParents.length;
	console.log(`  Found ${pbParentsFound} platform-binary parent packages on disk`);

	const pbTextByRepo = new Map<string, { text: string; source: string }>();
	const pbVisited = new Set<string>();

	interface PbFrontierNode {
		optDeps: unknown;
		seedParentKey: string;
		seedParentLicenseId: string;
		seedParentText: string;
	}
	let pbFrontier: PbFrontierNode[] = pbSeedParents.map(p => ({
		optDeps: p.optDeps,
		seedParentKey: p.key,
		seedParentLicenseId: npmLicenseId(readPackageJsonRaw(p.dir)),
		seedParentText: entries.get(p.key)?.licenseText || '',
	}));

	while (pbFrontier.length > 0) {
		const childrenThisLevel: Array<{ name: string; version: string; seedParentKey: string; seedParentLicenseId: string; seedParentText: string }> = [];
		for (const node of pbFrontier) {
			for (const child of archChildrenFromOptionalDeps(node.optDeps)) {
				const ck = child.name.toLowerCase();
				if (pbVisited.has(ck)) {
					continue;
				}
				pbVisited.add(ck);
				if (!isShippedArch(child.name)) {
					pbSkippedNotShipped++;
					continue;
				}
				childrenThisLevel.push({
					name: child.name,
					version: child.version,
					seedParentKey: node.seedParentKey,
					seedParentLicenseId: node.seedParentLicenseId,
					seedParentText: node.seedParentText,
				});
			}
		}
		if (childrenThisLevel.length === 0) {
			break;
		}

		const nextFrontier: PbFrontierNode[] = [];
		const tasks = childrenThisLevel.map(child => async (): Promise<void> => {
			try {
				const ck = child.name.toLowerCase();
				const onDiskDir = pbOnDisk.get(ck);

				let licenseId = '';
				let repoUrl = '';
				let childOptDeps: unknown;
				if (onDiskDir) {
					const raw = readPackageJsonRaw(onDiskDir);
					licenseId = npmLicenseId(raw);
					repoUrl = normalizeRepoUrl(raw?.repository);
					childOptDeps = raw?.optionalDependencies;
				} else {
					const packument = await fetchNpmRegistryJson(child.name);
					if (packument) {
						pbFetchedRegistry++;
						const v = packument.versions ? packument.versions[child.version] : undefined;
						licenseId = npmLicenseId(v);
						repoUrl = normalizeRepoUrl(v?.repository ?? packument.repository);
						childOptDeps = v?.optionalDependencies;
					}
				}

				nextFrontier.push({
					optDeps: childOptDeps,
					seedParentKey: child.seedParentKey,
					seedParentLicenseId: child.seedParentLicenseId,
					seedParentText: child.seedParentText,
				});

				if (entries.has(ck)) {
					pbSkippedAlready++;
					return;
				}
				if (cgCovered.has(ck)) {
					pbSkippedCg++;
					return;
				}

				let resolved = repoUrl ? pbTextByRepo.get(repoUrl) : undefined;
				if (!resolved) {
					let ownText: string | undefined;
					let ownSource: 'disk' | 'repo' | undefined;
					if (onDiskDir) {
						const lf = findLicenseFile(onDiskDir);
						if (lf) {
							try {
								ownText = fs.readFileSync(lf, 'utf8').trim();
								ownSource = 'disk';
							} catch { }
						}
					}
					if (!ownText && repoUrl) {
						for (const ref of [`v${child.version}`, child.version, 'main', 'master']) {
							const text = await fetchLicenseFromGitRepo(repoUrl, ref);
							if (text && isRealLicenseBody(text)) {
								ownText = text;
								ownSource = 'repo';
								break;
							}
						}
					}
					const safeParentText = parentTextIfCompatible(child.seedParentLicenseId, licenseId, child.seedParentText);
					resolved = familyText(pbTextByRepo, repoUrl, ownText, ownSource, safeParentText);
				}

				if (resolved.source === 'disk') {
					pbTextFromDisk++;
				} else if (resolved.source === 'repo') {
					pbTextFromRepo++;
				} else if (resolved.source === 'parent') {
					pbTextFromParent++;
				} else {
					pbNoText++;
					console.warn(`  NO LICENSE TEXT: ${child.name}@${child.version} - emitting entry with empty body (id=${licenseId || 'unknown'}, url=${repoUrl || 'none'})`);
				}

				entries.set(ck, {
					name: child.name,
					version: child.version,
					license: licenseId,
					url: repoUrl,
					licenseText: resolved.text,
					fromExtension: 'platform-binary-enumeration',
				});
				pbAdded++;
				console.log(`  ADDED (arch): ${child.name}@${child.version} - ${licenseId || 'unknown'} (text: ${resolved.source})`);
			} catch (err) {
				console.warn(`  PLATFORM-BINARY FAILED: ${child.name}@${child.version} - unexpected error: ${(err as Error).message}`);
			}
		});

		await runWithConcurrency(tasks, 4);
		pbFrontier = nextFrontier;
	}

	console.log(`  Platform-binary arch entries added: ${pbAdded}`);

	console.log('');
	console.log('=========================================================================');
	console.log('SECTION 6: OS-gated whole-package enumeration (lockfile-driven)');
	console.log(`  Host platform: ${process.platform}`);
	console.log('=========================================================================');

	const hostPlatform = process.platform;
	const s6LockFiles = [
		path.join(repoRoot, 'package-lock.json'),
		path.join(repoRoot, 'remote', 'package-lock.json'),
		path.join(repoRoot, 'build', 'package-lock.json'),
	];
	let s6Seeded = 0;
	let s6AlreadyResolved = 0;
	let s6AlreadyPresent = 0;
	const s6Seen = new Set<string>();
	for (const lockPath of s6LockFiles) {
		if (!fs.existsSync(lockPath)) {
			continue;
		}
		let lock: { packages?: Record<string, { version?: string; os?: unknown }> };
		try {
			lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
		} catch (err) {
			console.warn(`  WARN: could not parse ${lockPath}: ${(err as Error).message}`);
			continue;
		}
		const pkgs = lock.packages || {};
		for (const lockKey of Object.keys(pkgs)) {
			const meta = pkgs[lockKey];
			if (!isOsGatedShippedElsewhere(meta?.os as string[], hostPlatform)) {
				continue;
			}
			const nmIdx = lockKey.lastIndexOf('node_modules/');
			if (nmIdx < 0) {
				continue;
			}
			const name = lockKey.slice(nmIdx + 'node_modules/'.length);
			if (!name) {
				continue;
			}
			if (isArchPackageName(name)) {
				continue;
			}
			const key = name.toLowerCase();
			if (s6Seen.has(key)) {
				continue;
			}
			s6Seen.add(key);
			if (entries.has(key)) {
				s6AlreadyResolved++;
				continue;
			}
			if (noLicenseSeen.has(key)) {
				s6AlreadyPresent++;
				continue;
			}
			noLicenseSeen.set(key, { name, version: meta?.version || '' });
			s6Seeded++;
			console.log(`  SEEDED (os:[${(meta!.os as string[]).join(', ')}]): ${name}@${meta?.version || ''}`);
		}
	}
	console.log(`  Section 6 seeded ${s6Seeded} os-gated package(s) into the presence index ` +
		`(${s6AlreadyResolved} already licensed, ${s6AlreadyPresent} already present).`);

	console.log('');
	console.log('=========================================================================');
	console.log('SECTION 7: Built-in (pre-built) extension dependency enumeration');
	console.log('=========================================================================');

	let s7Added = 0;
	let s7Seeded = 0;
	let s7SkippedCg = 0;
	let s7SkippedAlready = 0;
	let s7DepsEnumerated = 0;
	let s7LockfilesFound = 0;
	let s7LockfilesFromDisk = 0;
	let s7LockfilesFetched = 0;
	let s7ExtCount = 0;
	const s7MissingLockfiles: string[] = [];
	const strictBuiltin = process.argv.includes('--strict-builtin-extensions');
	const inCI = !!(process.env.TF_BUILD || process.env.BUILD_BUILDID);

	const extensionsCgDir = path.join(repoRoot, 'extensionsCG');
	{
		let extManifest: Array<{ name: string; version: string; repo: string }> = [];
		const productJsonPath = path.join(repoRoot, 'product.json');
		try {
			extManifest = readBuiltInExtensionManifest(JSON.parse(fs.readFileSync(productJsonPath, 'utf8')));
		} catch (err) {
			console.warn(`  WARN: could not read built-in extensions from ${productJsonPath}: ${(err as Error).message}`);
		}
		s7ExtCount = extManifest.length;
		console.log(`  Built-in extensions in product.json: ${s7ExtCount}` +
			`${s7ExtCount ? ' (' + extManifest.map(e => e.name).join(', ') + ')' : ''}`);

		const lockByExt = new Map<string, unknown>();
		const acquireTasks = extManifest.map(ext => async (): Promise<void> => {
			const lockPath = path.join(extensionsCgDir, ext.name, 'package-lock.json');
			if (fs.existsSync(lockPath)) {
				try {
					lockByExt.set(ext.name, JSON.parse(fs.readFileSync(lockPath, 'utf8')));
					s7LockfilesFound++;
					s7LockfilesFromDisk++;
					return;
				} catch (err) {
					console.warn(`  WARN: could not parse ${lockPath}: ${(err as Error).message}`);
				}
			}
			const lockUrl = builtInExtensionLockfileUrl(ext.repo, ext.version);
			if (!lockUrl) {
				console.warn(`  WARN: ${ext.name} has no parseable GitHub repo/version in product.json -- cannot self-fetch its lockfile`);
				s7MissingLockfiles.push(ext.name);
				return;
			}
			const body = await fetchUriText(lockUrl);
			if (body) {
				try {
					lockByExt.set(ext.name, JSON.parse(body));
					s7LockfilesFound++;
					s7LockfilesFetched++;
					console.log(`  self-fetched lockfile: ${ext.name}@${ext.version} (${lockUrl})`);
					return;
				} catch (err) {
					console.warn(`  WARN: could not parse self-fetched lockfile for ${ext.name}: ${(err as Error).message}`);
				}
			}
			s7MissingLockfiles.push(ext.name);
		});
		await runWithConcurrency(acquireTasks, 4);

		const s7Pending = new Map<string, { name: string; version: string }>();
		for (const ext of extManifest) {
			const lockJson = lockByExt.get(ext.name);
			if (!lockJson) {
				continue;
			}
			const deps = enumerateLockfileProdDeps(lockJson);
			if (deps.length === 0) {
				console.warn(`  WARN: ${ext.name} lockfile produced 0 production deps (lockfileVersion 1, or empty)`);
			}
			for (const dep of deps) {
				const key = dep.name.toLowerCase();
				if (entries.has(key)) { s7SkippedAlready++; continue; }
				if (cgCovered.has(key)) { s7SkippedCg++; continue; }
				if (!s7Pending.has(key)) {
					s7Pending.set(key, dep);
				}
			}
		}
		s7DepsEnumerated = s7Pending.size;
		console.log(`  ${s7LockfilesFound} lockfile(s) acquired (${s7LockfilesFromDisk} disk, ${s7LockfilesFetched} self-fetched); ${s7DepsEnumerated} uncovered production dep(s) to resolve`);

		const s7Tasks = [...s7Pending.values()].map(dep => async (): Promise<void> => {
			try {
				const key = dep.name.toLowerCase();
				const packument = await fetchNpmRegistryJson(dep.name);
				let licenseId = '';
				let repoUrl = '';
				if (packument) {
					const v = packument.versions ? packument.versions[dep.version] : undefined;
					licenseId = npmLicenseId(v);
					repoUrl = normalizeRepoUrl(v?.repository ?? packument.repository);
				}
				let text: string | undefined;
				if (repoUrl) {
					for (const ref of [`v${dep.version}`, dep.version, 'main', 'master']) {
						const t = await fetchLicenseFromGitRepo(repoUrl, ref);
						if (t && isRealLicenseBody(t)) {
							text = t;
							break;
						}
					}
				}
				if (text) {
					validateCopyright(dep.name, text, 'builtin-extension');
					entries.set(key, {
						name: dep.name,
						version: dep.version,
						license: licenseId,
						url: repoUrl,
						licenseText: text,
						fromExtension: 'builtin-extension-enumeration',
					});
					s7Added++;
					console.log(`  ADDED (builtin-ext): ${dep.name}@${dep.version} - ${licenseId || 'unknown'} (text: repo)`);
				} else {
					if (!noLicenseSeen.has(key)) {
						noLicenseSeen.set(key, { name: dep.name, version: dep.version });
						s7Seeded++;
					}
					console.warn(`  NO LICENSE TEXT: ${dep.name}@${dep.version} - seeded into presence index (id=${licenseId || 'unknown'}, url=${repoUrl || 'none'})`);
				}
			} catch (err) {
				console.warn(`  BUILTIN-EXTENSION FAILED: ${dep.name}@${dep.version} - unexpected error: ${(err as Error).message}`);
			}
		});
		await runWithConcurrency(s7Tasks, 4);

		if (s7MissingLockfiles.length > 0) {
			const detail = `${s7MissingLockfiles.length} built-in extension(s) have NO obtainable package-lock.json (neither extensionsCG/ nor self-fetch): ${s7MissingLockfiles.join(', ')}`;
			if (inCI) {
				console.error(`  ERROR: ${detail}`);
				console.error('  Their bundled dependencies are NOT covered. The download-builtin-extensions-cg step likely failed AND the GitHub self-fetch fallback could not reach the lockfile.');
			} else {
				console.log(`  NOTE: ${detail}`);
				console.log('  (Expected for offline local runs; CI self-fetches each lockfile from GitHub.)');
			}
		}
		console.log(`  Section 7 added ${s7Added} dep(s) with text, seeded ${s7Seeded} into presence; ` +
			`skipped ${s7SkippedCg} CG-covered, ${s7SkippedAlready} already-resolved.`);
	}

	const sorted = [...entries.values()].sort((a, b) =>
		a.name.toLowerCase().localeCompare(b.name.toLowerCase())
	);

	const SEPARATOR = '---------------------------------------------------------';
	let output = '';

	for (const entry of sorted) {
		output += '\n' + SEPARATOR + '\n\n';
		output += entry.name;
		if (entry.version) {
			output += ' ' + entry.version;
		}
		if (entry.license) {
			output += ' - ' + entry.license;
		}
		output += '\n';
		if (entry.url) {
			output += entry.url + '\n';
		}
		output += '\n';
		if (entry.licenseText) {
			output += entry.licenseText + '\n';
		}
	}

	output += '\n' + SEPARATOR + '\n';

	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}
	fs.writeFileSync(outputPath, output, 'utf8');

	const presencePath = args['presence'] || (outputPath + '.presence.json');
	const presence = [...noLicenseSeen.entries()]
		.filter(([k]) => !entries.has(k))
		.map(([, v]) => ({ name: v.name, version: v.version }))
		.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	fs.writeFileSync(presencePath, JSON.stringify(presence, null, '\t'), 'utf8');

	const stubOverridePath = args['stuboverride'] || (outputPath + '.stuboverride.json');
	const stubOverrideList = [...stubOverrideKeys].sort();
	fs.writeFileSync(stubOverridePath, JSON.stringify(stubOverrideList, null, '\t'), 'utf8');

	const unresolvedPath = args['unresolved'] || (outputPath + '.unresolved.json');
	const unresolvedSorted = unresolved.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	fs.writeFileSync(unresolvedPath, JSON.stringify(unresolvedSorted, null, '\t'), 'utf8');

	console.log('');
	console.log('=== License Scan Summary ===');
	console.log(`  Section 1 -- Extensions:`);
	console.log(`    Extensions scanned:        ${extensions.length}`);
	console.log(`    Packages found:            ${scanned}`);
	console.log(`    LICENSE found:             ${scanned - noLicense}`);
	console.log(`    NO LICENSE:                ${noLicense}`);
	console.log(`  Section 2 -- Root node_modules:`);
	console.log(`    Packages found:            ${rootScanned}`);
	console.log(`    LICENSE found:             ${rootScanned - rootNoLicense}`);
	console.log(`    NO LICENSE:                ${rootNoLicense}`);
	console.log(`  Section 3 -- cgmanifest.json:`);
	console.log(`    Files scanned:             ${cgManifestFiles.length}`);
	console.log(`    Entries with licenseDetail: ${cgManifestFound}`);
	console.log(`    Fetched from git repo:     ${cgManifestFetched}`);
	console.log(`    Fetch failed (no LICENSE): ${cgManifestFetchFailed}`);
	console.log(`    Skipped (CG already covers): ${cgManifestSkippedCgCovered}`);
	console.log(`    No detail, not fetchable:  ${cgManifestNoDetail}`);
	console.log(`  Section 4 -- Cargo.lock crates:`);
	console.log(`    Lock files scanned:        ${cargoLockFiles.length}`);
	console.log(`    Crates seen:               ${cargoCratesSeen}`);
	console.log(`    Workspace crates skipped:  ${cargoNoSource}`);
	console.log(`    git-source crates skipped: ${cargoGitSource}`);
	console.log(`    Skipped (already resolved): ${cargoSkippedAlready}`);
	console.log(`    Skipped (CG covers w/ text): ${cargoSkippedCgCovered}`);
	console.log(`    Added (coverage gap):      ${cargoFetched}`);
	console.log(`    Stub-overridden:           ${cargoStubOverride}`);
	console.log(`    crates.io API failed:      ${cargoApiFailed}`);
	console.log(`    Fetch failed (no LICENSE): ${cargoFetchFailed}`);
	console.log(`    AND-license incomplete:    ${cargoAndIncomplete}`);
	console.log(`  Section 5 - Platform binaries:`);
	console.log(`    Parent packages found:     ${pbParentsFound}`);
	console.log(`    Arch entries added:        ${pbAdded}`);
	console.log(`    Fetched from registry:     ${pbFetchedRegistry}`);
	console.log(`    Text from disk:            ${pbTextFromDisk}`);
	console.log(`    Text from repo:            ${pbTextFromRepo}`);
	console.log(`    Text from parent fallback: ${pbTextFromParent}`);
	console.log(`    No text (warned):          ${pbNoText}`);
	console.log(`    Skipped (already resolved): ${pbSkippedAlready}`);
	console.log(`    Skipped (CG covers):       ${pbSkippedCg}`);
	console.log(`    Skipped (not shipped):     ${pbSkippedNotShipped}`);
	console.log(`  Section 6 - OS-gated whole packages:`);
	console.log(`    Seeded into presence:      ${s6Seeded}`);
	console.log(`  Section 7 - Built-in extension deps:`);
	console.log(`    Built-in extensions:       ${s7ExtCount}`);
	console.log(`    Lockfiles found:           ${s7LockfilesFound} (${s7LockfilesFromDisk} disk, ${s7LockfilesFetched} self-fetched)`);
	console.log(`    Lockfiles missing:         ${s7MissingLockfiles.length}${s7MissingLockfiles.length ? ' (' + s7MissingLockfiles.join(', ') + ')' : ''}`);
	console.log(`    Uncovered deps resolved:   ${s7DepsEnumerated}`);
	console.log(`    Added (text from repo):    ${s7Added}`);
	console.log(`    Seeded into presence:      ${s7Seeded}`);
	console.log(`    Skipped (CG covers):       ${s7SkippedCg}`);
	console.log(`    Skipped (already resolved): ${s7SkippedAlready}`);
	console.log(`  Total entries in output:     ${entries.size}`);
	console.log(`  Output: ${outputPath}`);
	console.log(`  Presence index (present but unlicensed): ${presence.length}`);
	console.log(`  Presence output: ${presencePath}`);
	console.log(`  Unresolved (tried, no row created): ${unresolved.length}`);
	console.log(`  Stub-override index: ${stubOverrideList.length}`);
	console.log(`  Stub-override output: ${stubOverridePath}`);

	if (strictBuiltin && s7MissingLockfiles.length > 0) {
		console.error(`--strict-builtin-extensions: failing build -- ${s7MissingLockfiles.length} built-in extension lockfile(s) unobtainable (disk or self-fetch): ${s7MissingLockfiles.join(', ')}`);
		process.exit(1);
	}
}


if (/scan-licenses(\.[jt]s)?$/.test(process.argv[1] || '')) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
